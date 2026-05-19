import validator from 'validator';
import { HttpError } from './error.js';

const MAX_TEMPLATE = 200_000; // ~200KB ought to be plenty
const MAX_SUBJECT = 998;      // RFC 5322
const MAX_RECIPIENTS = 500;

function nonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isEmail(v) {
  return typeof v === 'string' && validator.isEmail(v.trim());
}

export function validateSingleSend(req, _res, next) {
  const { email, template } = req.body || {};
  const subject = req.body?.subject;
  const errors = {};

  if (!isEmail(email)) errors.email = 'A valid email is required.';
  if (!nonEmptyString(template)) errors.template = 'Template cannot be empty.';
  else if (template.length > MAX_TEMPLATE)
    errors.template = `Template too large (max ${MAX_TEMPLATE} chars).`;
  if (!nonEmptyString(subject)) errors.subject = 'Subject is required.';
  else if (subject.length > MAX_SUBJECT)
    errors.subject = `Subject too long (max ${MAX_SUBJECT} chars).`;

  if (Object.keys(errors).length) {
    return next(new HttpError(400, 'Validation failed', errors));
  }
  next();
}

export function validateBulkSend(req, _res, next) {
  const { recipients, template, subject } = req.body || {};
  const errors = {};

  if (!Array.isArray(recipients) || recipients.length === 0)
    errors.recipients = 'recipients must be a non-empty array.';
  else if (recipients.length > MAX_RECIPIENTS)
    errors.recipients = `Too many recipients (max ${MAX_RECIPIENTS}).`;

  if (!nonEmptyString(template)) errors.template = 'Template cannot be empty.';
  else if (template.length > MAX_TEMPLATE)
    errors.template = `Template too large (max ${MAX_TEMPLATE} chars).`;
  if (!nonEmptyString(subject)) errors.subject = 'Subject is required.';

  if (!errors.recipients) {
    const bad = [];
    recipients.forEach((r, i) => {
      if (!r || !isEmail(r.email)) bad.push(i);
    });
    if (bad.length) {
      errors.recipients = `Invalid email at row${bad.length === 1 ? '' : 's'} ${bad.join(', ')}.`;
    }
  }

  if (Object.keys(errors).length) {
    return next(new HttpError(400, 'Validation failed', errors));
  }
  next();
}

export function validateTemplate(req, _res, next) {
  const { name, subject, body } = req.body || {};
  const errors = {};
  if (!nonEmptyString(name)) errors.name = 'Name is required.';
  if (!nonEmptyString(subject)) errors.subject = 'Subject is required.';
  if (!nonEmptyString(body)) errors.body = 'Body is required.';
  if (Object.keys(errors).length) {
    return next(new HttpError(400, 'Validation failed', errors));
  }
  next();
}
