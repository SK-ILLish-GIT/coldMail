import multer from 'multer';
import { mapAiError } from '../services/aiErrors.js';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    if (details) this.details = details;
  }
}

export function notFound(_req, res) {
  res.status(404).json({ error: 'Not found' });
}

function mapMulterError(err) {
  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
      return new HttpError(400, 'Attachment too large. Max 10 MB per file.');
    case 'LIMIT_FILE_COUNT':
      return new HttpError(400, 'Too many attachments. Max 5 files per email.');
    case 'LIMIT_UNEXPECTED_FILE':
      return new HttpError(400, 'Unexpected file field. Use "attachments" as the field name.');
    default:
      return new HttpError(400, `Upload error: ${err.message}`);
  }
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  let normalized = err;
  if (err instanceof multer.MulterError) {
    normalized = mapMulterError(err);
  } else if (!(err instanceof HttpError)) {
    const ai = mapAiError(err);
    if (ai) normalized = ai;
  }
  const status = normalized.status || 500;
  if (status >= 500) {
    console.error('[coldMail] error:', err);
  }
  res.status(status).json({
    error: normalized.message || 'Internal server error',
    ...(normalized.details ? { details: normalized.details } : {}),
  });
}
