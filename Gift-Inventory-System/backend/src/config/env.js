'use strict';

/**
 * All settings come from environment variables.
 * Local: backend/.env
 * Production: Render Environment Variables
 *
 * Do not put passwords, MongoDB credentials, or JWT secrets directly in this file.
 */

const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '..', '..', '.env'),
  quiet: true
});

const env = process.env;

const IS_PROD = env.NODE_ENV === 'production';
const IS_TEST = env.NODE_ENV === 'test';

const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

const bool = (v, d) => {
  if (v === undefined || v === '') return d;
  return /^(1|true|yes|on)$/i.test(String(v));
};

const list = (v) =>
  String(v || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

const config = {
  IS_PROD,
  IS_TEST,

  // Render provides PORT automatically
  PORT: int(env.PORT, 5000),

  // MongoDB Atlas connection string
  MONGODB_URI: env.MONGODB_URI || '',

  // Optional database name
  MONGODB_DB: env.MONGODB_DB || '',

  // JWT
  JWT_SECRET: env.JWT_SECRET || '',
  JWT_EXPIRES_IN: env.JWT_EXPIRES_IN || '12h',

  // Password hashing
  BCRYPT_ROUNDS: Math.min(
    14,
    Math.max(10, int(env.BCRYPT_ROUNDS, 12))
  ),

  // Vercel frontend URL
  FRONTEND_URLS: list(
    env.FRONTEND_URL ||
    (IS_PROD ? '' : 'http://localhost:5173')
  ),

  // Allow Vercel preview deployments
  ALLOW_VERCEL_PREVIEWS: bool(
    env.ALLOW_VERCEL_PREVIEWS,
    false
  ),

  // Admin account
  ADMIN_EMAIL: String(
    env.ADMIN_EMAIL || ''
  ).trim().toLowerCase(),

  ADMIN_PASSWORD: env.ADMIN_PASSWORD || '',

  // Starting data
  SEED_DATA: bool(env.SEED_DATA, true),

  // Pakistan timezone
  TZ: env.TZ || 'Asia/Karachi',

  // Render proxy
  TRUST_PROXY: bool(env.TRUST_PROXY, IS_PROD),

  // Upload limits
  MAX_PHOTO_MB: int(env.MAX_PHOTO_MB, 6),
  RESTORE_MAX_MB: int(env.RESTORE_MAX_MB, 100),

  // Audit limit
  AUDIT_MAX: int(env.AUDIT_MAX, 20000),

  // Database freshness check
  FRESH_CHECK_MS: int(env.FRESH_CHECK_MS, 0),

  // Rate limits
  LOGIN_RATE_LIMIT: int(env.LOGIN_RATE_LIMIT, 30),
  API_RATE_LIMIT: int(env.API_RATE_LIMIT, 3000)
};

/**
 * Validate required production settings.
 */
config.validate = () => {
  const errs = [];

  // MongoDB
  if (!config.MONGODB_URI) {
    errs.push(
      'MONGODB_URI is missing. Add your MongoDB Atlas connection string to Render Environment Variables.'
    );
  } else if (!/^mongodb(\+srv)?:\/\//.test(config.MONGODB_URI)) {
    errs.push(
      'MONGODB_URI must start with mongodb+srv:// or mongodb://'
    );
  }

  // JWT
  if (!config.JWT_SECRET) {
    errs.push(
      'JWT_SECRET is missing. Use a long random value (at least 32 characters).'
    );
  } else if (config.JWT_SECRET.length < 32) {
    errs.push(
      'JWT_SECRET is too short. Use at least 32 characters.'
    );
  }

  if (
    /change[-_ ]?me|your[_-]?secret|^secret$/i.test(
      config.JWT_SECRET
    )
  ) {
    errs.push(
      'JWT_SECRET still has the example value. Use your own random value.'
    );
  }

  // Frontend
  if (IS_PROD && !config.FRONTEND_URLS.length) {
    errs.push(
      'FRONTEND_URL is missing. Add the URL of your Vercel frontend.'
    );
  }

  return errs;
};

module.exports = config;
