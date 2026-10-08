'use strict';
/**
 * All settings come from environment variables (backend/.env locally, the Render dashboard in
 * production). Nothing secret is written in the source code.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const env = process.env;
const IS_PROD = env.NODE_ENV === 'production';
const IS_TEST = env.NODE_ENV === 'test';
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v)));
const list = (v) => String(v || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);

const config = {
  IS_PROD, IS_TEST,
  PORT: int(env.PORT, 5000),
  /** MongoDB Atlas connection string, e.g. mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/gift_inventory */
  MONGODB_URI: env.MONGODB_URI || '',
  /** Database name when the connection string has none. */
  MONGODB_DB: env.MONGODB_DB || '',
  JWT_SECRET: env.JWT_SECRET || '',
  JWT_EXPIRES_IN: env.JWT_EXPIRES_IN || '12h',
  BCRYPT_ROUNDS: Math.min(14, Math.max(10, int(env.BCRYPT_ROUNDS, 12))),
  /** Frontend address(es) allowed to call the API (CORS). Comma separated. */
  FRONTEND_URLS: list(env.FRONTEND_URL || (IS_PROD ? '' : 'http://localhost:5173')),
  /** Also allow every https://<name>.vercel.app preview address of the project (optional). */
  ALLOW_VERCEL_PREVIEWS: bool(env.ALLOW_VERCEL_PREVIEWS, false),
  /** The admin account created when the database is empty (and restored after a backup restore). */
  ADMIN_EMAIL: String(env.ADMIN_EMAIL || '').trim().toLowerCase(),
  ADMIN_PASSWORD: env.ADMIN_PASSWORD || '',
  /** Load the starting data (promoters, shops, gifts, models, brands) into an EMPTY database. */
  SEED_DATA: bool(env.SEED_DATA, true),
  /** Business time zone for "today", days and months in reports (Pakistan). */
  TZ: env.TZ || 'Asia/Karachi',
  TRUST_PROXY: bool(env.TRUST_PROXY, IS_PROD),
  MAX_PHOTO_MB: int(env.MAX_PHOTO_MB, 6),
  RESTORE_MAX_MB: int(env.RESTORE_MAX_MB, 100),
  AUDIT_MAX: int(env.AUDIT_MAX, 20000),
  /** How often (ms) a request re-checks the data revision in MongoDB. 0 = before every request. */
  FRESH_CHECK_MS: int(env.FRESH_CHECK_MS, 0),
  LOGIN_RATE_LIMIT: int(env.LOGIN_RATE_LIMIT, 30),
  API_RATE_LIMIT: int(env.API_RATE_LIMIT, 3000), // requests per minute per IP address
};

/** Stop with a clear message when a required setting is missing. */
config.validate = () => {
  const errs = [];
  if (!config.MONGODB_URI) errs.push('MONGODB_URI is missing. Put your MongoDB Atlas connection string in backend/.env (see .env.example).');
  else if (!/^mongodb(\+srv)?:\/\//.test(config.MONGODB_URI)) errs.push('MONGODB_URI must start with mongodb+srv:// or mongodb://');
  if (!config.JWT_SECRET) errs.push('JWT_SECRET is missing. Use a long random value (at least 32 characters).');
  else if (config.JWT_SECRET.length < 32) errs.push('JWT_SECRET is too short. Use at least 32 characters.');
  if (/change[-_ ]?me|your[_-]?secret|^secret$/i.test(config.JWT_SECRET)) errs.push('JWT_SECRET still has the example value. Use your own random value.');
  if (IS_PROD && !config.FRONTEND_URLS.length) errs.push('FRONTEND_URL is missing (the address of your Vercel frontend).');
  return errs;
};

module.exports = config;
