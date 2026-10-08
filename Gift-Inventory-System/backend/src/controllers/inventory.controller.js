'use strict';
/* =====================================================================
   inventory.js — shop gift inventory. Every stock change goes through here.

   Per shop × gift:  Allocated, Given (approved), Pending (reserved)
     Remaining = Allocated − Given            (gifts still at the shop)
     Available = Allocated − Given − Pending  (what a promoter can still submit)
   Gift stock is deducted ONLY when a transaction is approved.
   Rejected transactions release their reservation. Nothing can go negative.
   ===================================================================== */
module.exports = function register(G) {
  const { S, R } = G;
  const A = () => G.Analytics;

  /** Validate every line first (cumulative), then apply — all or nothing. */
  G.allocateMany = (items, reason, user) => {
    const use = {};
    const checked = items.map((it) => {
      const shop = G.byId('shops', it.shopId); if (!shop) throw G.notFound('Shop');
      const gift = G.byId('gifts', it.giftId); if (!gift) throw G.notFound('Gift');
      if (shop.status !== 'active') throw G.bad(`${shop.shop_id} is inactive. Activate the shop before allocating.`);
      if (gift.status !== 'active') throw G.bad(`${gift.gift_name} is inactive.`);
      use[gift.id] = (use[gift.id] || 0) + it.quantity;
      const unallocated = gift.total_quantity - G.giftAllocated(gift.id);
      if (use[gift.id] > unallocated) throw G.conflict(`Not enough warehouse stock for ${gift.gift_name}. Unallocated: ${unallocated}, requested: ${use[gift.id]}.`);
      return { shop, gift, quantity: it.quantity };
    });
    return checked.map(({ shop, gift, quantity }) => {
      const i = G.getOrCreateInv(shop.id, gift.id);
      const before = i.allocated_quantity;
      i.allocated_quantity += quantity; i.updated_at = G.now();
      G.insert('moves', { shop_id: shop.id, gift_id: gift.id, type: 'allocation', quantity, before_qty: before, after_qty: i.allocated_quantity, reason: reason || null, user_id: user.id, created_at: G.now() });
      return { shop, gift, before, after: i.allocated_quantity };
    });
  };
  /** Set a shop's allocation to an exact number (Excel inventory upload). Caller has validated warehouse stock. */
  G.setAllocation = (shop, gift, after, reason, user) => {
    const i = G.getOrCreateInv(shop.id, gift.id);
    const before = i.allocated_quantity;
    if (after === before) return null;
    if (after < i.distributed_quantity + i.pending_quantity) throw G.conflict(`${shop.shop_id} / ${gift.gift_name}: cannot go below ${i.distributed_quantity + i.pending_quantity} (already given or waiting).`);
    i.allocated_quantity = after; i.updated_at = G.now();
    G.assertInv(i);
    G.insert('moves', { shop_id: shop.id, gift_id: gift.id, type: after > before ? 'allocation' : 'adjustment_out', quantity: Math.abs(after - before), before_qty: before, after_qty: after, reason, user_id: user.id, created_at: G.now() });
    return { before, after };
  };
  G.adjust = ({ shopId, giftId, delta, reason, user }) => {
    if (!delta) throw G.bad('Adjustment quantity cannot be zero');
    if (!reason) throw G.bad('A reason is required for every adjustment');
    const shop = G.byId('shops', shopId); if (!shop) throw G.notFound('Shop');
    const gift = G.byId('gifts', giftId); if (!gift) throw G.notFound('Gift');
    const cur = G.invRow(shop.id, gift.id) || { allocated_quantity: 0, distributed_quantity: 0, pending_quantity: 0 };
    const after = cur.allocated_quantity + delta;
    if (delta > 0) {
      const unallocated = gift.total_quantity - G.giftAllocated(gift.id);
      if (delta > unallocated) throw G.conflict(`Not enough warehouse stock. Unallocated: ${unallocated}.`);
    } else {
      const committed = cur.distributed_quantity + cur.pending_quantity;
      if (after < committed) throw G.conflict(`Cannot remove ${-delta}. Only ${cur.allocated_quantity - committed} can be removed (given ${cur.distributed_quantity}, waiting for approval ${cur.pending_quantity}).`);
    }
    const i = G.getOrCreateInv(shop.id, gift.id);
    const before = i.allocated_quantity;
    i.allocated_quantity = after; i.updated_at = G.now();
    G.insert('moves', { shop_id: shop.id, gift_id: gift.id, type: delta > 0 ? 'adjustment_in' : 'adjustment_out', quantity: Math.abs(delta), before_qty: before, after_qty: after, reason, user_id: user.id, created_at: G.now() });
    return { shop, gift, before, after };
  };
  /**
   * Review a transaction.
   *   start   : Submitted → Pending Review   (no stock change)
   *   approve : Submitted / Pending Review → Approved   (reserved → given: stock deducted)
   *   reject  : Submitted / Pending Review → Rejected   (reservation released)
   *             Approved → Rejected (reversal: the gifts go back to the shop's stock)
   */
  G.review = ({ code, action, reason, user }) => {
    const t = S.txns.find((x) => x.transaction_id === code);
    if (!t) throw G.notFound('Transaction');
    const i = G.invRow(t.shop_id, t.gift_id);
    const before = t.status;
    const label = A().statusLabel(t.status);
    if (action === 'start') {
      if (t.status !== 'pending') throw G.conflict(`${t.transaction_id} is ${label}. Only Submitted transactions can be moved to Pending Review.`);
      t.status = 'review'; t.review_started_at = G.now(); t.review_started_by = user.id;
      return { before, after: t.status, txn: t };
    }
    if (action === 'approve') {
      if (!A().isOpen(t.status)) throw G.conflict(`${t.transaction_id} is already ${label}.`);
      i.pending_quantity -= t.quantity; i.distributed_quantity += t.quantity;
      t.status = 'approved'; t.rejection_reason = null;
    } else if (action === 'reject') {
      if (!reason) throw G.bad('Please enter a rejection reason');
      if (t.status === 'rejected') throw G.conflict(`${t.transaction_id} is already rejected.`);
      if (A().isOpen(t.status)) i.pending_quantity -= t.quantity; else i.distributed_quantity -= t.quantity;
      t.status = 'rejected'; t.rejection_reason = reason;
    } else throw G.bad('Unknown review action');
    G.assertInv(i);
    i.updated_at = G.now(); t.reviewed_by = user.id; t.reviewed_at = G.now();
    return { before, after: t.status, txn: t };
  };

  /* ---------- routes ---------- */
  function filterInv(q) {
    const s = G.like(q.search);
    return S.inv.filter((i) => i.allocated_quantity > 0 || i.distributed_quantity > 0).map(G.invView).filter((r) =>
      (!s || s(r.shop_id, r.shop_name, r.gift_name)) && (!q.city_id || r.city_id === Number(q.city_id)) && (!q.market_id || r.market_id === Number(q.market_id)) &&
      (!q.promoter_id || r.promoter_id === Number(q.promoter_id)) && (!q.gift_id || r.gift_pk === Number(q.gift_id)) && (!q.shop_id || r.shop_pk === Number(q.shop_id)) &&
      (q.stock !== 'out' || r.remaining <= 0) && (q.stock !== 'low' || (r.remaining > 0 && r.remaining * 5 <= r.allocated)) && (q.stock !== 'in' || r.remaining > 0));
  }
  G.filterInv = filterInv;
  const INV_SORT = { shop_id: 'shop_pk', gift: 'gift_name', allocated: 'allocated', distributed: 'distributed', remaining: 'remaining', updated_at: 'updated_at' };
  R('GET', '/inventory', 'admin', ({ query }) => {
    const rows = G.sortBy(filterInv(query), INV_SORT[query.sort] || 'shop_pk', query.dir);
    const totals = { n: rows.length, allocated: G.sum(rows, 'allocated'), distributed: G.sum(rows, 'distributed'), pending: G.sum(rows, 'pending') };
    return { ...G.page(query, rows), totals };
  });
  R('GET', '/inventory/export.csv', 'admin', ({ query }) => G.csv('shop-gift-inventory.csv', [
    { label: 'Shop ID', key: 'shop_id' }, { label: 'Shop Name', key: 'shop_name' }, { label: 'City', key: 'city_name' }, { label: 'Market', key: 'market_name' },
    { label: 'Promoter', key: 'promoter_name' }, { label: 'Gift ID', key: 'gift_id' }, { label: 'Gift', key: 'gift_name' }, { label: 'Allocated', key: 'allocated' },
    { label: 'Given (approved)', key: 'distributed' }, { label: 'Waiting approval', key: 'pending' }, { label: 'Remaining', key: 'remaining' }, { label: 'Available', key: 'available' },
  ], G.sortBy(filterInv(query), 'shop_pk')));
  R('POST', '/inventory/allocate', 'admin', ({ body, user }) => {
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (!lines.length) throw G.bad('Add at least one allocation line');
    if (lines.length > 2000) throw G.bad('Allocate at most 2,000 lines at a time');
    const reason = G.str(body.reason, { field: 'Note', max: 200 });
    const items = lines.map((l, i) => ({ shopId: G.int(l.shop_id, { field: `Line ${i + 1} shop`, min: 1 }), giftId: G.int(l.gift_id, { field: `Line ${i + 1} gift`, min: 1 }), quantity: G.int(l.quantity, { field: `Line ${i + 1} quantity`, min: 1, max: 1_000_000 }) }));
    const res = G.allocateMany(items, reason, user);
    for (const x of res) G.audit(user, 'inventory_allocated', 'shop_inventory', `${x.shop.shop_id}/${x.gift.gift_id}`, { before: x.before, after: x.after, reason });
    return { ok: true, lines: res.length, quantity: items.reduce((a, b) => a + b.quantity, 0) };
  }, { write: true });
  R('POST', '/inventory/adjust', 'admin', ({ body, user }) => {
    const x = G.adjust({ shopId: G.int(body.shop_id, { field: 'Shop', min: 1 }), giftId: G.int(body.gift_id, { field: 'Gift', min: 1 }),
      delta: G.int(body.delta, { field: 'Adjustment quantity', min: -1_000_000, max: 1_000_000 }), reason: G.str(body.reason, { field: 'Reason', required: true, max: 200 }), user });
    G.audit(user, 'inventory_adjusted', 'shop_inventory', `${x.shop.shop_id}/${x.gift.gift_id}`, { delta: body.delta, before: x.before, after: x.after, reason: body.reason });
    return { ok: true, before: x.before, after: x.after };
  }, { write: true });
  function filterMoves(q) {
    const s = G.like(q.search);
    return S.moves.map((m) => { const sh = G.byId('shops', m.shop_id); return { ...m, shop_id: sh.shop_id, shop_pk: sh.id, shop_name: sh.shop_name, gift_pk: m.gift_id, gift_name: G.byId('gifts', m.gift_id).gift_name, user_name: m.user_id ? (G.byId('users', m.user_id) || {}).name : null }; })
      .filter((m) => (!s || s(m.shop_id, m.shop_name, m.reason)) && (!q.type || (q.type === 'adjustment' ? m.type !== 'allocation' : m.type === q.type)) &&
        (!q.gift_id || m.gift_pk === Number(q.gift_id)) && (!q.shop_id || m.shop_pk === Number(q.shop_id))).sort((a, b) => b.id - a.id);
  }
  R('GET', '/inventory/movements', 'admin', ({ query }) => G.page(query, filterMoves(query)));
  R('GET', '/inventory/movements/export.csv', 'admin', ({ query }) => G.csv('inventory-movements.csv', [
    { label: 'Date/Time', value: (r) => G.localStamp(r.created_at) }, { label: 'Type', key: 'type' }, { label: 'Shop ID', key: 'shop_id' }, { label: 'Shop', key: 'shop_name' },
    { label: 'Gift', key: 'gift_name' }, { label: 'Quantity', key: 'quantity' }, { label: 'Allocated Before', key: 'before_qty' }, { label: 'Allocated After', key: 'after_qty' },
    { label: 'Reason', key: 'reason' }, { label: 'By', key: 'user_name' },
  ], filterMoves(query)));

  /* ---------- DOS (Days of Stock) ---------- */
  function dosRows(q) {
    const D = G.DOS;
    const days = D.WINDOWS.includes(Number(q.days)) ? Number(q.days) : 30;
    const target = Math.min(180, Math.max(1, parseInt(q.target, 10) || 30));
    const since = G.ts(new Date(Date.now() - days * 86400000));
    const soldMap = new Map(); const lastMap = new Map();
    for (const t of S.txns) {
      if (t.status === 'rejected') continue;
      const k = t.shop_id + '|' + t.gift_id;
      if (t.created_at >= since) soldMap.set(k, (soldMap.get(k) || 0) + t.quantity);
      if (!lastMap.has(k) || t.created_at > lastMap.get(k)) lastMap.set(k, t.created_at);
    }
    const s = G.like(q.search);
    const rows = S.inv.filter((i) => i.allocated_quantity > 0).map((i) => {
      const v = G.invView(i);
      if (v.shop_status !== 'active' || v.gift_status !== 'active') return null;
      if ((s && !s(v.shop_id, v.shop_name)) || (q.city_id && v.city_id !== Number(q.city_id)) || (q.market_id && v.market_id !== Number(q.market_id)) ||
        (q.promoter_id && v.promoter_id !== Number(q.promoter_id)) || (q.gift_id && v.gift_pk !== Number(q.gift_id)) || (q.shop && v.shop_pk !== Number(q.shop)) || (q.shop_id && v.shop_pk !== Number(q.shop_id))) return null;
      const k = i.shop_id + '|' + i.gift_id;
      const base = { ...v, first_allocated_at: i.created_at, sold: soldMap.get(k) || 0, last_sale_at: lastMap.get(k) || null };
      return { ...base, ...D.calc(base, { days, target }) };
    }).filter(Boolean);
    return { rows, days, target };
  }
  const DOS_SORT = { dos: (a, b) => (a.dos ?? 1e9) - (b.dos ?? 1e9), sold: (a, b) => b.sold - a.sold, refill: (a, b) => b.refill - a.refill, stock: (a, b) => a.stock - b.stock, shop_id: (a, b) => a.shop_pk - b.shop_pk };
  G.dosQuery = (q) => {
    const d = dosRows(q);
    const summary = G.DOS.summary(d.rows);
    const rows = q.status ? d.rows.filter((r) => r.status === q.status) : d.rows;
    rows.sort(DOS_SORT[q.sort] || G.DOS.urgency);
    if (q.dir === 'desc' && DOS_SORT[q.sort]) rows.reverse();
    return { ...d, rows, summary };
  };
  R('GET', '/inventory/dos', 'admin', ({ query }) => {
    const d = G.dosQuery(query);
    const totals = { stock: G.sum(d.rows, 'stock'), sold: G.sum(d.rows, 'sold'), refill: G.sum(d.rows, 'refill') };
    const ads = d.rows.reduce((a, x) => a + x.sold / x.sales_days, 0);
    totals.dos = ads > 0 ? Math.round((totals.stock / ads) * 10) / 10 : null;
    return { ...G.page(query, d.rows), days: d.days, target: d.target, summary: d.summary, totals };
  });
  R('GET', '/inventory/dos/export.csv', 'admin', ({ query }) => {
    const d = G.dosQuery(query);
    return G.csv(`shop-gift-dos-${d.days}d.csv`, [
      { label: 'Shop ID', key: 'shop_id' }, { label: 'Shop', key: 'shop_name' }, { label: 'City', key: 'city_name' }, { label: 'Market', key: 'market_name' },
      { label: 'Promoter', key: 'promoter_name' }, { label: 'Gift', key: 'gift_name' }, { label: 'Allocated', key: 'allocated' }, { label: 'Stock', key: 'stock' },
      { label: `Sold (last ${d.days} days)`, key: 'sold' }, { label: 'Avg per day', key: 'ads' }, { label: 'DOS (days)', key: 'dos' },
      { label: 'Status', key: 'status_label' }, { label: `Suggested refill (to ${d.target} days)`, key: 'refill' },
    ], d.rows);
  });
};
