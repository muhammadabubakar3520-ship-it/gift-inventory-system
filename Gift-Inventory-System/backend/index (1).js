'use strict';
/**
 * REST API routes (mounted under /api).
 *
 * Every controller declares its endpoints next to its handler:
 *   R('GET', '/shops/:id', 'admin', handler)          → GET /api/shops/:id   (admins only)
 *   R('POST', '/promoter/transactions', 'promoter', …) → promoters only
 *   role null = public, 'any' = any signed-in user.
 * Here every endpoint is mounted on Express with: input checks → JWT authentication → role check →
 * file upload (multipart routes) → handler. See docs in README.md (API section).
 */
const express = require('express');
const multer = require('multer');
const G = require('../services/engine');
const config = require('../config/env');
const { authenticate, requireRole } = require('../middleware/auth');
const { validateInput } = require('../middleware/validate');
const { loginLimiter } = require('../middleware/rateLimit');

/** Routes that receive files (multipart/form-data) and their size limit. */
const UPLOADS = {
  'POST /promoter/transactions': { files: 3, mb: config.MAX_PHOTO_MB + 1 },
  'POST /gifts/:id/image': { files: 1, mb: config.MAX_PHOTO_MB + 1 },
  'POST /system/restore': { files: 1, mb: config.RESTORE_MAX_MB },
};

function uploader({ files, mb }) {
  const up = multer({ storage: multer.memoryStorage(), limits: { files, fileSize: mb * 1024 * 1024, fields: 40, fieldSize: 64 * 1024 } }).any();
  return (req, res, next) => (req.is('multipart/form-data') ? up(req, res, next) : next());
}

/** multer result → FormData with File objects (what the handlers read with form.get(name)). */
function toForm(req) {
  if (!req.is('multipart/form-data')) return null;
  const fd = new FormData();
  for (const [k, v] of Object.entries(req.body || {})) fd.append(k, Array.isArray(v) ? String(v[v.length - 1]) : String(v));
  for (const f of req.files || []) fd.append(f.fieldname, new File([f.buffer], f.originalname || 'upload', { type: f.mimetype || 'application/octet-stream' }));
  return fd;
}

async function send(res, out) {
  if (out && out.__file) {
    const blob = out.__file;
    const buf = Buffer.from(await blob.arrayBuffer());
    const name = String(out.filename || 'download').replace(/[^\w.\- ()]+/g, '_');
    res.setHeader('Content-Type', blob.type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.send(buf);
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.json(out === undefined ? { ok: true } : out);
}

function handler(route) {
  return async (req, res, next) => {
    try {
      const out = await G.run(route, {
        params: req.params, query: req.cleanQuery || {}, body: req.is('multipart/form-data') ? {} : (req.body || {}), form: toForm(req),
        claims: req.auth, ip: req.ip, clientId: String(req.get('x-client-id') || '').slice(0, 64) || null,
      });
      await send(res, out);
    } catch (e) { next(e); }
  };
}

function buildRouter() {
  G.loadControllers();
  const router = express.Router();

  // sign-in (rate limited; the password check runs outside the request queue)
  router.post('/auth/login', loginLimiter, validateInput, async (req, res, next) => {
    try {
      const out = await G.login(req.body || {}, req.ip);
      res.setHeader('Cache-Control', 'no-store');
      res.json(out);
    } catch (e) { next(e); }
  });

  for (const r of G.routes) {
    if (r.method === 'POST' && r.path === '/auth/login') continue;
    const chain = [];
    const up = UPLOADS[`${r.method} ${r.path}`];
    if (r.role) chain.push(authenticate, requireRole(r.role));
    if (up) chain.push(uploader(up));
    chain.push(validateInput, handler(r));
    router[r.method.toLowerCase()](r.path, ...chain);
  }
  return router;
}

/** List of endpoints (for the README / tests). */
const describe = () => { G.loadControllers(); return [{ method: 'POST', path: '/auth/login', role: null }, ...G.routes.filter((r) => r.path !== '/auth/login').map((r) => ({ method: r.method, path: r.path, role: r.role || null }))]; };

module.exports = { buildRouter, describe };
