#!/usr/bin/env node
/**
 * JD Apply pipeline — API-only, no UI.
 * Usage:
 *   npm run agent:apply -- --job-url "https://..." --emails "a@x.com,b@y.com"
 *   npm run agent:apply -- --jd-file ./jd.txt --company "Acme" --emails "a@x.com"
 */
import fs from 'node:fs/promises';

import {
  createEmptySession,
  createSessionId,
  recordError,
  saveSession,
  sessionPath,
} from './lib/apply-session.mjs';
import { ApiError, createClient, parseEmails } from './lib/coldmail-api.mjs';
import { DEFAULT_SUBJECT, DEFAULT_TEMPLATE } from './lib/defaults.mjs';

function usage() {
  console.log(`Usage: npm run agent:apply -- [options]

Options:
  --job-url <url>       Job posting URL (optional if --jd or --jd-file)
  --jd <text>           Job description text inline
  --jd-file <path>      Job description from file
  --company <name>      Company override (optional)
  --emails <list>       Recruiter emails (comma/space separated, required)
  --base <url>          API base (default: https://coldmail-e9x0.onrender.com/api)
  --template-id <id>    Force template id (skip jd-match for template)
  --resume-id <id>      Force resume id (skip jd-match for resume)
  --session <id>        Resume existing session id
  --force               Re-run even if session already completed
  --dry-run             Run through match steps but skip send-bulk
  -h, --help            Show help
`);
}

function parseArgs(argv) {
  const opts = {
    jobUrl: '',
    jdText: '',
    jdFile: '',
    company: '',
    emails: '',
    base: '',
    templateId: '',
    resumeId: '',
    sessionId: '',
    force: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      usage();
      process.exit(0);
    }
    if (a === '--force') opts.force = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--job-url') opts.jobUrl = argv[++i] || '';
    else if (a === '--jd') opts.jdText = argv[++i] || '';
    else if (a === '--jd-file') opts.jdFile = argv[++i] || '';
    else if (a === '--company') opts.company = argv[++i] || '';
    else if (a === '--emails') opts.emails = argv[++i] || '';
    else if (a === '--base') opts.base = argv[++i] || '';
    else if (a === '--template-id') opts.templateId = argv[++i] || '';
    else if (a === '--resume-id') opts.resumeId = argv[++i] || '';
    else if (a === '--session') opts.sessionId = argv[++i] || '';
    else {
      console.error(`Unknown argument: ${a}`);
      usage();
      process.exit(1);
    }
  }
  return opts;
}

async function readJdFile(path) {
  if (!path) return '';
  return fs.readFile(path, 'utf8');
}

function printSummary(session) {
  const out = {
    sessionId: session.id,
    status: session.status,
    sessionFile: sessionPath(session.id),
    company: session.extracted.company,
    roleTitle: session.extracted.roleTitle,
    template: session.matches.templateName || '(default)',
    resume: session.matches.resumeName || '(none)',
    recipients: session.recipients.length,
    drafted: session.drafts.drafted,
    failed: session.drafts.failed,
    errors: session.errors,
  };
  console.log(JSON.stringify(out, null, 2));
}

async function stepPreflight(api, session) {
  const health = await api.health();
  if (!health?.ok) {
    throw new ApiError('coldMail server unhealthy — is npm run dev running?', 503);
  }
  if (!health.features?.aiEnrich) {
    throw new ApiError('AI disabled — set GEMINI_API_KEY in server/.env and restart.', 503);
  }
  session.status = 'preflight_ok';
  return session;
}

async function stepJobIntake(api, session) {
  const { jobUrl, jdText, company } = session.inputs;
  const result = await api.jobIntake({
    jobUrl: jobUrl || undefined,
    jdText: jdText || undefined,
    company: company || undefined,
  });
  session.extracted = {
    company: result.company || session.inputs.company || '',
    roleTitle: result.roleTitle || '',
    jd: result.jd || jdText || '',
  };
  if (result.jobUrl) session.inputs.jobUrl = result.jobUrl;
  if (!session.extracted.company) {
    throw new ApiError('Company could not be extracted — pass --company "Acme Inc."');
  }
  if (!session.extracted.jd || session.extracted.jd.length < 20) {
    throw new ApiError('JD too short after intake — provide more text or a job URL.');
  }
  session.status = 'job_intake_complete';
  return session;
}

