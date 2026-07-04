import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';

import { sendLimiter } from './middleware/rateLimit.js';
import { aiModelMiddleware } from './middleware/aiModel.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import emailRoutes from './routes/email.js';
import templateRoutes from './routes/templates.js';
import logRoutes from './routes/log.js';
import enrichRoutes from './routes/enrich.js';
import resumeRoutes from './routes/resumes.js';
import tailorRoutes from './routes/tailor.js';
import aiRoutes from './routes/ai.js';
import { ping } from './services/db.js';
import { isAiEnabled, isProviderConfigured } from './services/aiModel.js';
import { isLlmConfigured } from './services/llm.js';

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
  const isDev = process.env.NODE_ENV !== 'production';

  function isAllowedOrigin(origin) {
    if (!origin) return true;
    if (origins.includes(origin)) return true;
    // Vite may fall back to another port when 5173 is taken.
    if (isDev && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return true;
    }
    return false;
  }

  app.use(
    cors({
      origin: (origin, cb) => {
        if (isAllowedOrigin(origin)) return cb(null, true);
        return cb(new Error(`Origin ${origin} not allowed by CORS`));
      },
      // Needed so the browser sends/stores the httpOnly refresh cookie on
      // cross-origin (dev) requests to /api/auth.
      credentials: true,
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Gemini-Model',
        'X-AI-Provider',
        'X-AI-Model',
      ],
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
  }

  // Browser model picker sends X-AI-Provider + X-AI-Model (legacy: X-Gemini-Model).
  app.use('/api', aiModelMiddleware);

  app.get('/api/health', async (_req, res) => {
    const dbOk = await ping();
    res.status(dbOk ? 200 : 503).json({
      ok: dbOk,
      storage: 'mongodb',
      uptime: process.uptime(),
      features: {
        aiEnrich: isAiEnabled(),
        aiProviders: {
          gemini: isProviderConfigured('gemini'),
          groq: isProviderConfigured('groq'),
        },
        resumeTailor: isLlmConfigured(),
      },
    });
  });

  // --- Public endpoints (no auth) ---
  // Auth flow (login/signup/refresh/logout) plus AI model listing.
  app.use('/api/auth', authRoutes);
  app.use('/api/ai', aiRoutes);

  // --- Everything below requires a valid access token ---
  // requireAuth also establishes the per-user context that scopes all stores.
  app.use('/api', requireAuth);

  // Send + enrich endpoints are rate-limited; reads are not.
  app.use('/api', sendLimiter, emailRoutes);
  app.use('/api/enrich', sendLimiter, enrichRoutes);
  app.use('/api/templates', templateRoutes);
  app.use('/api/log', logRoutes);
  app.use('/api/resumes', resumeRoutes);
  // Tailor endpoints hit Gemini and (optionally) texlive.net; rate-limited.
  app.use('/api/tailor', sendLimiter, tailorRoutes);

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
