import multer from 'multer';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file
const MAX_FILES = 5;

// Accept either a real PDF mime or a .pdf extension. Some browsers report
// application/octet-stream for files dragged from certain sources.
function isPdf(file) {
  if (file.mimetype === 'application/pdf') return true;
  return /\.pdf$/i.test(file.originalname || '');
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_BYTES,
    files: MAX_FILES,
  },
  fileFilter: (_req, file, cb) => {
    if (isPdf(file)) {
      cb(null, true);
    } else {
      const err = new Error('Only PDF files are allowed as attachments.');
      err.status = 400;
      cb(err);
    }
  },
});

/**
 * Accepts up to MAX_FILES PDF files in the `attachments` multipart field.
 * No-op for JSON requests (multer only intercepts multipart/form-data).
 */
export const acceptAttachments = upload.array('attachments', MAX_FILES);

/**
 * Some bulk requests send the recipients array as a JSON string inside a
 * multipart field (because FormData can't carry arrays natively). Parse it
 * back to an array so the downstream validator sees what it expects.
 */
export function parseJsonField(field) {
  return (req, _res, next) => {
    const v = req.body?.[field];
    if (typeof v === 'string' && v.length) {
      try {
        req.body[field] = JSON.parse(v);
      } catch {
        const err = new Error(`Invalid JSON in "${field}" field.`);
        err.status = 400;
        return next(err);
      }
    }
    next();
  };
}

export const ATTACHMENT_LIMITS = {
  maxFiles: MAX_FILES,
  maxFileBytes: MAX_FILE_BYTES,
};