async function stepRecruiterIntake(api, session) {
  const emails = session.inputs.recruiterEmails;
  if (!emails.length) {
    throw new ApiError('No recruiter emails — pass --emails "a@x.com,b@y.com"');
  }
  const { candidates } = await api.extractNames({
    emails,
    company: session.extracted.company,
  });
  const jobLink = session.inputs.jobUrl || '';
  session.recipients = candidates.map((c) => ({
    email: c.email,
    name: c.name || '',
    company: session.extracted.company,
    jobLink,
  }));
  session.status = 'recruiter_intake_complete';
  return session;
}

async function stepMatchLibrary(api, session, { templateId, resumeId }) {
  const [templates, resumes] = await Promise.all([
    api.listTemplates(),
    api.listResumes(),
  ]);
  if (!templates.length && !templateId) {
    throw new ApiError('No templates in library — add one in coldMail Templates tab.');
  }

  let match = { templateId: '', resumeId: '', reasoning: '' };
  if (templateId || resumeId) {
    match.templateId = templateId || '';
    match.resumeId = resumeId || '';
    match.reasoning = 'User override via CLI flags.';
  } else if (templates.length || resumes.length) {
    match = await api.matchJD({
      jobDescription: session.extracted.jd,
      templates: templates.map((t) => ({ id: t.id, name: t.name, tags: t.tags || [] })),
      resumes: resumes.map((r) => ({ id: r.id, name: r.name, tags: r.tags || [] })),
    });
  }

  const tpl = templates.find((t) => t.id === match.templateId);
  session.matches = {
    templateId: tpl?.id || '',
    templateName: tpl?.name || '(Default)',
    templateSubject: tpl?.subject || DEFAULT_SUBJECT,
    templateBody: tpl?.body || DEFAULT_TEMPLATE,
    resumeId: match.resumeId || '',
    resumeName: resumes.find((r) => r.id === match.resumeId)?.name || '',
    reasoning: match.reasoning || '',
  };
  session.status = 'match_complete';
  return session;
}

async function stepDraftMail(api, session, dryRun) {
  if (dryRun) {
    session.status = 'dry_run_complete';
    return session;
  }
  const payload = {
    recipients: session.recipients,
    subject: session.matches.templateSubject,
    template: session.matches.templateBody,
  };
  if (session.matches.resumeId) payload.resumeId = session.matches.resumeId;

  const result = await api.sendBulk(payload);
  session.drafts = {
    drafted: result.sent ?? 0,
    failed: result.failed ?? 0,
    results: result.results || [],
  };
  session.status = session.drafts.failed > 0 ? 'draft_partial' : 'draft_complete';
  return session;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const jdFromFile = await readJdFile(opts.jdFile);
  const jdText = opts.jdText || jdFromFile;
  const recruiterEmails = parseEmails(opts.emails);

  if (!opts.sessionId && !recruiterEmails.length) {
    console.error('Error: --emails is required.');
    usage();
    process.exit(1);
  }
  if (!opts.sessionId && !opts.jobUrl && !jdText.trim()) {
    console.error('Error: provide --job-url and/or --jd / --jd-file.');
    usage();
    process.exit(1);
  }

  const api = createClient(opts.base || undefined);
  let session;

  if (opts.sessionId) {
    const { loadSession } = await import('./lib/apply-session.mjs');
    session = await loadSession(opts.sessionId);
  } else {
    const id = createSessionId();
    session = createEmptySession({
      id,
      inputs: {
        jobUrl: opts.jobUrl,
        jdText: jdText.trim(),
        recruiterEmails,
        company: opts.company,
      },
    });
    await saveSession(session);
  }

  if (session.status === 'draft_complete' && !opts.force) {
    console.error(`Session ${session.id} already completed. Use --force to re-run.`);
    printSummary(session);
    process.exit(0);
  }

  const steps = [
    ['preflight', () => stepPreflight(api, session)],
    ['job-intake', () => stepJobIntake(api, session)],
    ['recruiter-intake', () => stepRecruiterIntake(api, session)],
    [
      'match',
      () =>
        stepMatchLibrary(api, session, {
          templateId: opts.templateId,
          resumeId: opts.resumeId,
        }),
    ],
    ['draft-mail', () => stepDraftMail(api, session, opts.dryRun)],
  ];

  for (const [name, fn] of steps) {
    try {
      session = await fn();
      await saveSession(session);
    } catch (err) {
      recordError(session, name, err);
      session.status = `failed_${name}`;
      await saveSession(session);
      console.error(`\n[${name}] ${err.message}`);
      printSummary(session);
      process.exit(1);
    }
  }

  printSummary(session);
  process.exit(session.drafts.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
