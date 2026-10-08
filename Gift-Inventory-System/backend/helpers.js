'use strict';
/**
 * Test helpers: start real API server processes against a real MongoDB server.
 *   TEST_MONGODB_URI   default mongodb://127.0.0.1:27017  (a local MongoDB, or an Atlas test cluster)
 * Each test file uses its own database, which is dropped before the tests.
 */
const { spawn } = require('child_process');
const path = require('path');
const mongoose = require('mongoose');

const BASE_URI = (process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017').replace(/\/+$/, '');
const ROOT = path.join(__dirname, '..');
const ADMIN = { email: 'admin@test.local', password: 'AdminTest123' };
// test logins (test/fixtures/promoter-logins.test.json) — not the real passwords
const PROMOTER = { email: 'wasifali@company.com', password: 'TestWasifA1' };
const PROMOTER2 = { email: 'm.zeeshan@company.com', password: 'TestMZeesh1' };

const uriFor = (db) => `${BASE_URI}/${db}`;

async function dropDb(db) {
  const c = await mongoose.createConnection(uriFor(db), { serverSelectionTimeoutMS: 10000 }).asPromise();
  await c.dropDatabase();
  await c.close();
}

/** Raw MongoDB access for checks ("is it really in the database?"). */
async function openDb(db) {
  return mongoose.createConnection(uriFor(db), { serverSelectionTimeoutMS: 10000 }).asPromise();
}

let nextPort = 5600 + Math.floor(Math.random() * 300);
function startServer({ db, env = {} } = {}) {
  const port = nextPort++;
  const proc = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, NODE_ENV: 'test', PORT: String(port), MONGODB_URI: uriFor(db),
      JWT_SECRET: 'test-secret-0123456789abcdef0123456789abcdef', FRONTEND_URL: 'http://localhost:5173,https://gift-app.vercel.app',
      ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, BCRYPT_ROUNDS: '10',
      PROMOTER_LOGINS_FILE: path.join(__dirname, 'fixtures', 'promoter-logins.test.json'), ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start:\n' + log)), 30000);
    const onData = (d) => {
      log += d;
      if (log.includes('[api] Gift Inventory API on port')) {
        clearTimeout(t);
        resolve({
          url: `http://127.0.0.1:${port}`, port, proc, log: () => log,
          stop: () => new Promise((r) => { if (proc.exitCode !== null) return r(); proc.once('exit', r); proc.kill('SIGTERM'); }),
        });
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.once('exit', (code) => { clearTimeout(t); reject(new Error(`server exited (${code}):\n${log}`)); });
  });
}

/** fetch wrapper: returns { status, data, headers, buf } */
async function call(base, p, { method = 'GET', token, body, form, clientId, origin, headers: extra } = {}) {
  const headers = { ...(extra || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (clientId) headers['X-Client-Id'] = clientId;
  if (origin) headers.Origin = origin;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + '/api' + p, { method, headers, body: payload });
  const ct = res.headers.get('content-type') || '';
  let data = null; let buf = null;
  if (ct.includes('application/json')) data = await res.json(); else buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, headers: res.headers, buf };
}

async function login(base, who) {
  const r = await call(base, '/auth/login', { method: 'POST', body: who });
  if (r.status !== 200) throw new Error(`login ${who.email} failed: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.token;
}

/** A tiny file that passes the JPEG check. */
const jpeg = (n = 0) => new Blob([Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200 + n, 7)])], { type: 'image/jpeg' });

module.exports = { ADMIN, PROMOTER, PROMOTER2, startServer, call, login, dropDb, openDb, jpeg, uriFor };
