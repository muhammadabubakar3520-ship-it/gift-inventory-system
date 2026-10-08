'use strict';
/**
 * Authentication and role checks for protected API routes.
 *   authenticate      – needs "Authorization: Bearer <JWT>"; checks signature and expiry
 *   requireRole(role) – 'admin', 'promoter' or 'any' (any signed-in user)
 * The request handler checks again against the database that the user still exists, is active and
 * has that role (services/engine.js → G.authenticate), so a deactivated user is locked out at once.
 */
const G = require('../services/engine');

function bearer(req) {
  const h = req.get('authorization') || '';
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m ? m[1] : null;
}

function authenticate(req, _res, next) {
  try { req.auth = G.verifyToken(bearer(req)); next(); } catch (e) { next(e); }
}

const requireRole = (role) => (req, _res, next) => {
  if (!req.auth) return next(G.unauth());
  if (role !== 'any' && req.auth.role !== role) return next(G.forbidden('You do not have access to this area'));
  return next();
};

module.exports = { authenticate, requireRole, bearer };
