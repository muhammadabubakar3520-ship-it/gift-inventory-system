'use strict';
/* =====================================================================
   transactions.js — one transaction = one mobile sale + the gift given.
     Promoter: verify shop (QR), submit sale with two proof photos.
     Admin:    list, open, Start review, Approve, Reject / Reverse.
   Statuses: Submitted (pending) → Pending Review (review) → Approved | Rejected
   ===================================================================== */
module.exports = function register(G) {
  const { S, R } = G;
  const A = () => G.Analytics;

  /* ---------- admin: list / detail ---------- */
  function filterTxns(q, skipStatus) {
    const s = G.like(q.search);
    const from = G.dayBound(q.from, false); const to = G.dayBound(q.to, true);
    const st = skipStatus ? '' : q.status;
    const rows = S.txns.filter((t) => (!st || st === 'all' || (st === 'open' ? A().isOpen(t.status) : t.status === st)) && (!from || t.created_at >= from) && (!to || t.created_at <= to) &&
      (!q.promoter_id || t.promoter_id === Number(q.promoter_id)) && (!q.gift_id || t.gift_id === Number(q.gift_id)) && (!q.shop_id || t.shop_id === Number(q.shop_id)) && (!q.model_id || t.model_id === Number(q.model_id)))
      .map(G.txnView);
    return A().filter(rows, { brand_id: q.brand_id, city_id: q.city_id, market_id: q.market_id })
      .filter((t) => !s || s(t.transaction_id, t.shop_id, t.shop_name, t.promoter_name, t.model_name, t.item_code, t.brand_name, t.gift_name));
  }
  G.filterTxns = filterTxns;
  const byTime = (dir) => (a, b) => (dir === 'asc' ? 1 : -1) * (a.created_at.localeCompare(b.created_at) || a.id - b.id);
  G.byTime = byTime;

  R('GET', '/transactions', 'admin', ({ query }) => {
    const rows = filterTxns(query).sort(byTime(query.dir === 'asc' ? 'asc' : 'desc'));
    const counts = { pending: 0, review: 0, approved: 0, rejected: 0 };
    for (const t of filterTxns(query, true)) counts[t.status]++;
    counts.open = counts.pending + counts.review;
    return { ...G.page(query, rows), quantity: G.sum(rows, 'quantity'), mobile_units: G.sum(rows, 'mobile_qty'), counts };
  });
  /** All matching rows (for Excel export of the transaction history). */
  R('GET', '/transactions/export', 'admin', ({ query }) => ({ rows: filterTxns(query).sort(byTime('desc')).slice(0, 50000) }));
  const TXN_COLUMNS = [
    { label: 'Transaction ID', key: 'transaction_id' }, { label: 'Date', value: (x) => G.localDay(x.created_at) }, { label: 'Time', value: (x) => G.localTime(x.created_at) },
    { label: 'Promoter ID', key: 'promoter_code' }, { label: 'Promoter Name', key: 'promoter_name' }, { label: 'Shop ID', key: 'shop_id' }, { label: 'Shop Name', key: 'shop_name' },
    { label: 'City', key: 'city_name' }, { label: 'Market', key: 'market_name' }, { label: 'Mobile Brand ID', key: 'brand_code' }, { label: 'Mobile Brand', key: 'brand_name' },
    { label: 'Mobile Model ID', key: 'item_code' }, { label: 'Mobile Model', key: 'model_name' }, { label: 'Mobile Quantity', key: 'mobile_qty' },
    { label: 'Mobile Sale Proof Photo', value: (x) => (x.has_mobile_photo ? `${x.transaction_id}-mobile.jpg` : '') },
    { label: 'Gift ID', key: 'gift_id' }, { label: 'Gift Name', key: 'gift_name' }, { label: 'Gift Quantity', key: 'quantity' },
    { label: 'Gift Proof Photo', value: (x) => (x.has_photo ? `${x.transaction_id}-gift.jpg` : '') },
    { label: 'Status', key: 'status_label' }, { label: 'Created At', value: (x) => G.localStamp(x.created_at) }, { label: 'Approved At', value: (x) => G.localStamp(x.approved_at) },
    { label: 'Approved By', key: 'approved_by_name' }, { label: 'Rejection Reason', key: 'rejection_reason' }, { label: 'Remarks', key: 'remarks' },
  ];
  R('GET', '/transactions/export.csv', 'admin', ({ query }) => G.csv('transactions.csv', TXN_COLUMNS, filterTxns(query).sort(byTime('desc'))));
  R('GET', '/transactions/:code', 'admin', ({ params }) => {
    const raw = S.txns.find((t) => t.transaction_id === params.code); if (!raw) throw G.notFound('Transaction');
    const i = G.invRow(raw.shop_id, raw.gift_id);
    const v = G.txnView(raw);
    const rs = raw.review_started_by ? G.byId('users', raw.review_started_by) : null;
    return { transaction: { ...v, review_started_by_name: rs ? rs.name : null },
      stock: i ? { allocated: i.allocated_quantity, distributed: i.distributed_quantity, pending: i.pending_quantity, remaining: i.allocated_quantity - i.distributed_quantity, available: i.allocated_quantity - i.distributed_quantity - i.pending_quantity } : null };
  });
  // No approval process: sales are final when submitted. There are no review / approve / reject / reverse routes.

  /* ---------- photos ---------- */
  const photoRoute = (field, label) => async ({ params, user }) => {
    const t = S.txns.find((x) => x.transaction_id === params.code); if (!t) throw G.notFound('Transaction');
    if (user.role !== 'admin' && t.promoter_id !== user.id) throw G.forbidden();
    if (!t[field]) throw G.notFound(label);
    const b = await G.files.fileGet(t[field]); if (!b) throw G.notFound(label);
    return { __file: b, filename: `${t.transaction_id}-${field === 'photo_path' ? 'gift' : 'mobile'}.jpg` };
  };
  R('GET', '/files/transactions/:code/photo', 'any', photoRoute('photo_path', 'Gift proof photo'));
  R('GET', '/files/transactions/:code/mobile-photo', 'any', photoRoute('mobile_photo_path', 'Mobile sale proof photo'));
  R('GET', '/files/gifts/:code/image', 'any', async ({ params }) => {
    const g = S.gifts.find((x) => x.gift_id === params.code); if (!g || !g.image_path) throw G.notFound('Image');
    const b = await G.files.fileGet(g.image_path); if (!b) throw G.notFound('Image');
    return { __file: b, filename: `${g.gift_id}` };
  });

  /* =====================================================================
     Promoter
     ===================================================================== */
  function shopGifts(shopPk) {
    return S.inv.filter((i) => i.shop_id === shopPk && i.allocated_quantity > 0).map((i) => {
      const g = G.byId('gifts', i.gift_id);
      return g.status !== 'active' ? null : { gift_id: g.gift_id, gift_name: g.gift_name, unit: g.unit, category: g.category, has_image: !!g.image_path,
        allocated: i.allocated_quantity, distributed: i.distributed_quantity, pending: i.pending_quantity, remaining: i.allocated_quantity - i.distributed_quantity,
        available: i.allocated_quantity - i.distributed_quantity - i.pending_quantity };
    }).filter(Boolean).sort((a, b) => b.available - a.available || a.gift_name.localeCompare(b.gift_name));
  }
  const pShop = (s) => { const v = G.shopView(s); return { id: v.id, shop_id: v.shop_id, shop_name: v.shop_name, address: v.address, status: v.status, city_name: v.city_name, market_name: v.market_name, promoter_name: v.promoter_name, promoter_code: v.promoter_code }; };
  const pTxn = (t) => {
    const v = G.txnView(t);
    return { transaction_id: v.transaction_id, status: v.status, status_label: v.status_label, rejection_reason: v.rejection_reason, remarks: v.remarks, created_at: v.created_at, reviewed_at: v.reviewed_at,
      shop_id: v.shop_id, shop_name: v.shop_name, city_name: v.city_name, market_name: v.market_name, brand_name: v.brand_name, model_name: v.model_name, item_code: v.item_code, mobile_qty: v.mobile_qty,
      gift_id: v.gift_id, gift_name: v.gift_name, unit: v.unit, quantity: v.quantity, has_photo: v.has_photo, has_mobile_photo: v.has_mobile_photo };
  };

  R('GET', '/promoter/shops/:code', 'promoter', ({ params, user }) => {
    const raw = String(params.code || '').trim().toUpperCase();
    if (!raw || raw.length > 40) throw G.bad('This is not a valid Shop QR code. Please scan the QR code of your assigned shop.');
    const s = G.resolveShopCode(raw);
    if (!s) throw G.notFound(`Shop ${raw}`);
    if (s.promoter_id !== user.id) throw G.forbidden('This shop is not assigned to you. Please scan the QR code of your assigned shop.');
    if (s.status !== 'active') throw G.bad(`${s.shop_id} is inactive. Sales cannot be recorded for this shop.`);
    return { shop: pShop(s), gifts: shopGifts(s.id) };
  });
  R('GET', '/promoter/shops', 'promoter', ({ query, user }) => {
    const s = G.like(query.search);
    return S.shops.filter((x) => x.promoter_id === user.id && x.status === 'active').map((x) => {
      const v = pShop(x);
      const available = S.inv.filter((i) => i.shop_id === x.id).reduce((a, i) => a + i.allocated_quantity - i.distributed_quantity - i.pending_quantity, 0);
      const last = S.txns.filter((t) => t.shop_id === x.id && t.promoter_id === user.id).reduce((m, t) => (t.created_at > (m || '') ? t.created_at : m), null);
      return { ...v, available, last_visit: last };
    }).filter((v) => !s || s(v.shop_id, v.shop_name, v.market_name)).sort((a, b) => a.shop_name.localeCompare(b.shop_name)).slice(0, 200);
  });

  /** Submit a sale: mobile sold + gift given, each with its own proof photo. */
  R('POST', '/promoter/transactions', 'promoter', async ({ form, user }) => {
    const f = (k) => (form ? form.get(k) : null);
    const clientRef = G.str(f('client_ref'), { field: 'Reference', max: 64 });
    if (clientRef) { // safe retries on poor networks
      const dup = S.txns.find((t) => t.client_ref === clientRef && t.promoter_id === user.id);
      if (dup) return { ok: true, duplicate: true, transaction_id: dup.transaction_id, ...pTxn(dup) };
    }
    const shopCode = G.str(f('shop_id'), { field: 'Shop', required: true, max: 20 });
    const brandId = G.int(f('brand_id'), { field: 'Mobile brand', min: 1, msg: 'Please select the mobile brand' });
    const modelId = G.int(f('model_id'), { field: 'Mobile model', min: 1, msg: 'Please select the mobile model' });
    const mobileQty = G.int(f('mobile_qty'), { field: 'Mobile quantity', min: 1, max: 10000, msg: 'Mobile quantity must be greater than zero' });
    const giftCode = G.str(f('gift_id'), { field: 'Gift', required: true, max: 20 });
    const quantity = G.int(f('gift_qty') ?? f('quantity'), { field: 'Gift quantity', min: 1, max: 100000, msg: 'Gift quantity must be greater than zero' });
    const remarks = G.str(f('remarks'), { field: 'Remarks', max: 300 });
    const mobilePhoto = await G.readImage(f('mobile_photo'), 'Mobile sale proof photo');
    const giftPhoto = await G.readImage(f('gift_photo') || f('photo'), 'Gift proof photo');
    // every check below runs after the async photo reads, without interruption
    const shop = S.shops.find((x) => G.ieq(x.shop_id, shopCode)); if (!shop) throw G.notFound('Shop');
    if (shop.status !== 'active') throw G.bad('This shop is inactive. Sales cannot be recorded.');
    if (shop.promoter_id !== user.id) throw G.forbidden('This shop is not assigned to you. Please scan the QR code of your assigned shop.');
    const brand = G.byId('brands', brandId); if (!brand) throw G.bad('Please select the mobile brand');
    if (brand.status !== 'active') throw G.bad(`${brand.brand_name} is not active. Select another brand.`);
    const model = G.byId('models', modelId); if (!model) throw G.bad('Please select the mobile model');
    if (model.brand_id !== brand.id) throw G.bad(`${model.model_name} is not a ${brand.brand_name} model. Select the model again.`);
    if (model.status !== 'active') throw G.bad(`${model.model_name} is not active. Select another model.`);
    const gift = S.gifts.find((x) => G.ieq(x.gift_id, giftCode)); if (!gift) throw G.notFound('Gift');
    if (gift.status !== 'active') throw G.bad(`${gift.gift_name} is not active.`);
    const i = G.invRow(shop.id, gift.id);
    const available = i ? i.allocated_quantity - i.distributed_quantity - i.pending_quantity : 0;
    if (quantity > available) {
      const n = Math.max(0, available);
      const name = n === 1 || /s$/i.test(gift.gift_name) ? gift.gift_name : gift.gift_name + 's';
      throw G.conflict(`Insufficient Gift Inventory. Only ${n} ${name} ${n === 1 ? 'is' : 'are'} available for this shop.`, { available: n });
    }
    const code = G.codes.txn();
    const mKey = `photos/${code}-mobile-${G.randHex(5)}`;
    const gKey = `photos/${code}-gift-${G.randHex(5)}`;
    i.distributed_quantity += quantity; i.updated_at = G.now(); // no approval step: deducted at once
    const lat = Number(f('latitude')); const lng = Number(f('longitude'));
    const t = G.insert('txns', { transaction_id: code, shop_id: shop.id, promoter_id: user.id,
      brand_id: brand.id, model_id: model.id, mobile_qty: mobileQty, mobile_photo_path: mKey,
      gift_id: gift.id, quantity, photo_path: gKey,
      status: 'approved', rejection_reason: null, remarks, client_ref: clientRef,
      latitude: Number.isFinite(lat) && f('latitude') ? lat : null, longitude: Number.isFinite(lng) && f('longitude') ? lng : null,
      reviewed_by: null, reviewed_at: null, created_at: G.now() });
    G.audit(user, 'mobile_sale_submitted', 'transaction', code, { shop: shop.shop_id, brand: brand.brand_name, model: model.item_code, quantity: mobileQty });
    G.audit(user, 'gift_transaction_submitted', 'transaction', code, { shop: shop.shop_id, gift: gift.gift_id, quantity });
    await G.files.fileSet(mKey, mobilePhoto);
    await G.files.fileSet(gKey, giftPhoto);
    return { ok: true, transaction_id: code, remaining_available: available - quantity, ...pTxn(t) };
  }, { write: true });

  R('GET', '/promoter/transactions', 'promoter', ({ query, user }) => {
    const st = query.status;
    const rows = S.txns.filter((t) => t.promoter_id === user.id && (!st || (st === 'open' ? A().isOpen(t.status) : t.status === st))).sort(byTime('desc')).map(pTxn);
    return G.page(query, rows, { dflt: 20, max: 100 });
  });
  R('GET', '/promoter/transactions/:code', 'promoter', ({ params, user }) => {
    const t = S.txns.find((x) => x.transaction_id === params.code && x.promoter_id === user.id);
    if (!t) throw G.notFound('Transaction');
    return pTxn(t);
  });

  /* ---------- promoter dashboard ---------- */
  const mine = (user) => S.txns.filter((t) => t.promoter_id === user.id);
  R('GET', '/promoter/summary', 'promoter', ({ user }) => {
    const all = mine(user);
    const sold = all.filter(G.isCounted).map(G.txnView);
    const today = G.today(); const month = today.slice(0, 7);
    const td = sold.filter((t) => G.localDay(t.created_at) === today);
    const mo = sold.filter((t) => G.localMonth(t.created_at) === month);
    return {
      name: user.name, today: A().summary(td), month: A().summary(mo), total: A().summary(sold),
      top_brands: A().byBrand(mo.length ? mo : sold).slice(0, 5).map((b) => ({ brand_name: b.brand_name, units: b.units })), top_brands_period: mo.length ? 'month' : 'all',
      open: all.filter((t) => A().isOpen(t.status)).length, rejected: all.filter((t) => t.status === 'rejected').length,
      active_shops: S.shops.filter((s) => s.promoter_id === user.id && s.status === 'active').length,
      recent: all.slice().sort(byTime('desc')).slice(0, 5).map(pTxn), mode: G.salesMode(),
    };
  });
  /** My Sales: brand-wise (with models) and model-wise, with filters. */
  R('GET', '/promoter/sales', 'promoter', ({ query, user }) => {
    const from = G.dayBound(query.from, false); const to = G.dayBound(query.to, true);
    const rows = A().filter(mine(user).filter((t) => G.isCounted(t) && (!from || t.created_at >= from) && (!to || t.created_at <= to)).map(G.txnView),
      { brand_id: query.brand_id, model_id: query.model_id, shop_id: query.shop_id, city_id: query.city_id, market_id: query.market_id });
    const everything = mine(user).map(G.txnView);
    const opts = (key, label) => [...new Map(everything.filter((t) => t[key]).map((t) => [t[key], { id: t[key], name: label(t) }])).values()].sort((a, b) => a.name.localeCompare(b.name));
    const shops = S.shops.filter((s) => s.promoter_id === user.id).map((s) => G.shopView(s));
    return { summary: A().summary(rows), brands: A().brandTree(rows), models: A().byModel(rows), shops: A().byShop(rows),
      filters: {
        brands: opts('brand_pk', (t) => t.brand_name), models: opts('model_pk', (t) => `${t.model_name}${t.brand_name ? ' · ' + t.brand_name : ''}`),
        shops: [...new Map([...shops.map((s) => [s.id, { id: s.id, name: `${s.shop_name} (${s.shop_id})` }]), ...everything.map((t) => [t.shop_pk, { id: t.shop_pk, name: `${t.shop_name} (${t.shop_id})` }])]).values()],
        cities: [...new Map([...shops.map((s) => [s.city_id, { id: s.city_id, name: s.city_name }]), ...everything.map((t) => [t.city_id, { id: t.city_id, name: t.city_name }])]).values()],
        markets: [...new Map([...shops.map((s) => [s.market_id, { id: s.market_id, name: s.market_name }]), ...everything.map((t) => [t.market_id, { id: t.market_id, name: t.market_name }])]).values()],
      }, mode: G.salesMode() };
  });
  /** My Gifts: quantity given per gift + inventory used at my shops. */
  R('GET', '/promoter/gifts', 'promoter', ({ query, user }) => {
    const from = G.dayBound(query.from, false); const to = G.dayBound(query.to, true);
    const all = mine(user).filter((t) => t.status !== 'rejected' && (!from || t.created_at >= from) && (!to || t.created_at <= to)).map(G.txnView);
    const gifts = A().byGift(all).map((g) => {
      const rows = all.filter((t) => t.gift_pk === g.gift_pk);
      return { ...g, given: g.gifts, approved: G.sum(rows.filter((t) => t.status === 'approved'), 'quantity'), waiting: G.sum(rows.filter((t) => A().isOpen(t.status)), 'quantity') };
    });
    const myShops = S.shops.filter((s) => s.promoter_id === user.id).map((s) => s.id);
    const inv = new Map();
    for (const i of S.inv) {
      if (!myShops.includes(i.shop_id) || !i.allocated_quantity) continue;
      const g = G.byId('gifts', i.gift_id);
      const x = inv.get(g.id) || { gift_id: g.gift_id, gift_name: g.gift_name, unit: g.unit, allocated: 0, given: 0, waiting: 0, remaining: 0, available: 0 };
      x.allocated += i.allocated_quantity; x.given += i.distributed_quantity; x.waiting += i.pending_quantity;
      x.remaining += i.allocated_quantity - i.distributed_quantity; x.available += i.allocated_quantity - i.distributed_quantity - i.pending_quantity;
      inv.set(g.id, x);
    }
    return { gifts, total: G.sum(gifts, 'given'), approved: G.sum(gifts, 'approved'), waiting: G.sum(gifts, 'waiting'),
      inventory: [...inv.values()].sort((a, b) => a.gift_name.localeCompare(b.gift_name)) };
  });
};
