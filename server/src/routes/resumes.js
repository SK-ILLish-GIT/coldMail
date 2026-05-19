import { Router } from 'express';
import multer from 'multer';

import { HttpError } from '../middleware/error.js';
import { resumeStore } from '../services/resumeStore.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_NAME = 200;

function isPdf(file) {
  if (file.mimetype === 'application/pdf') return true;
  return /\.pdf$/i.test(file.originalname || '');
}

// Multer instance scoped to this router — single-file upload only.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (isPdf(file)) cb(null, true);
    else {
      const err = new Error('Only PDF files are allowed.');
      err.status = 400;
      cb(err);
    }
  },
}).single('file');

const router = Router();

// GET /api/resumes — list metadata (no PDF bytes)
router.get('/', async (_req, res, next) => {
  try {
    const items = await resumeStore.list();
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// GET /api/resumes/:id — download the PDF
router.get('/:id', async (req, res, next) => {
  try {
    const doc = await resumeStore.get(req.params.id);
    if (!doc) throw new HttpError(404, 'Resume not found.');
    res.setHeader('Content-Type', doc.contentType || 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${(doc.filename || 'resume.pdf').replace(/"/g, '')}"`
    );
    res.send(doc.content);
  } catch (err) {
    next(err);
  }
});

// POST /api/resumes — upload (multipart: field "file" + "name")
router.post('/', (req, res, next) => {
  upload(req, res, async (uploadErr) => {
    if (uploadErr) {
      const status =
        uploadErr.code === 'LIMIT_FILE_SIZE'
          ? 413
          : uploadErr.status || 400;
      return next(new HttpError(status, uploadErr.message));
    }
    try {
      if (!req.file) throw new HttpError(400, 'A PDF file is required.');
      const name = String(req.body?.name || '').trim() || req.file.originalname;
      if (name.length > MAX_NAME) {
        throw new HttpError(400, `Name is too long (max ${MAX_NAME} chars).`);
      }
      const meta = await resumeStore.create({
        name,
        filename: req.file.originalname,
        contentType: req.file.mimetype || 'application/pdf',
        size: req.file.size,
        content: req.file.buffer,
      });
      res.status(201).json(meta);
    } catch (err) {
      next(err);
    }
  });
});

// PUT /api/resumes/:id — rename
router.put('/:id', async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) throw new HttpError(400, 'Name is required.');
    if (name.length > MAX_NAME) {
      throw new HttpError(400, `Name is too long (max ${MAX_NAME} chars).`);
    }
    const updated = await resumeStore.update(req.params.id, { name });
    if (!updated) throw new HttpError(404, 'Resume not found.');
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/resumes/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const ok = await resumeStore.delete(req.params.id);
    if (!ok) throw new HttpError(404, 'Resume not found.');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
