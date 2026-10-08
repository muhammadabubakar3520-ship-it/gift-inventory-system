'use strict';
/** Errors → JSON { error, details } with the right HTTP status. Internal details are never sent. */
const G = require('../services/engine');

function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof G.AppError) return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  if (err && err.name === 'MulterError') {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'The file is too large' : 'The uploaded file could not be read' });
  }
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) return res.status(400).json({ error: 'The request body is not valid JSON' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'The request is too large' });
  if (err && err.message === 'Not allowed by CORS') return res.status(403).json({ error: 'This website is not allowed to use the API (CORS). Add it to FRONTEND_URL.' });
  if (err && (/^(MongoNetworkError|MongoServerSelectionError|MongooseServerSelectionError|MongoNotConnectedError|MongoNetworkTimeoutError)$/.test(String(err.name)) || /ECONNREFUSED|ETIMEDOUT|buffering timed out|connection .* closed/i.test(String(err.message)))) {
    console.error('[db]', err.message);
    return res.status(503).json({ error: 'The database is not reachable right now. Please try again in a moment.' });
  }
  console.error('[error]', req.method, req.originalUrl, err && err.stack ? err.stack : err);
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
}

module.exports = { notFound, errorHandler };
