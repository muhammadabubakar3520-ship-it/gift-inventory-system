'use strict';
/** Two server instances starting at the same moment on an empty database fill it only once. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ADMIN, startServer, call, login, dropDb, openDb } = require('./helpers');

const DB = 'gift_inventory_test_startup';

test('two instances starting together on an empty database seed it once', async () => {
  await dropDb(DB);
  const [a, b] = await Promise.all([startServer({ db: DB }), startServer({ db: DB })]);
  try {
    const c = await openDb(DB);
    assert.equal(await c.collection('users').countDocuments({ role: 'admin' }), 1);
    assert.equal(await c.collection('users').countDocuments({ role: 'promoter' }), 7);
    assert.equal(await c.collection('shops').countDocuments({}), 7);
    assert.equal(await c.collection('gifts').countDocuments({}), 4);
    assert.equal(await c.collection('shop_inventory').countDocuments({}), 28);
    await c.close();
    const t = await login(b.url, ADMIN);
    assert.equal((await call(a.url, '/shops', { token: t })).data.total, 7);
  } finally { await a.stop(); await b.stop(); }
});

test('the server refuses to start without the required settings', async () => {
  await assert.rejects(startServer({ db: DB, env: { JWT_SECRET: 'short' } }), /JWT_SECRET is too short/);
  await assert.rejects(startServer({ db: DB, env: { MONGODB_URI: '' } }), /MONGODB_URI is missing/);
});
