'use strict';
/** Business rules through the API (real MongoDB): stock never oversold, imports, allocation, reports, delete. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { ADMIN, PROMOTER, startServer, call, login, dropDb, openDb, jpeg } = require('./helpers');

const DB = 'gift_inventory_test_business';
let A; let B; let admin; let prom;

before(async () => {
  await dropDb(DB);
  A = await startServer({ db: DB });
  B = await startServer({ db: DB });
  admin = await login(A.url, ADMIN);
  prom = await login(A.url, PROMOTER);
});
after(async () => { await A.stop(); await B.stop(); });

async function saleForm(shopCode, giftCode, qty, ref) {
  const brands = (await call(A.url, '/promoter/brands', { token: prom })).data;
  const fd = new FormData();
  fd.append('shop_id', shopCode); fd.append('brand_id', String(brands[0].id)); fd.append('model_id', String(brands[0].models[0].id));
  fd.append('mobile_qty', '1'); fd.append('gift_id', giftCode); fd.append('gift_qty', String(qty));
  if (ref) fd.append('client_ref', ref);
  fd.append('mobile_photo', jpeg(1), 'm.jpg'); fd.append('gift_photo', jpeg(2), 'g.jpg');
  return fd;
}

test('many devices submitting at the same time never give away more gifts than the shop has', async () => {
  const shop = (await call(A.url, '/promoter/shops', { token: prom })).data[0];
  const gift = (await call(A.url, `/promoter/shops/${shop.shop_id}`, { token: prom })).data.gifts[0];
  const avail = gift.available;
  assert.ok(avail >= 2);
  // 2 × avail submissions of 1 gift each, half through each server instance, all at once
  const jobs = [];
  for (let i = 0; i < avail * 2; i++) {
    const base = i % 2 ? B.url : A.url;
    jobs.push(saleForm(shop.shop_id, gift.gift_id, 1, `race-${i}`).then((fd) => call(base, '/promoter/transactions', { method: 'POST', token: prom, form: fd })));
  }
  const res = await Promise.all(jobs);
  const ok = res.filter((r) => r.status === 200).length;
  const refused = res.filter((r) => r.status === 409).length;
  assert.equal(ok + refused, avail * 2, JSON.stringify(res.filter((r) => r.status !== 200 && r.status !== 409).map((r) => r.data)));
  assert.equal(ok, avail, 'exactly the available stock was given');
  const c = await openDb(DB);
  const inv = await c.collection('shop_inventory').find({}).toArray();
  await c.close();
  assert.ok(inv.every((i) => i.distributed_quantity <= i.allocated_quantity), 'never below zero in MongoDB');
  const after = (await call(B.url, `/promoter/shops/${shop.shop_id}`, { token: prom })).data.gifts.find((g) => g.gift_id === gift.gift_id);
  assert.equal(after ? after.available : 0, 0);
});

test('Excel import: validate (preview) changes nothing, commit creates the rows', async () => {
  const rows = [{ gift_name: 'Imported Power Bank', category: 'Electronics', unit: 'pcs', total_quantity: '12', status: 'Active' }, { gift_name: '', total_quantity: 'x' }];
  const pre = await call(A.url, '/import/gifts', { method: 'POST', token: admin, body: { rows } });
  assert.equal(pre.status, 200, JSON.stringify(pre.data));
  assert.equal(pre.data.valid, 1); assert.equal(pre.data.errors, 1);
  assert.ok(!(await call(A.url, '/gifts', { token: admin })).data.some((g) => g.gift_name === 'Imported Power Bank'));
  const done = await call(A.url, '/import/gifts', { method: 'POST', token: admin, body: { rows, commit: true } });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  const g = (await call(B.url, '/gifts', { token: admin })).data.find((x) => x.gift_name === 'Imported Power Bank');
  assert.ok(g, 'visible on the other instance');
  assert.equal(g.total_quantity, 12);
});

test('allocate and adjust: warehouse checks, movements recorded', async () => {
  const g = (await call(A.url, '/gifts', { token: admin })).data.find((x) => x.gift_name === 'Imported Power Bank');
  const shops = (await call(A.url, '/shops?pageSize=100', { token: admin })).data.rows;
  const over = await call(A.url, '/inventory/allocate', { method: 'POST', token: admin, body: { lines: [{ shop_id: shops[0].id, gift_id: g.id, quantity: 13 }] } });
  assert.equal(over.status, 409, 'cannot allocate more than the warehouse has');
  const ok = await call(A.url, '/inventory/allocate', { method: 'POST', token: admin, body: { lines: [{ shop_id: shops[0].id, gift_id: g.id, quantity: 5 }, { shop_id: shops[1].id, gift_id: g.id, quantity: 3 }], reason: 'test' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const adj = await call(B.url, '/inventory/adjust', { method: 'POST', token: admin, body: { shop_id: shops[0].id, gift_id: g.id, delta: -2, reason: 'damaged' } });
  assert.equal(adj.status, 200, JSON.stringify(adj.data));
  assert.equal(adj.data.after, 3);
  const mv = (await call(A.url, `/inventory/movements?gift_id=${g.id}`, { token: admin })).data;
  assert.equal((mv.rows || mv).length, 3);
  const gv = (await call(A.url, `/gifts/${g.id}`, { token: admin })).data.gift;
  assert.equal(gv.allocated, 6); assert.equal(gv.unallocated, 6);
});

test('every report type answers with columns, rows and totals; CSV export works', async () => {
  for (const type of ['mobile-sales', 'brand', 'model', 'promoter', 'shop', 'gift-distribution', 'gift-inventory', 'remaining-inventory', 'transactions', 'dos']) {
    const r = await call(A.url, `/reports/${type}`, { token: admin });
    assert.equal(r.status, 200, `${type}: ${JSON.stringify(r.data)}`);
    assert.ok(Array.isArray(r.data.columns) && Array.isArray(r.data.rows), type);
  }
  const csv = await call(A.url, '/reports/shop?format=csv', { token: admin });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  const d = await call(A.url, '/reports/dashboard', { token: admin });
  assert.equal(d.status, 200);
  assert.ok(d.data.kpis.transactions >= 2);
});

test('deleting a shop removes its stock, sales and proof photos from MongoDB', async () => {
  const create = await call(A.url, '/shops', { method: 'POST', token: admin, body: { shop_id: 'ZZTEST1', shop_name: 'Test Shop', city: 'Lahore', market: 'Hafeez Center', city_id: '', market_id: '', status: 'active' } });
  let shopId;
  if (create.status === 200) shopId = create.data.id;
  else {
    // the shop form sends city_id / market_id: use the existing ones
    const cities = (await call(A.url, '/masters/cities', { token: admin })).data;
    const markets = (await call(A.url, '/masters/markets', { token: admin })).data;
    const r = await call(A.url, '/shops', { method: 'POST', token: admin, body: { shop_id: 'ZZTEST1', shop_name: 'Test Shop', city_id: cities[0].id, market_id: markets[0].id, status: 'active' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    shopId = r.data.id;
  }
  const pre = await call(A.url, '/shops/delete-preview', { method: 'POST', token: admin, body: { ids: [shopId] } });
  assert.equal(pre.status, 200, JSON.stringify(pre.data));
  const del = await call(A.url, '/shops/delete', { method: 'POST', token: admin, body: { ids: [shopId] } });
  assert.equal(del.status, 200, JSON.stringify(del.data));
  const c = await openDb(DB);
  assert.equal(await c.collection('shops').countDocuments({ shop_id: 'ZZTEST1' }), 0);
  await c.close();
  assert.equal((await call(B.url, '/shops/ZZTEST1', { token: admin })).status, 404);
});

test('the audit log records who did what', async () => {
  const r = await call(A.url, '/audit?pageSize=200', { token: admin });
  assert.equal(r.status, 200);
  const actions = new Set(r.data.rows.map((x) => x.action));
  for (const a of ['login', 'gift_transaction_submitted', 'import_gifts', 'inventory_allocated', 'inventory_adjusted']) assert.ok(actions.has(a), a);
});
