'use strict';
/**
 * Input checks that apply to every request (each route also validates its own fields):
 *  - JSON bodies must be objects; keys starting with "$" or containing "." (MongoDB operators) and
 *    "__proto__" / "constructor" / "prototype" are refused;
 *  - nesting depth and array sizes are limited;
 *  - query parameters must be plain text values.
 */
const G = require('../services/engine');

const BAD_KEY = /^\$|^(__proto__|constructor|prototype)$/;
const MAX_DEPTH = 6;
const MAX_ARRAY = 20000;

function check(v, depth) {
  if (depth > MAX_DEPTH) throw G.bad('Request data is nested too deeply');
  if (Array.isArray(v)) {
    if (v.length > MAX_ARRAY) throw G.bad('Too many rows in one request');
    for (const x of v) check(x, depth + 1);
    return;
  }
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) {
      if (BAD_KEY.test(k)) throw G.bad(`Field name "${k.slice(0, 40)}" is not allowed`);
      check(v[k], depth + 1);
    }
  }
}

function validateInput(req, _res, next) {
  try {
    if (req.body !== undefined && req.body !== null && (typeof req.body !== 'object')) throw G.bad('The request body must be a JSON object');
    if (req.body) check(req.body, 0);
    const q = {};
    for (const [k, v] of Object.entries(req.query || {})) {
      if (BAD_KEY.test(k)) throw G.bad('Invalid query parameter');
      const val = Array.isArray(v) ? v[v.length - 1] : v;
      if (val !== undefined && typeof val !== 'string') throw G.bad(`Query parameter "${k.slice(0, 40)}" is invalid`);
      if (val !== undefined) q[k] = val.slice(0, 2000);
    }
    req.cleanQuery = q;
    for (const [k, v] of Object.entries(req.params || {})) if (typeof v !== 'string' || v.length > 200) throw G.bad(`Invalid ${k}`);
    next();
  } catch (e) { next(e); }
}

module.exports = { validateInput };
