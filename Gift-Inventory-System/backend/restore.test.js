'use strict';
/**
 * Moving data in from the earlier HTML app: restore its backup file into MongoDB.
 * The fixture (test/fixtures/html-app-backup.json) was made with the HTML app's own engine
 * (demo shops, test logins, sales with photos, one old "open" sale from before approval was removed).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ADMIN, PROMOTER, startServer, call, login, dropDb, openDb } = require('./helpers');

const DB = 'gift_inventory_test_restore';
const FIXTURE = path.join(__dirname, 'fixtures', 'html-app-backup.json');
const backup = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
let A; let token;

before(async () => {
  await dropDb(DB);
  A = await startServer({ db: DB, env: { SEED_DATA: 'false' } });
  token = await login(A.url, ADMIN);
});
after(async () => { await A.stop(); });

test('restore an HTML-app backup into MongoDB', async () => {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(FIXTURE)], { type: 'application/json' }), 'backup.json');
  const r = await call(A.url, '/system/restore', { method: 'POST', token, form: fd });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.transactions, backup.state.txns.length);
  assert.equal(r.data.photos, Object.keys(backup.files).length);
  // every sign-in from before the restore has ended
  assert.equal((await call(A.url, '/gifts', { token })).status, 401);
});

test('after the restore: server admin signs in, old default admin is switched off, promoters sign in', async () => {
  token = await login(A.url, ADMIN);
  const old = await call(A.url, '/auth/login', { method: 'POST', body: { email: 'admin@company.com', password: 'Admin@123' } });
  assert.equal(old.status, 403);
  const p = await call(A.url, '/auth/login', { method: 'POST', body: PROMOTER });
  assert.equal(p.status, 200);
});

test('all records and all their fields are in MongoDB (nothing dropped)', async () => {
  const c = await openDb(DB);
  const map = { users: 'users', cities: 'cities', markets: 'markets', shops: 'shops', gifts: 'gifts', inv: 'shop_inventory', txns: 'transactions', moves: 'inventory_movements', models: 'phone_models', brands: 'brands' };
  for (const [key, coll] of Object.entries(map)) {
    const docs = await c.collection(coll).find({}).toArray();
    assert.equal(docs.length, backup.state[key].length + (key === 'users' ? 1 : 0), `${coll} count`); // + the server admin (ADMIN_EMAIL)
    for (const row of backup.state[key]) {
      const d = docs.find((x) => x.id === row.id);
      assert.ok(d, `${coll} id ${row.id}`);
      for (const [k, v] of Object.entries(row)) {
        if (v === undefined) continue;
        if (key === 'users' && ['token_version', 'password_hash', 'status', 'updated_at', 'last_login_at'].includes(k)) continue; // changed on purpose by the restore
        if (key === 'txns' && k === 'status') continue; // open sale made final
        if (key === 'inv' && ['distributed_quantity', 'pending_quantity', 'updated_at'].includes(k)) continue;
        assert.deepEqual(d[k], v, `${coll} ${row.id}.${k}`);
      }
    }
  }
  const files = await c.collection('stored_files').countDocuments({});
  assert.equal(files, Object.keys(backup.files).length);
  await c.close();
});

test('the old open sale became final and its gifts were deducted (no approval process)', async () => {
  const open = backup.state.txns.find((t) => t.status === 'pending');
  const t = await call(A.url, `/transactions/${open.transaction_id}`, { token });
  assert.equal(t.data.transaction.status, 'approved');
  assert.equal(t.data.stock.pending, 0);
  const photo = await call(A.url, `/files/transactions/${open.transaction_id}/mobile-photo`, { token });
  assert.equal(photo.status, 200);
  assert.deepEqual(photo.buf, Buffer.from(backup.files[open.mobile_photo_path].split(',')[1], 'base64'));
});

test('a backup made by this server can be opened again (same format as the HTML app)', async () => {
  const b = await call(A.url, '/system/backup', { token });
  assert.equal(b.data.app, 'gift-inventory');
  assert.equal(b.data.format, 2);
  assert.equal(b.data.state.txns.length, backup.state.txns.length);
  assert.equal(Object.keys(b.data.files).length, Object.keys(backup.files).length);
});

test('a file that is not a backup is refused and changes nothing', async () => {
  const fd = new FormData();
  fd.append('file', new Blob(['{"hello":1}'], { type: 'application/json' }), 'x.json');
  const r = await call(A.url, '/system/restore', { method: 'POST', token, form: fd });
  assert.equal(r.status, 400);
  assert.equal((await call(A.url, '/gifts', { token })).status, 200);
});

test('a restore where two shops swap their Shop IDs works (unique IDs move between records)', async () => {
  const swapped = JSON.parse(JSON.stringify(backup));
  const [a, b] = swapped.state.shops;
  [a.shop_id, b.shop_id] = [b.shop_id, a.shop_id];
  const fd = new FormData();
  fd.append('file', new Blob([JSON.stringify(swapped)], { type: 'application/json' }), 'swapped.json');
  const r = await call(A.url, '/system/restore', { method: 'POST', token, form: fd });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  token = await login(A.url, ADMIN);
  const c = await openDb(DB);
  assert.equal((await c.collection('shops').findOne({ id: a.id })).shop_id, a.shop_id);
  assert.equal((await c.collection('shops').findOne({ id: b.id })).shop_id, b.shop_id);
  await c.close();
});
