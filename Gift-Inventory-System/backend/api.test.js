'use strict';
/**
 * End-to-end API tests against a real MongoDB server and real API server processes.
 * Run: npm test   (needs MongoDB; TEST_MONGODB_URI, default mongodb://127.0.0.1:27017)
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { ADMIN, PROMOTER, PROMOTER2, startServer, call, login, dropDb, openDb, jpeg } = require('./helpers');

const DB = 'gift_inventory_test_api';
let A; // "Device A" server process
let B; // "Device B" — a second server instance on the SAME MongoDB database
let tokenA; let tokenB; let tokenP;

before(async () => {
  await dropDb(DB);
  A = await startServer({ db: DB });
  B = await startServer({ db: DB });
  tokenA = await login(A.url, ADMIN);
  tokenB = await login(B.url, ADMIN);
  tokenP = await login(A.url, PROMOTER);
});
after(async () => { await A.stop(); await B.stop(); });

test('health check reports MongoDB ok', async () => {
  const r = await call(A.url, '/health');
  assert.equal(r.status, 200);
  assert.equal(r.data.database, 'ok');
});

test('empty database gets the admin and the starting data (7 promoters, 7 shops, 4 gifts, 35 each, 5 per shop)', async () => {
  const users = (await call(A.url, '/users', { token: tokenA, query: {} })).data;
  const promoters = users.rows ? users.rows : users;
  const shops = (await call(A.url, '/shops?pageSize=100', { token: tokenA })).data;
  assert.equal(shops.total, 7);
  assert.deepEqual(shops.rows.map((s) => s.shop_id).sort(), ['PK401666', 'PK413401', 'PK413407', 'PK413423', 'PK413432', 'PK413451', 'PK413487']);
  assert.ok(shops.rows.every((s) => s.promoter_name && s.allocated === 20)); // 4 gifts × 5
  const gifts = (await call(A.url, '/gifts', { token: tokenA })).data;
  assert.equal(gifts.length, 4);
  assert.ok(gifts.every((g) => g.total_quantity === 35 && g.allocated === 35));
  assert.ok(Array.isArray(promoters));
  const p = (await call(A.url, '/users?role=promoter', { token: tokenA })).data;
  assert.equal((p.rows || p).length, 7);
});

test('passwords are stored only as hashes in MongoDB (never plain text)', async () => {
  const c = await openDb(DB);
  const users = await c.collection('users').find({}).toArray();
  await c.close();
  assert.ok(users.length >= 8);
  for (const u of users) {
    assert.ok(/^(\$2[aby]\$|pbkdf2\$)/.test(u.password_hash), `hash format for ${u.email}`);
    assert.ok(!JSON.stringify(u).includes(ADMIN.password));
    assert.ok(!JSON.stringify(u).includes(PROMOTER.password));
  }
  const admin = users.find((u) => u.email === ADMIN.email);
  assert.ok(admin.password_hash.startsWith('$2')); // bcrypt
  const wasif = users.find((u) => u.email === PROMOTER.email);
  assert.ok(wasif.password_hash.startsWith('$2'), 'fixed promoter login upgraded to bcrypt at first sign-in');
});

test('API responses never contain password hashes', async () => {
  const r = await call(A.url, '/users?role=promoter', { token: tokenA });
  assert.ok(!JSON.stringify(r.data).includes('password_hash'));
  const me = await call(A.url, '/auth/me', { token: tokenP });
  assert.ok(!JSON.stringify(me.data).includes('password'));
});

test('authentication and role checks are enforced by the backend', async () => {
  assert.equal((await call(A.url, '/gifts')).status, 401); // no token
  assert.equal((await call(A.url, '/gifts', { token: tokenA + 'x' })).status, 401); // bad signature
  assert.equal((await call(A.url, '/gifts', { token: tokenP })).status, 403); // promoter on admin route
  assert.equal((await call(A.url, '/promoter/summary', { token: tokenA })).status, 403); // admin on promoter route
  assert.equal((await call(A.url, '/auth/login', { method: 'POST', body: { email: ADMIN.email, password: 'wrong-pass1' } })).status, 401);
  assert.equal((await call(A.url, '/gifts', { method: 'POST', token: tokenA, body: { gift_name: { $gt: '' }, total_quantity: 1 } })).status, 400);
  assert.equal((await call(A.url, '/gifts', { method: 'POST', token: tokenA, body: { $where: 'x', gift_name: 'A' } })).status, 400);
});

test('two devices: A adds a gift → B sees it; B edits → A sees the change (data shared through MongoDB)', async () => {
  const add = await call(A.url, '/gifts', { method: 'POST', token: tokenA, body: { gift_name: 'Infinix Phone', category: 'Phone', unit: 'pcs', total_quantity: 10, status: 'active' } });
  assert.equal(add.status, 200, JSON.stringify(add.data));
  const id = add.data.id;
  // Device B (another server instance, same database)
  const seenByB = (await call(B.url, '/gifts', { token: tokenB })).data.find((g) => g.id === id);
  assert.ok(seenByB, 'B sees the gift added on A');
  assert.equal(seenByB.total_quantity, 10);
  const edit = await call(B.url, `/gifts/${id}`, { method: 'PUT', token: tokenB, body: { gift_name: 'Infinix Phone', category: 'Phone', unit: 'pcs', total_quantity: 25, status: 'active', expected_updated_at: seenByB.updated_at } });
  assert.equal(edit.status, 200, JSON.stringify(edit.data));
  const seenByA = (await call(A.url, '/gifts', { token: tokenA })).data.find((g) => g.id === id);
  assert.equal(seenByA.total_quantity, 25, 'A sees the edit made on B');
  // and it is really in MongoDB
  const c = await openDb(DB);
  const doc = await c.collection('gifts').findOne({ id });
  await c.close();
  assert.equal(doc.total_quantity, 25);
  assert.equal(doc.gift_name, 'Infinix Phone');
});

test('an edit based on old data is refused with 409 (no silent overwrite)', async () => {
  const g = (await call(A.url, '/gifts', { token: tokenA })).data.find((x) => x.gift_name === 'Infinix Phone');
  const old = g.updated_at;
  await new Promise((r) => setTimeout(r, 1100));
  const ok = await call(A.url, `/gifts/${g.id}`, { method: 'PUT', token: tokenA, body: { ...g, total_quantity: 26, expected_updated_at: old } });
  assert.equal(ok.status, 200);
  const stale = await call(B.url, `/gifts/${g.id}`, { method: 'PUT', token: tokenB, body: { ...g, total_quantity: 30, expected_updated_at: old } });
  assert.equal(stale.status, 409);
});

test('Socket.IO: the other device is told at once when data changes', async () => {
  const sock = io(A.url, { auth: { token: tokenA }, transports: ['websocket'] });
  await new Promise((res, rej) => { sock.on('hello', res); sock.on('connect_error', rej); });
  const got = new Promise((res) => sock.on('data:changed', res));
  const r = await call(A.url, '/masters/cities', { method: 'POST', token: tokenA, clientId: 'device-b-tab', body: { city_name: 'Karachi' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const msg = await got;
  assert.equal(msg.client, 'device-b-tab');
  assert.ok(typeof msg.v === 'number');
  assert.ok(!('city_name' in msg)); // events carry no business data
  sock.close();
  // without a valid token the socket is refused
  const bad = io(A.url, { auth: { token: 'nope' }, transports: ['websocket'], reconnection: false });
  const err = await new Promise((res) => bad.on('connect_error', res));
  assert.match(String(err.message), /unauthorized/);
  bad.close();
});

test('sync revision moves on after a write (polling fallback) on every instance', async () => {
  const v1 = (await call(B.url, '/sync', { token: tokenB })).data.version;
  await call(A.url, '/masters/cities', { method: 'POST', token: tokenA, body: { city_name: 'Islamabad' } });
  const v2 = (await call(B.url, '/sync', { token: tokenB })).data.version;
  assert.ok(v2 > v1);
});

test('promoter sale with two photos: stock deducted at once, photos stored in MongoDB, admin sees it', async () => {
  const shops = (await call(A.url, '/promoter/shops', { token: tokenP })).data;
  assert.ok(shops.length >= 1);
  const shop = shops[0];
  const detail = (await call(A.url, `/promoter/shops/${shop.shop_id}`, { token: tokenP })).data;
  const gift = detail.gifts[0];
  const brands = (await call(A.url, '/promoter/brands', { token: tokenP })).data;
  const brand = brands[0]; const model = brand.models[0];
  const fd = new FormData();
  fd.append('shop_id', shop.shop_id); fd.append('brand_id', String(brand.id)); fd.append('model_id', String(model.id));
  fd.append('mobile_qty', '1'); fd.append('gift_id', gift.gift_id); fd.append('gift_qty', '2'); fd.append('client_ref', 'test-ref-1');
  fd.append('mobile_photo', jpeg(1), 'm.jpg'); fd.append('gift_photo', jpeg(2), 'g.jpg');
  const r = await call(A.url, '/promoter/transactions', { method: 'POST', token: tokenP, form: fd });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const code = r.data.transaction_id;
  assert.match(code, /^TXN-\d{7}$/);
  // admin on the other instance sees the sale, final at once (no approval)
  const t = await call(B.url, `/transactions/${code}`, { token: tokenB });
  assert.equal(t.status, 200);
  assert.equal(t.data.transaction.status, 'approved');
  assert.equal(t.data.stock.distributed, 2);
  // the photo comes back
  const ph = await call(B.url, `/files/transactions/${code}/photo`, { token: tokenB });
  assert.equal(ph.status, 200);
  assert.equal(ph.buf[0], 0xff);
  // another promoter may not see it
  const tokenP2 = await login(A.url, PROMOTER2);
  assert.equal((await call(A.url, `/files/transactions/${code}/photo`, { token: tokenP2 })).status, 403);
  // stored in MongoDB
  const c = await openDb(DB);
  assert.equal(await c.collection('stored_files').countDocuments({ key: { $regex: `^photos/${code}-` } }), 2);
  const inv = await c.collection('shop_inventory').findOne({ id: (await c.collection('shop_inventory').findOne({ shop_id: shop.id === undefined ? detail.shop.id : shop.id, gift_id: { $exists: true } })).id });
  await c.close();
  assert.ok(inv);
  // the same submission again (retry on a bad network) does not count twice
  const fd2 = new FormData();
  for (const [k, v] of fd.entries()) fd2.append(k, v);
  const again = await call(A.url, '/promoter/transactions', { method: 'POST', token: tokenP, form: fd2 });
  assert.equal(again.data.duplicate, true);
  // more gifts than available is refused
  const fd3 = new FormData();
  for (const [k, v] of fd.entries()) if (k !== 'gift_qty' && k !== 'client_ref') fd3.append(k, v);
  fd3.append('gift_qty', '999');
  const over = await call(A.url, '/promoter/transactions', { method: 'POST', token: tokenP, form: fd3 });
  assert.equal(over.status, 409);
  assert.match(over.data.error, /Insufficient Gift Inventory/);
});

test('data survives a server restart (it is read back from MongoDB)', async () => {
  const before = (await call(A.url, '/system/backup?photos=no', { token: tokenA }));
  assert.equal(before.status, 200);
  await A.stop();
  A = await startServer({ db: DB });
  tokenA = await login(A.url, ADMIN);
  const after = (await call(A.url, '/system/backup?photos=no', { token: tokenA }));
  const s1 = before.data.state; const s2 = after.data.state;
  assert.match(before.headers.get('content-disposition'), /attachment; filename="gift-inventory-backup-/);
  for (const k of ['users', 'cities', 'markets', 'shops', 'gifts', 'inv', 'txns', 'moves', 'models', 'brands']) {
    const strip = (rows) => rows.map((r) => { const x = { ...r }; if (k === 'users') { delete x.last_login_at; delete x.password_hash; } return x; });
    assert.deepEqual(strip(s2[k]), strip(s1[k]), `collection ${k} is identical after reload`);
  }
  assert.deepEqual(s2.seq, { ...s1.seq, id_audit: s2.seq.id_audit });
  assert.deepEqual(s2.flags, s1.flags);
});

test('CORS: the configured frontend may call the API, other websites may not', async () => {
  const ok = await fetch(A.url + '/api/health', { headers: { Origin: 'https://gift-app.vercel.app' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://gift-app.vercel.app');
  const pre = await fetch(A.url + '/api/gifts', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  assert.ok(pre.status === 204 || pre.status === 200);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  const bad = await fetch(A.url + '/api/health', { headers: { Origin: 'https://evil.example.com' } });
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('routes also work without the /api prefix (VITE_API_URL set without /api)', async () => {
  const pre = await fetch(A.url + '/auth/login', { method: 'OPTIONS', headers: { Origin: 'https://gift-app.vercel.app', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-client-id' } });
  assert.ok(pre.status === 204 || pre.status === 200);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://gift-app.vercel.app');
  const r = await fetch(A.url + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://gift-app.vercel.app' }, body: JSON.stringify({ email: ADMIN.email, password: ADMIN.password }) });
  assert.equal(r.status, 200);
  assert.ok((await r.json()).token);
});

test('security headers (Helmet) are set', async () => {
  const r = await fetch(A.url + '/api/health');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.ok(r.headers.get('content-security-policy'));
});

test('deactivating a promoter ends their sign-in at once', async () => {
  const tokenP2 = await login(A.url, PROMOTER2);
  const list = (await call(A.url, '/users?role=promoter', { token: tokenA })).data;
  const u = (list.rows || list).find((x) => x.email === PROMOTER2.email);
  assert.equal((await call(B.url, `/users/${u.id}/status`, { method: 'PATCH', token: tokenB, body: { status: 'inactive' } })).status, 200);
  assert.equal((await call(A.url, '/promoter/summary', { token: tokenP2 })).status, 401);
  assert.equal((await call(A.url, '/auth/login', { method: 'POST', body: PROMOTER2 })).status, 403);
  await call(A.url, `/users/${u.id}/status`, { method: 'PATCH', token: tokenA, body: { status: 'active' } });
  assert.ok(await login(A.url, PROMOTER2));
});
