import { Router } from 'express';

import { HttpError } from '../middleware/error.js';
import {
  findEmailCandidates,
  extractNamesFromEmails,
  extractJobIntake,
  matchJobDescription,
  isEnrichmentEnabled,
} from '../services/enrich.js';

const router = Router();

const MAX_FIELD = 200;
const MAX_EMAILS_PER_CALL = 50;
const MAX_JD_CHARS = 20_000;
const MAX_LIBRARY_ITEMS = 200;
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function nonEmpty(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

router.post('/email', async (req, res, next) => {
  try {
    if (!isEnrichmentEnabled()) {
      throw new HttpError(
        503,
        'AI email finder is disabled. Set GEMINI_API_KEY or GROQ_API_KEY in server/.env to enable it.'
      );
    }

    const { firstName, lastName, company, domain } = req.body || {};
    const errors = {};

    if (!nonEmpty(firstName)) errors.firstName = 'First name is required.';
    if (!nonEmpty(lastName)) errors.lastName = 'Last name is required.';
    if (!nonEmpty(company)) errors.company = 'Company is required.';

    for (const [k, v] of Object.entries({ firstName, lastName, company, domain })) {
      if (typeof v === 'string' && v.length > MAX_FIELD) {
        errors[k] = `${k} is too long (max ${MAX_FIELD} chars).`;
      }
    }

    if (Object.keys(errors).length) {
      throw new HttpError(400, 'Validation failed', errors);
    }

    const result = await findEmailCandidates({
      firstName,
      lastName,
      company,
      domain,
    });

    res.json(result);
  } catch (err) {
    // Map upstream Gemini errors to a clean 502 so the UI gets a friendly message.
    if (err.status && err.status >= 400 && err.status < 600 && err.message) {
      return next(err);
    }
    const msg = err.message || 'Gemini request failed';
    // Gemini returns quota errors with status 429 in the message text.
    if (/quota|exceeded|rate/i.test(msg)) {
      return next(
        new HttpError(
          429,
          'Gemini quota exhausted. Check your free-tier limits at https://aistudio.google.com/'
        )
      );
    }
    next(new HttpError(502, `Gemini error: ${msg}`));
  }
});

// POST /api/enrich/names — given a list of emails + company, return a likely
// recipient name for each. Used by the "By MailID" compose mode.
router.post('/names', async (req, res, next) => {
  try {
    if (!isEnrichmentEnabled()) {
      throw new HttpError(
        503,
        'AI is disabled. Set GEMINI_API_KEY or GROQ_API_KEY in server/.env to enable it.'
      );
    }

    const { emails, company } = req.body || {};
    const errors = {};

    if (!Array.isArray(emails) || emails.length === 0) {
      errors.emails = 'emails must be a non-empty array.';
    } else if (emails.length > MAX_EMAILS_PER_CALL) {
      errors.emails = `Maximum ${MAX_EMAILS_PER_CALL} emails per call.`;
    }
    if (!nonEmpty(company)) errors.company = 'Company is required.';
    if (typeof company === 'string' && company.length > MAX_FIELD) {
      errors.company = `Company is too long (max ${MAX_FIELD} chars).`;
    }
    if (Object.keys(errors).length) {
      throw new HttpError(400, 'Validation failed', errors);
    }

    // Normalise + filter to syntactically-valid addresses; dedupe.
    const seen = new Set();
    const cleaned = [];
    for (const raw of emails) {
      const e = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
      if (EMAIL_REGEX.test(e) && !seen.has(e)) {
        seen.add(e);
        cleaned.push(e);
      }
    }
    if (!cleaned.length) {
      throw new HttpError(400, 'No valid email addresses provided.');
    }

    const candidates = await extractNamesFromEmails({
      emails: cleaned,
      company: company.trim(),
    });
    res.json({ candidates });
  } catch (err) {
    if (err.status && err.status >= 400 && err.status < 600 && err.message) {
      return next(err);
    }
    const msg = err.message || 'Gemini request failed';
    if (/quota|exceeded|rate/i.test(msg)) {
      return next(
        new HttpError(
          429,
          'Gemini quota exhausted. Check your free-tier limits at https://aistudio.google.com/'
        )
      );
    }
    next(new HttpError(502, `Gemini error: ${msg}`));
  }
});

// POST /api/enrich/job-intake — fetch/normalise JD from URL and/or pasted text.
router.post('/job-intake', async (req, res, next) => {
  try {
    if (!isEnrichmentEnabled()) {
      throw new HttpError(
        503,
        'AI is disabled. Set GEMINI_API_KEY or GROQ_API_KEY in server/.env to enable it.'
      );
    }

    const { jobUrl, jdText, company } = req.body || {};
    const hasUrl = nonEmpty(jobUrl);
    const hasText = nonEmpty(jdText);
    if (!hasUrl && !hasText) {
      throw new HttpError(400, 'Provide jobUrl and/or jdText.');
    }
    if (hasUrl && String(jobUrl).length > 2000) {
      throw new HttpError(400, 'jobUrl is too long.');
    }
    if (hasText && String(jdText).length > MAX_JD_CHARS) {
      throw new HttpError(400, `jdText is too long (max ${MAX_JD_CHARS} chars).`);
    }
    if (typeof company === 'string' && company.length > MAX_FIELD) {
      throw new HttpError(400, `company is too long (max ${MAX_FIELD} chars).`);
    }

    const result = await extractJobIntake({
      jobUrl: hasUrl ? String(jobUrl).trim() : '',
      jdText: hasText ? String(jdText).trim() : '',
      company: typeof company === 'string' ? company.trim() : '',
    });
    res.json(result);
  } catch (err) {
    if (err.status && err.status >= 400 && err.status < 600 && err.message) {
      return next(err);
    }
    const msg = err.message || 'Gemini request failed';
    if (/quota|exceeded|rate/i.test(msg)) {
      return next(
        new HttpError(
          429,
          'Gemini quota exhausted. Check your free-tier limits at https://aistudio.google.com/'
        )
      );
    }
    next(new HttpError(502, `Job intake failed: ${msg}`));
  }
});

// POST /api/enrich/jd-match — given a JD + the client's library summaries,
// returns the best-fit template id and resume id (either may be empty).
router.post('/jd-match', async (req, res, next) => {
  try {
    if (!isEnrichmentEnabled()) {
      throw new HttpError(503, 'AI is disabled. Set GEMINI_API_KEY or GROQ_API_KEY on the server.');
    }

    const { jobDescription, templates, resumes } = req.body || {};
    const errors = {};

    if (!nonEmpty(jobDescription)) {
      errors.jobDescription = 'jobDescription is required.';
    } else if (jobDescription.length > MAX_JD_CHARS) {
      errors.jobDescription = `JD is too long (max ${MAX_JD_CHARS} chars).`;
    }
    if (!Array.isArray(templates) || !Array.isArray(resumes)) {
      errors.library = 'templates and resumes must be arrays.';
    } else if (
      templates.length > MAX_LIBRARY_ITEMS ||
      resumes.length > MAX_LIBRARY_ITEMS
    ) {
      errors.library = `Library too large (max ${MAX_LIBRARY_ITEMS} per kind).`;
    } else if (!templates.length && !resumes.length) {
      errors.library = 'No templates or resumes to match against.';
    }
    if (Object.keys(errors).length) {
      throw new HttpError(400, 'Validation failed', errors);
    }

    const result = await matchJobDescription({
      jobDescription,
      templates,
      resumes,
    });
    res.json(result);
  } catch (err) {
    if (err.status && err.status >= 400 && err.status < 600 && err.message) {
      return next(err);
    }
    const msg = err.message || 'Gemini request failed';
    if (/quota|exceeded|rate/i.test(msg)) {
      return next(
        new HttpError(
          429,
          'Gemini quota exhausted. Check your free-tier limits at https://aistudio.google.com/'
        )
      );
    }
    next(new HttpError(502, `Gemini error: ${msg}`));
  }
});

export default router;
