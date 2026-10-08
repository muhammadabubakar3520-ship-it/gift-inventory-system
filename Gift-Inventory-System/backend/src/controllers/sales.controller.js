'use strict';
/* =====================================================================
   sales.js — mobile sales tracking (brand / model / shop / promoter),
   the admin dashboard and the Gift-to-Mobile ratio.
   Mobile sales are counted per Settings → "Record mobile sales"
   (when submitted, or only when approved). Rejected never counts.
   ===================================================================== */
module.exports = function register(G) {
  const { S, R } = G;
  const A = () => G.Analytics;

  /** Days between two YYYY-MM-DD dates (inclusive). */
  const spanDays = (from, to) => Math.round((new Date(to + 'T12:00:00') - new Date(from + 'T12:00:00')) / 86400000) + 1;
  function trendKeys(q) {
    const to = q.to || G.today();
    if (q.from && spanDays(q.from, to) <= 92 && spanDays(q.from, to) > 0) return A().lastDays(spanDays(q.from, to), to);
    return A().lastDays(30, to);
  }

  R('GET', '/sales/summary', 'admin', ({ query: q }) => {
    const rows = G.salesRows(q);
    const days = trendKeys(q);
    return {
      mode: G.salesMode(), summary: A().summary(rows),
      brands: A().brandTree(rows), models: A().byModel(rows), shops: A().byShop(rows), shop_models: A().byShopModel(rows),
      promoters: A().byPromoter(rows), cities: A().byCity(rows), markets: A().byMarket(rows), gifts: A().byGift(rows),
      daily: A().series(rows, days, (t) => G.localDay(t.created_at)),
      monthly: A().series(rows, A().lastMonths(12, q.to || G.today()), (t) => G.localMonth(t.created_at)),
    };
  });

  R('GET', '/reports/dashboard', 'admin', ({ query: q }) => {
    const cityOk = (s) => !q.city_id || s.city_id === Number(q.city_id);
    const shops = S.shops.filter(cityOk);
    const inv = S.inv.filter((i) => cityOk(G.byId('shops', i.shop_id)));
    const allocated = G.sum(inv, 'allocated_quantity'); const distributed = G.sum(inv, 'distributed_quantity'); const pendingQty = G.sum(inv, 'pending_quantity');
    const rows = G.salesRows({ from: q.from, to: q.to, city_id: q.city_id });
    const sum = A().summary(rows);
    const from = G.dayBound(q.from, false); const to = G.dayBound(q.to, true);
    const inPeriod = (t) => (!from || t.created_at >= from) && (!to || t.created_at <= to);
    const allCity = S.txns.filter((t) => cityOk(G.byId('shops', t.shop_id)));
    const open = allCity.filter((t) => A().isOpen(t.status)).sort((a, b) => b.created_at.localeCompare(a.created_at));
    const approvedGifts = G.sum(allCity.filter((t) => t.status === 'approved' && inPeriod(t)), 'quantity');
    const warehouse = G.sum(S.gifts, 'total_quantity');
    const lbl = (arr, label, n) => arr.slice(0, n).map((r) => ({ label: label(r), units: r.units, gifts: r.gifts, value: r.units }));
    const remainingByGift = S.gifts.map((g) => { const r = inv.filter((i) => i.gift_id === g.id); const a = G.sum(r, 'allocated_quantity'); const d = G.sum(r, 'distributed_quantity'); return { label: g.gift_name, allocated: a, distributed: d, pending: G.sum(r, 'pending_quantity'), remaining: a - d }; })
      .filter((x) => x.allocated > 0 || S.gifts.length <= 12).sort((a, b) => b.allocated - a.allocated);
    return {
      mode: G.salesMode(),
      kpis: { total_mobile_units: sum.units, total_gift_units: sum.gifts, ratio: sum.ratio, transactions: sum.txns,
        total_shops: shops.length, active_shops: shops.filter((s) => s.status === 'active').length,
        active_promoters: S.users.filter((u) => u.role === 'promoter' && u.status === 'active').length, selling_promoters: sum.promoters,
        pending_transactions: open.length, pending_submitted: open.filter((t) => t.status === 'pending').length, pending_review: open.filter((t) => t.status === 'review').length,
        remaining_gift_inventory: allocated - distributed, available_gift_inventory: allocated - distributed - pendingQty, reserved_gifts: pendingQty,
        total_allocated: allocated, total_given: distributed, gifts_approved_period: approvedGifts,
        warehouse_total: warehouse, warehouse_unallocated: warehouse - G.sum(S.inv, 'allocated_quantity') },
      charts: {
        byBrand: lbl(A().byBrand(rows), (r) => r.brand_name, 12), byModel: lbl(A().byModel(rows), (r) => r.model_name, 10),
        byPromoter: lbl(A().byPromoter(rows), (r) => r.name, 12), byCity: lbl(A().byCity(rows), (r) => r.city_name, 12),
        byMarket: lbl(A().byMarket(rows), (r) => `${r.market_name} · ${r.city_name}`, 10), byShop: lbl(A().byShop(rows), (r) => r.shop_name, 10),
        byGift: A().byGift(rows).map((r) => ({ label: r.gift_name, value: r.gifts })), remainingByGift,
        daily: A().series(rows, trendKeys(q), (t) => G.localDay(t.created_at)),
        monthly: A().series(G.salesRows({ city_id: q.city_id }), A().lastMonths(12, q.to || G.today()), (t) => G.localMonth(t.created_at)),
      },
      topShops: A().byShop(rows).slice(0, 10), topPromoters: A().byPromoter(rows).slice(0, 10),
      recent: allCity.filter((t) => t.status !== 'rejected').sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id).slice(0, 6).map(G.txnView).map((t) => ({ transaction_id: t.transaction_id, status: t.status, quantity: t.quantity, mobile_qty: t.mobile_qty, created_at: t.created_at,
        shop_name: t.shop_name, shop_id: t.shop_id, gift_name: t.gift_name, brand_name: t.brand_name, model_name: t.model_name, promoter_name: t.promoter_name })),
      recentPending: open.slice(0, 6).map(G.txnView).map((t) => ({ transaction_id: t.transaction_id, status: t.status, quantity: t.quantity, mobile_qty: t.mobile_qty, created_at: t.created_at,
        shop_name: t.shop_name, shop_id: t.shop_id, gift_name: t.gift_name, brand_name: t.brand_name, model_name: t.model_name, promoter_name: t.promoter_name })),
    };
  });
};
