/* =====================================================================
   Sales analytics — shared by the server, the single-file engine and
   the screens, so every page shows the same numbers.

   One transaction = one mobile sale + the gift given with it.
     Mobile units  = mobile_qty   (phones sold)
     Gift units    = quantity     (gifts handed to the customer)
     Gift-to-Mobile ratio = Gift units ÷ Mobile units

   Which transactions count as sales (setting "sales_mode"):
     'submitted'  Submitted + Pending Review + Approved   (default: recorded immediately)
     'approved'   Approved only
   Rejected transactions never count. Gift inventory is a separate rule:
   stock is deducted only on approval (see the inventory service).
   ===================================================================== */
(function (root) {
  'use strict';

  /** Internal status value -> label shown to people. */
  // No approval process: every sale is final when submitted (stored as 'approved', shown as 'Completed').
  const STATUS = { pending: 'Submitted', review: 'Pending Review', approved: 'Completed', rejected: 'Rejected' };
  const OPEN = ['pending', 'review']; // waiting for a decision (gift stock is reserved)
  const statusLabel = (s) => STATUS[s] || s;
  const isOpen = (s) => OPEN.includes(s);

  const SALES_MODES = { submitted: 'When submitted (Submitted, Pending Review, Approved)', approved: 'Only when approved' };
  const counted = (t, mode) => t.status !== 'rejected' && (mode !== 'approved' || t.status === 'approved');

  const num = (v) => Number(v) || 0;
  const ratio = (gifts, units) => (units > 0 ? Math.round((gifts / units) * 1000) / 10 : null);

  /** Totals for a list of transaction rows. */
  function summary(rows) {
    let units = 0, gifts = 0;
    const shops = new Set(), promoters = new Set();
    for (const t of rows) { units += num(t.mobile_qty); gifts += num(t.quantity); shops.add(t.shop_pk); promoters.add(t.promoter_pk); }
    return { units, gifts, txns: rows.length, ratio: ratio(gifts, units), shops: shops.size, promoters: promoters.size };
  }

  /**
   * Group rows. keyFn(row) -> key; info(row) -> extra fields copied from the first row.
   * Returns [{ key, ...info, units, gifts, txns, ratio, shops, promoters }] sorted by units (desc).
   */
  function group(rows, keyFn, info) {
    const m = new Map();
    for (const t of rows) {
      const k = keyFn(t);
      if (k === undefined) continue;
      let g = m.get(k);
      if (!g) { g = { key: k, ...(info ? info(t) : {}), units: 0, gifts: 0, txns: 0, _s: new Set(), _p: new Set() }; m.set(k, g); }
      g.units += num(t.mobile_qty); g.gifts += num(t.quantity); g.txns++; g._s.add(t.shop_pk); g._p.add(t.promoter_pk);
    }
    return [...m.values()].map((g) => {
      const { _s, _p, ...rest } = g;
      return { ...rest, ratio: ratio(g.gifts, g.units), shops: _s.size, promoters: _p.size };
    }).sort((a, b) => b.units - a.units || b.gifts - a.gifts || String(a.key).localeCompare(String(b.key)));
  }

  const byBrand = (rows) => group(rows, (t) => t.brand_pk || 0, (t) => ({ brand_id: t.brand_pk || null, brand_code: t.brand_code || null, brand_name: t.brand_name || 'No brand' }));
  const byModel = (rows) => group(rows, (t) => t.model_pk || 0, (t) => ({ brand_id: t.brand_pk || null, brand_name: t.brand_name || 'No brand', model_id: t.model_pk || null, item_code: t.item_code || null, model_name: t.model_name || 'No model' }));
  const byGift = (rows) => group(rows, (t) => t.gift_pk, (t) => ({ gift_pk: t.gift_pk, gift_id: t.gift_id, gift_name: t.gift_name, unit: t.unit }))
    .sort((a, b) => b.gifts - a.gifts);
  const byShop = (rows) => group(rows, (t) => t.shop_pk, (t) => ({ shop_pk: t.shop_pk, shop_id: t.shop_id, shop_name: t.shop_name, city_name: t.city_name, market_name: t.market_name, promoter_name: t.shop_promoter_name ?? t.promoter_name }));
  const byPromoter = (rows) => group(rows, (t) => t.promoter_pk, (t) => ({ promoter_id: t.promoter_pk, user_code: t.promoter_code, name: t.promoter_name }));
  const byCity = (rows) => group(rows, (t) => t.city_id, (t) => ({ city_id: t.city_id, city_name: t.city_name }));
  const byMarket = (rows) => group(rows, (t) => t.market_id, (t) => ({ market_id: t.market_id, market_name: t.market_name, city_name: t.city_name }));
  /** Shop × brand × model lines (the shop-wise sales table). */
  const byShopModel = (rows) => group(rows, (t) => `${t.shop_pk}|${t.model_pk || 0}`, (t) => ({ shop_pk: t.shop_pk, shop_id: t.shop_id, shop_name: t.shop_name, city_name: t.city_name, market_name: t.market_name,
    brand_name: t.brand_name || 'No brand', model_name: t.model_name || 'No model', item_code: t.item_code || null }))
    .sort((a, b) => a.shop_pk - b.shop_pk || b.units - a.units);

  /** Brands with their models nested (click a brand to see its models). */
  function brandTree(rows) {
    const models = byModel(rows);
    return byBrand(rows).map((b) => ({ ...b, models: models.filter((m) => (m.brand_id || 0) === (b.brand_id || 0)) }));
  }

  /** Series for the last n days / months. dayOf(t) -> 'YYYY-MM-DD' in local time. */
  function series(rows, keys, keyOf) {
    const m = new Map(keys.map((k) => [k, { key: k, units: 0, gifts: 0, txns: 0 }]));
    for (const t of rows) { const g = m.get(keyOf(t)); if (g) { g.units += num(t.mobile_qty); g.gifts += num(t.quantity); g.txns++; } }
    return keys.map((k) => m.get(k));
  }
  const pad = (n) => String(n).padStart(2, '0');
  function lastDays(n, today) {
    const base = today ? new Date(today + 'T12:00:00') : new Date();
    const out = [];
    for (let i = n - 1; i >= 0; i--) { const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i); out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`); }
    return out;
  }
  function lastMonths(n, today) {
    const base = today ? new Date(today + 'T12:00:00') : new Date();
    const out = [];
    for (let i = n - 1; i >= 0; i--) { const d = new Date(base.getFullYear(), base.getMonth() - i, 1); out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`); }
    return out;
  }

  /** Common filters on joined transaction rows. q: { brand_id, model_id, shop_id, city_id, market_id, promoter_id, gift_id, status } */
  function filter(rows, q) {
    const n = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
    const f = { brand: n(q.brand_id), model: n(q.model_id), shop: n(q.shop_id), city: n(q.city_id), market: n(q.market_id), promoter: n(q.promoter_id), gift: n(q.gift_id) };
    return rows.filter((t) => (f.brand === null || (t.brand_pk || 0) === f.brand) && (f.model === null || (t.model_pk || 0) === f.model) &&
      (f.shop === null || t.shop_pk === f.shop) && (f.city === null || t.city_id === f.city) && (f.market === null || t.market_id === f.market) &&
      (f.promoter === null || t.promoter_pk === f.promoter) && (f.gift === null || t.gift_pk === f.gift) &&
      (!q.status || q.status === 'all' || (q.status === 'open' ? isOpen(t.status) : t.status === q.status)));
  }

  const api = { STATUS, OPEN, SALES_MODES, statusLabel, isOpen, counted, ratio, summary, group, byBrand, byModel, byGift, byShop, byPromoter, byCity, byMarket, byShopModel, brandTree, series, lastDays, lastMonths, filter };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Analytics = api;
})(typeof window !== 'undefined' ? window : globalThis);
