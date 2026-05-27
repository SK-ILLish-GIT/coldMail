import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import { sendLimiter } from './middleware/rateLimit.js';
import { geminiModelMiddleware } from './middleware/geminiModel.js';
import { errorHandler, notFound } from './middleware/error.js';
import emailRoutes from './routes/email.js';
import templateRoutes from './routes/templates.js';
import logRoutes from './routes/log.js';
import enrichRoutes from './routes/enrich.js';
import resumeRoutes from './routes/resumes.js';
import tailorRoutes from './routes/tailor.js';
import aiRoutes from './routes/ai.js';
import { ping } from './services/db.js';
import { isEnrichmentEnabled } from './services/enrich.js';
import { isGeminiConfigured as isTailorConfigured } from './services/tailor/gemini.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(__dirname, '../../client/dist');

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Disable helmet's default CSP — it blocks Vite's bundle loading and the
  // sandboxed srcdoc previews we use in PreviewModal / LivePreview. Other
  // helmet protections (HSTS, X-Frame-Options, etc.) stay on.
  app.use(helmet({ contentSecurityPolicy: false }));

  const origins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: (origin, cb) => {
        // Allow tools like curl/Postman (no Origin header) and configured origins
        if (!origin || origins.includes(origin)) return cb(null, true);
        return cb(new Error(`Origin ${origin} not allowed by CORS`));
      },
      allowedHeaders: ['Content-Type', 'X-Gemini-Model'],
    })
  );

  app.use(express.json({ limit: '1mb' }));
  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
  }

  // Browser model picker sends X-Gemini-Model; applies to all AI routes this request.
  app.use('/api', geminiModelMiddleware);

  app.get('/api/health', async (_req, res) => {
    const dbOk = await ping();
    res.status(dbOk ? 200 : 503).json({
      ok: dbOk,
      storage: 'mongodb',
      uptime: process.uptime(),
      features: {
        aiEnrich: isEnrichmentEnabled(),
        resumeTailor: isTailorConfigured(),
      },
    });
  });

  // Send + enrich endpoints are rate-limited; reads are not.
  app.use('/api', sendLimiter, emailRoutes);
  app.use('/api/enrich', sendLimiter, enrichRoutes);
  app.use('/api/templates', templateRoutes);
  app.use('/api/log', logRoutes);
  app.use('/api/resumes', resumeRoutes);
  // Tailor endpoints hit Gemini and (optionally) texlive.net; rate-limited.
  app.use('/api/tailor', sendLimiter, tailorRoutes);
  app.use('/api/ai', aiRoutes);

  // In production we run as a single process: Express serves the built React
  // SPA from client/dist and falls back to index.html for client-side routes.
  // Vite handles this in dev (it proxies /api to this server), so we only
  // enable static serving when explicitly in production.
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(CLIENT_DIST, { maxAge: '1h', index: false }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(CLIENT_DIST, 'index.html'));
    });
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
