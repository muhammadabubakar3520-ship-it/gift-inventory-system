'use strict';
const rateLimit = require('express-rate-limit');
const config = require('../config/env');

/** Sign-in attempts per IP address (plus a per-email limit inside the login logic). */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.LOGIN_RATE_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts from this network. Try again in a few minutes.' },
});

/** General API limit per IP address (generous: many devices can share one office / mobile network IP). */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.IS_TEST ? 100000 : config.API_RATE_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

module.exports = { loginLimiter, apiLimiter };
