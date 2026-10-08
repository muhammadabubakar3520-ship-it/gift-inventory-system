'use strict';
/* shops.js — cities & markets, shops, shop QR codes, promoter assignment, delete. */
module.exports = function register(G) {
  const { S, IX, R } = G;
  const A = () => G.Analytics;

  /* ---------- cities & markets ---------- */
  R('GET', '/masters/cities', 'admin', () => S.cities.map((c) => ({ id: c.id, city_name: c.city_name,
    market_count: S.markets.filter((m) => m.city_id === c.id).length, shop_count: S.shops.filter((s) => s.city_id === c.id).length }))
    .sort((a, b) => a.city_name.localeCompare(b.city_name)));
  R('POST', '/masters/cities', 'admin', ({ body, user }) => {
    const name = G.str(body.city_name, { field: 'City name', required: true, max: 80 });
    if (S.cities.some((c) => G.ieq(c.city_name, name))) throw G.conflict(`City "${name}" already exists`);
    const c = G.insert('cities', { city_name: name, created_at: G.now() });
    G.audit(user, 'city_created', 'city', c.id, { name });
    return c;
  }, { write: true });
  R('PUT', '/masters/cities/:id', 'admin', ({ params, body, user }) => {
    const c = G.byId('cities', params.id); if (!c) throw G.notFound('City');
    const name = G.str(body.city_name, { field: 'City name', required: true, max: 80 });
    if (S.cities.some((x) => x.id !== c.id && G.ieq(x.city_name, name))) throw G.conflict(`City "${name}" already exists`);
    G.audit(user, 'city_updated', 'city', c.id, { from: c.city_name, to: name });
    c.city_name = name;
    return { ok: true };
  }, { write: true });
  R('DELETE', '/masters/cities/:id', 'admin', ({ params, user }) => {
    const c = G.byId('cities', params.id); if (!c) throw G.notFound('City');
    if (S.markets.some((m) => m.city_id === c.id)) throw G.conflict("Remove this city's markets first");
    if (S.shops.some((s) => s.city_id === c.id)) throw G.conflict('This city has shops and cannot be deleted');
    G.remove('cities', c);
    G.audit(user, 'city_deleted', 'city', c.id, { name: c.city_name });
    return { ok: true };
  }, { write: true });
  R('GET', '/masters/markets', 'admin', ({ query }) => S.markets.filter((m) => !query.city_id || m.city_id === Number(query.city_id))
    .map((m) => ({ id: m.id, market_name: m.market_name, city_id: m.city_id, city_name: G.byId('cities', m.city_id).city_name, shop_count: S.shops.filter((s) => s.market_id === m.id).length }))
    .sort((a, b) => a.city_name.localeCompare(b.city_name) || a.market_name.localeCompare(b.market_name)));
  R('POST', '/masters/markets', 'admin', ({ body, user }) => {
    const cityId = G.int(body.city_id, { field: 'City' });
    if (!G.byId('cities', cityId)) throw G.notFound('City');
    const name = G.str(body.market_name, { field: 'Market name', required: true, max: 80 });
    if (S.markets.some((m) => m.city_id === cityId && G.ieq(m.market_name, name))) throw G.conflict(`Market "${name}" already exists in this city`);
    const m = G.insert('markets', { city_id: cityId, market_name: name, created_at: G.now() });
    G.audit(user, 'market_created', 'market', m.id, { name, cityId });
    return m;
  }, { write: true });
  R('PUT', '/masters/markets/:id', 'admin', ({ params, body, user }) => {
    const m = G.byId('markets', params.id); if (!m) throw G.notFound('Market');
    const name = G.str(body.market_name, { field: 'Market name', required: true, max: 80 });
    if (S.markets.some((x) => x.id !== m.id && x.city_id === m.city_id && G.ieq(x.market_name, name))) throw G.conflict('Market already exists');
    G.audit(user, 'market_updated', 'market', m.id, { from: m.market_name, to: name });
    m.market_name = name;
    return { ok: true };
  }, { write: true });
  R('DELETE', '/masters/markets/:id', 'admin', ({ params, user }) => {
    const m = G.byId('markets', params.id); if (!m) throw G.notFound('Market');
    if (S.shops.some((s) => s.market_id === m.id)) throw G.conflict('This market has shops and cannot be deleted');
    G.remove('markets', m);
    G.audit(user, 'market_deleted', 'market', m.id, { name: m.market_name });
    return { ok: true };
  }, { write: true });
  /** Find or create a city + market by name (used by imports). */
  G.ensureCityMarket = (cityName, marketName) => {
    let city = S.cities.find((c) => G.ieq(c.city_name, cityName));
    if (!city) city = G.insert('cities', { city_name: cityName, created_at: G.now() });
    let market = S.markets.find((m) => m.city_id === city.id && G.ieq(m.market_name, marketName));
    if (!market) market = G.insert('markets', { city_id: city.id, market_name: marketName, created_at: G.now() });
    return { city, market };
  };

  /* ---------- shops ---------- */
  function filterShops(q) {
    const s = G.like(q.search);
    const totals = G.invTotalsByShop();
    return S.shops.map((x) => G.shopView(x, totals)).filter((x) =>
      (!s || s(x.shop_id, x.shop_name, x.market_name, x.promoter_name)) &&
      (!q.city_id || x.city_id === Number(q.city_id)) && (!q.market_id || x.market_id === Number(q.market_id)) &&
      (q.promoter_id === 'none' ? !x.promoter_id : !q.promoter_id || x.promoter_id === Number(q.promoter_id)) &&
      (!q.status || x.status === q.status));
  }
  G.filterShops = filterShops;
  const SHOP_SORT = { shop_id: 'id', shop_name: 'shop_name', city: 'city_name', market: 'market_name', remaining: 'remaining', distributed: 'distributed', created_at: 'created_at', promoter: 'promoter_name' };
  R('GET', '/shops', 'admin', ({ query }) => {
    const rows = G.sortBy(filterShops(query), SHOP_SORT[query.sort] || 'id', query.dir);
    if (query.all === '1') return { rows, total: rows.length };
    return G.page(query, rows);
  });
  R('GET', '/shops/export.csv', 'admin', ({ query }) => G.csv('shops.csv', [
    { label: 'Shop ID', key: 'shop_id' }, { label: 'Shop Name', key: 'shop_name' }, { label: 'City', key: 'city_name' }, { label: 'Market', key: 'market_name' },
    { label: 'Address', key: 'address' }, { label: 'Promoter ID', key: 'promoter_code' }, { label: 'Promoter', key: 'promoter_name' },
    { label: 'Status', key: 'status' }, { label: 'Allocated', key: 'allocated' }, { label: 'Given', key: 'distributed' }, { label: 'Pending', key: 'pending' },
    { label: 'Remaining', key: 'remaining' }, { label: 'Date Added', value: (r) => G.localStamp(r.created_at) },
  ], G.sortBy(filterShops(query), 'id')));

  /* ---------- QR codes (the QR holds only the Shop ID) ---------- */
  R('GET', '/shops/qr-sheet', 'admin', async ({ query }) => {
    let rows;
    if (query.ids) { const ids = String(query.ids).split(',').map(Number); rows = filterShops({}).filter((s) => ids.includes(s.id)); }
    else rows = filterShops(query);
    rows = G.sortBy(rows, 'id').slice(0, 500);
    const out = [];
    for (const s of rows) out.push({ id: s.id, shop_id: s.shop_id, shop_name: s.shop_name, city_name: s.city_name, market_name: s.market_name, status: s.status,
      promoter_name: s.promoter_name, qr_generated_at: s.qr_generated_at || s.created_at, qr: await G.qrData(s.shop_id) });
    return out;
  });
  R('GET', '/shops/:id/qr.png', 'admin', async ({ params }) => {
    const s = G.findShop(params.id);
    return { __file: await G.dataUrlToBlob(await G.qrData(s.shop_id, 600)), filename: `${s.shop_id}-QR.png` };
  });
  R('POST', '/shops/:id/qr/regenerate', 'admin', async ({ params, user }) => {
    const s = G.findShop(params.id);
    s.qr_generated_at = G.now(); s.qr_version = (s.qr_version || 1) + 1; s.updated_at = G.now();
    G.audit(user, 'qr_regenerated', 'shop', s.shop_id, { version: s.qr_version });
    return { ok: true, shop_id: s.shop_id, qr_generated_at: s.qr_generated_at, qr: await G.qrData(s.shop_id) };
  }, { write: true });
  R('POST', '/shops/qr/log', 'admin', ({ body, user }) => {
    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isInteger).slice(0, 500) : [];
    const codes = ids.map((id) => G.byId('shops', id)).filter(Boolean).map((s) => s.shop_id);
    G.audit(user, body.action === 'download' ? 'qr_downloaded' : 'qr_printed', 'shop', codes.length === 1 ? codes[0] : null, { shops: codes.slice(0, 50), count: codes.length });
    return { ok: true };
  }, { write: true });

  R('GET', '/shops/:id', 'admin', async ({ params }) => {
    const s = G.shopView(G.findShop(params.id));
    const inventory = S.inv.filter((i) => i.shop_id === s.id).map(G.invView).sort((a, b) => a.gift_name.localeCompare(b.gift_name));
    const all = S.txns.filter((t) => t.shop_id === s.id);
    const transactions = all.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20).map(G.txnView);
    const sold = all.filter(G.isCounted).map(G.txnView);
    const movements = S.moves.filter((m) => m.shop_id === s.id).slice(-20).reverse().map((m) => ({ ...m, gift_name: G.byId('gifts', m.gift_id).gift_name, user_name: m.user_id ? (G.byId('users', m.user_id) || {}).name : null }));
    return { shop: s, inventory, transactions, movements, qr: await G.qrData(s.shop_id),
      sales: { summary: A().summary(sold), brands: A().brandTree(sold), gifts: A().byGift(sold) } };
  });
  function readShopBody(body) {
    const out = {
      shop_id: G.shopCodeOf(body.shop_id, false),
      shop_name: G.str(body.shop_name, { field: 'Shop name', required: true, max: 120 }),
      city_id: G.int(body.city_id, { field: 'City' }), market_id: G.int(body.market_id, { field: 'Market' }),
      address: G.str(body.address, { field: 'Address', max: 250 }),
      promoter_id: body.promoter_id ? G.int(body.promoter_id, { field: 'Promoter' }) : null,
      status: G.oneOf(body.status, ['active', 'inactive'], { field: 'Status', dflt: 'active' }),
    };
    const m = G.byId('markets', out.market_id); if (!m) throw G.notFound('Market');
    if (m.city_id !== out.city_id) throw G.bad('The selected market does not belong to the selected city');
    if (out.promoter_id) {
      const p = G.byId('users', out.promoter_id);
      if (!p || p.role !== 'promoter') throw G.notFound('Promoter');
      if (p.status !== 'active') throw G.bad('The selected promoter is inactive');
    }
    return out;
  }
  R('POST', '/shops', 'admin', ({ body, user }) => {
    const b = readShopBody(body);
    const dup = S.shops.find((s) => G.ieq(s.shop_name, b.shop_name) && s.market_id === b.market_id);
    if (dup) throw G.conflict(`A shop with this name already exists in this market (${dup.shop_id})`);
    if (b.shop_id && S.shops.some((s) => G.ieq(s.shop_id, b.shop_id))) throw G.conflict(`Shop ID ${b.shop_id} is already used by another shop`);
    const code = b.shop_id || G.freeCode('shop', (c) => S.shops.some((s) => G.ieq(s.shop_id, c)));
    delete b.shop_id;
    const s = G.insert('shops', { shop_id: code, ...b, owner_name: null, contact: null, qr_generated_at: G.now(), qr_version: 1, created_at: G.now(), updated_at: G.now() });
    G.audit(user, 'shop_created', 'shop', s.shop_id, b);
    G.audit(user, 'qr_generated', 'shop', s.shop_id);
    return G.shopView(s);
  }, { write: true });
  R('PUT', '/shops/:id', 'admin', ({ params, body, user }) => {
    const s = G.findShop(params.id);
    const b = readShopBody(body);
    const dup = S.shops.find((x) => x.id !== s.id && G.ieq(x.shop_name, b.shop_name) && x.market_id === b.market_id);
    if (dup) throw G.conflict(`A shop with this name already exists in this market (${dup.shop_id})`);
    if (!b.shop_id) b.shop_id = s.shop_id;
    const newCode = b.shop_id !== s.shop_id;
    if (newCode && S.shops.some((x) => x.id !== s.id && G.ieq(x.shop_id, b.shop_id))) throw G.conflict(`Shop ID ${b.shop_id} is already used by another shop`);
    if (newCode) { b.qr_generated_at = G.now(); b.qr_version = (s.qr_version || 1) + 1; }
    const changes = {};
    for (const k of Object.keys(b)) if (String(b[k] ?? '') !== String(s[k] ?? '')) changes[k] = { from: s[k], to: b[k] };
    const oldCode = s.shop_id;
    Object.assign(s, b, { updated_at: G.now() });
    G.audit(user, 'shop_updated', 'shop', s.shop_id, changes);
    if (newCode) G.audit(user, 'qr_generated', 'shop', s.shop_id, { reason: 'Shop ID changed', from: oldCode });
    return G.shopView(s);
  }, { write: true });
  R('PATCH', '/shops/:id/status', 'admin', ({ params, body, user }) => {
    const s = G.findShop(params.id);
    const status = G.oneOf(body.status, ['active', 'inactive'], { field: 'Status', required: true });
    s.status = status; s.updated_at = G.now();
    G.audit(user, status === 'active' ? 'shop_activated' : 'shop_deactivated', 'shop', s.shop_id);
    return { ok: true, status };
  }, { write: true });

  /* ---------- promoter assignment ---------- */
  R('POST', '/shops/bulk-assign', 'admin', ({ body, user }) => {
    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isInteger) : [];
    if (!ids.length) throw G.bad('Select at least one shop');
    const pid = body.promoter_id ? G.int(body.promoter_id, { field: 'Promoter' }) : null;
    let p = null;
    if (pid) { p = G.byId('users', pid); if (!p || p.role !== 'promoter' || p.status !== 'active') throw G.bad('Promoter not found or inactive'); }
    const changed = [];
    for (const id of ids) {
      const s = G.byId('shops', id);
      if (s && s.promoter_id !== pid) { changed.push({ shop: s.shop_id, from: s.promoter_id ? (G.byId('users', s.promoter_id) || {}).user_code : null }); s.promoter_id = pid; s.updated_at = G.now(); }
    }
    G.audit(user, 'shops_assigned', 'shop', changed.length === 1 ? changed[0].shop : null, { count: changed.length, promoter: p ? p.user_code : 'unassigned', shops: changed.slice(0, 50) });
    return { ok: true, updated: changed.length };
  }, { write: true });

  /* ---------- delete ---------- */
  function deletePlan(ids) {
    const shops = ids.map((id) => G.byId('shops', id)).filter(Boolean);
    if (!shops.length) throw G.notFound('Shop');
    return shops.map((s) => {
      const tx = S.txns.filter((t) => t.shop_id === s.id);
      const inv = S.inv.filter((i) => i.shop_id === s.id);
      return { s, shop_id: s.shop_id, shop_name: s.shop_name, transactions: tx.length, pending: tx.filter((t) => A().isOpen(t.status)).length,
        return_to_warehouse: inv.reduce((a, i) => a + i.allocated_quantity - i.distributed_quantity - i.pending_quantity, 0), distributed: inv.reduce((a, i) => a + i.distributed_quantity, 0) };
    });
  }
  const readIds = (body) => {
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(Number).filter(Number.isInteger))].slice(0, 5000) : [];
    if (!ids.length) throw G.bad('Select at least one shop');
    return ids;
  };
  R('POST', '/shops/delete-preview', 'admin', ({ body }) => {
    const plan = deletePlan(readIds(body));
    return { shops: plan.length, transactions: G.sum(plan, 'transactions'), return_to_warehouse: G.sum(plan, 'return_to_warehouse'), distributed: G.sum(plan, 'distributed'),
      blocked: plan.filter((x) => x.pending > 0).map((x) => ({ shop_id: x.shop_id, shop_name: x.shop_name, pending: x.pending })) };
  });
  R('POST', '/shops/delete', 'admin', async ({ body, user }) => {
    const plan = deletePlan(readIds(body));
    const blocked = plan.filter((x) => x.pending > 0);
    if (blocked.length) throw G.conflict(`${blocked.length} shop(s) have submissions waiting for review (${blocked.slice(0, 5).map((x) => x.shop_id).join(', ')}${blocked.length > 5 ? '…' : ''}). Approve or reject them first.`);
    const ids = new Set(plan.map((x) => x.s.id));
    const photoKeys = new Set();
    // gifts already given to customers have left the company — take them off the warehouse total
    for (const i of S.inv) if (ids.has(i.shop_id) && i.distributed_quantity > 0) { const g = G.byId('gifts', i.gift_id); g.total_quantity -= i.distributed_quantity; g.updated_at = G.now(); }
    for (const t of S.txns) if (ids.has(t.shop_id)) { photoKeys.add(t.photo_path); photoKeys.add(t.mobile_photo_path); }
    S.txns = S.txns.filter((t) => !ids.has(t.shop_id));
    S.moves = S.moves.filter((m) => !ids.has(m.shop_id));
    S.inv = S.inv.filter((i) => !ids.has(i.shop_id));
    S.shops = S.shops.filter((s) => !ids.has(s.id));
    G.reindex();
    const stillUsed = new Set(S.txns.flatMap((t) => [t.photo_path, t.mobile_photo_path]));
    for (const k of photoKeys) if (k && !stillUsed.has(k)) await G.files.fileDel(k);
    for (const x of plan) G.audit(user, 'shop_deleted', 'shop', x.shop_id, { name: x.shop_name, transactions: x.transactions, returned_to_warehouse: x.return_to_warehouse, distributed: x.distributed });
    return { ok: true, deleted: plan.length, transactions: G.sum(plan, 'transactions'), returned_to_warehouse: G.sum(plan, 'return_to_warehouse') };
  }, { write: true });
  void IX;
};
