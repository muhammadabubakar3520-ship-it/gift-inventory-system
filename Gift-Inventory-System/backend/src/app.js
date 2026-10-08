'use strict';
/** Express application: security headers, CORS, JSON parsing, REST API, errors. */
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config/env');
const { pingDB } = require('./config/db');
const { buildRouter } = require('./routes');
const { authenticate } = require('./middleware/auth');
const { apiLimiter } = require('./middleware/rateLimit');
const { notFound, errorHandler } = require('./middleware/error');

/** Which browser origins may call the API: FRONTEND_URL (comma separated) and, optionally, Vercel previews. */
function corsOrigin(origin, cb) {
  if (!origin) return cb(null, true); // server-to-server, curl, health checks
  const o = origin.replace(/\/+$/, '');
  if (config.FRONTEND_URLS.includes('*') || config.FRONTEND_URLS.includes(o)) return cb(null, true);
  if (config.ALLOW_VERCEL_PREVIEWS && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(o)) return cb(null, true);
  if (!config.IS_PROD && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(o)) return cb(null, true);
  return cb(new Error('Not allowed by CORS'));
}

function createApp({ store }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY ? 1 : false);
  app.set('query parser', 'simple');

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // the frontend runs on another domain (Vercel)
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }, // the API serves no pages
  }));
  app.use('/api', cors({
    origin: corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Id'],
    exposedHeaders: ['Content-Disposition'],
    credentials: false, // sign-in uses a Bearer token, not cookies
    maxAge: 600,
  }));
  app.use('/api', apiLimiter);
  app.use(express.json({ limit: '10mb', strict: true }));

  app.get('/', (_req, res) => res.json({ name: 'Gift Inventory API', health: '/api/health' }));
  /** Health check (Render uses it): is the server up and MongoDB reachable? */
  app.get('/api/health', async (_req, res) => {
    const db = await pingDB();
    res.setHeader('Cache-Control', 'no-store');
    res.status(db ? 200 : 503).json({ ok: db, database: db ? 'ok' : 'unreachable', time: new Date().toISOString() });
  });
  /** Current data revision (screens without a live Socket.IO connection poll this). */
  app.get('/api/sync', authenticate, async (_req, res, next) => {
    try { await store.ensureFresh(); res.setHeader('Cache-Control', 'no-store'); res.json({ version: store.rev, time: new Date().toISOString() }); } catch (e) { next(e); }
  });

  app.use('/api', buildRouter());
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp, corsOrigin };
