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

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
const MAX_NAME = 120;

export function validateSignup(req, _res, next) {
  const { email, name, password } = req.body || {};
  const errors = {};
  if (!isEmail(email)) errors.email = 'A valid email is required.';
  if (!nonEmptyString(name)) errors.name = 'Name is required.';
  else if (name.trim().length > MAX_NAME)
    errors.name = `Name too long (max ${MAX_NAME} chars).`;
  if (!nonEmptyString(password)) errors.password = 'Password is required.';
  else if (password.length < MIN_PASSWORD)
    errors.password = `Password must be at least ${MIN_PASSWORD} characters.`;
  else if (password.length > MAX_PASSWORD)
    errors.password = 'Password is too long.';
  if (Object.keys(errors).length) {
    return next(new HttpError(400, 'Validation failed', errors));
  }
  next();
}

export function validateLogin(req, _res, next) {
  const { email, password } = req.body || {};
  const errors = {};
  if (!isEmail(email)) errors.email = 'A valid email is required.';
  if (!nonEmptyString(password)) errors.password = 'Password is required.';
  if (Object.keys(errors).length) {
    return next(new HttpError(400, 'Validation failed', errors));
  }
  next();
}

export function validateChangePassword(req, _res, next) {
  const { currentPassword, newPassword } = req.body || {};
  const errors = {};
  if (!nonEmptyString(currentPassword))
    errors.currentPassword = 'Current password is required.';
  if (!nonEmptyString(newPassword)) errors.newPassword = 'New password is required.';
  else if (newPassword.length < MIN_PASSWORD)
    errors.newPassword = `Password must be at least ${MIN_PASSWORD} characters.`;
  else if (newPassword.length > MAX_PASSWORD)
    errors.newPassword = 'Password is too long.';
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
