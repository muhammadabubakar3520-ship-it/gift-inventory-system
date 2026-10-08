import Analytics from './analytics.js';
/* =====================================================================
   Report definitions — shared by the Node.js server and the single-file
   engine so both produce identical reports.
     const reports = ReportDefs.build(ctx)
     reports.run(type, query) -> { name, columns, rows, totals, mode }
   ctx provides data access (each backend implements it):
     salesRows(q), filterTxns(q), filterInv(q), filterShops(q), invTotalsByShop(),
     giftViews(), performanceRows(q), dosQuery(q), salesMode(),
     localDay(ts), localMonth(ts), localTime(ts), localStamp(ts)
   Types: mobile-sales, brand, model, promoter, shop, gift-distribution,
          gift-inventory, remaining-inventory, transactions, dos
   ===================================================================== */
const api = (function () {
  'use strict';
  const A = Analytics;
  const sum = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const byTimeDesc = (a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id;

  function build(G) {
    const _A = () => A;
    const C = {
      units: { key: 'units', label: 'Mobile Units', num: true }, gifts: { key: 'gifts', label: 'Gifts Given', num: true },
      ratio: { key: 'ratio', label: 'Gift-to-Mobile %', num: true, pct: true, sum: false }, txns: { key: 'txns', label: 'Transactions', num: true },
      shops: { key: 'shops', label: 'Shops', num: true, sum: false }, promoters: { key: 'promoters', label: 'Promoters', num: true, sum: false },
    };

    const REPORTS = {
      'mobile-sales': (q) => {
        const group = (['day', 'month', 'brand', 'model', 'shop', 'shop_model', 'promoter', 'city', 'market'].includes(q.group) ? q.group : 'brand');
        const rows = G.salesRows(q);
        const sortDate = (list) => list.sort((a, b) => String(b.key).localeCompare(String(a.key)));
        const M = {
          day: () => [sortDate(_A().group(rows, (t) => G.localDay(t.created_at), (t) => ({ grp: G.localDay(t.created_at) }))), [{ key: 'grp', label: 'Date' }]],
          month: () => [sortDate(_A().group(rows, (t) => G.localMonth(t.created_at), (t) => ({ grp: G.localMonth(t.created_at) }))), [{ key: 'grp', label: 'Month' }]],
          brand: () => [_A().byBrand(rows), [{ key: 'brand_code', label: 'Brand ID' }, { key: 'brand_name', label: 'Brand' }]],
          model: () => [_A().byModel(rows), [{ key: 'brand_name', label: 'Brand' }, { key: 'item_code', label: 'Model ID' }, { key: 'model_name', label: 'Model' }]],
          shop: () => [_A().byShop(rows), [{ key: 'shop_id', label: 'Shop ID' }, { key: 'shop_name', label: 'Shop' }, { key: 'city_name', label: 'City' }, { key: 'market_name', label: 'Market' }]],
          shop_model: () => [_A().byShopModel(rows), [{ key: 'shop_id', label: 'Shop ID' }, { key: 'shop_name', label: 'Shop' }, { key: 'city_name', label: 'City' }, { key: 'market_name', label: 'Market' }, { key: 'brand_name', label: 'Brand' }, { key: 'model_name', label: 'Model' }]],
          promoter: () => [_A().byPromoter(rows), [{ key: 'user_code', label: 'Promoter ID' }, { key: 'name', label: 'Promoter' }]],
          city: () => [_A().byCity(rows), [{ key: 'city_name', label: 'City' }]],
          market: () => [_A().byMarket(rows), [{ key: 'market_name', label: 'Market' }, { key: 'city_name', label: 'City' }]],
        }[group]();
        const extra = group === 'shop_model' ? [{ ...C.units, label: 'Quantity' }, C.gifts, C.ratio, C.txns] : [C.units, C.gifts, C.ratio, C.txns, ...(group === 'shop' ? [] : [C.shops]), ...(group === 'promoter' ? [] : [C.promoters])];
        return { name: `mobile-sales-by-${group}`, columns: [...M[1], ...extra], rows: M[0] };
      },
      brand: (q) => {
        const rows = G.salesRows(q);
        const out = _A().brandTree(rows).map((b) => ({ ...b, model_count: b.models.length, top_model: b.models[0] ? b.models[0].model_name : null }));
        return { name: 'brand-performance', columns: [{ key: 'brand_code', label: 'Brand ID' }, { key: 'brand_name', label: 'Brand' }, { key: 'model_count', label: 'Models Sold', num: true, sum: false },
          { key: 'top_model', label: 'Top Model' }, C.units, C.gifts, C.ratio, C.txns, C.shops, C.promoters], rows: out };
      },
      model: (q) => ({ name: 'model-performance', columns: [{ key: 'brand_name', label: 'Brand' }, { key: 'item_code', label: 'Model ID' }, { key: 'model_name', label: 'Model' }, C.units, C.gifts, C.ratio, C.txns, C.shops, C.promoters],
        rows: _A().byModel(G.salesRows(q)) }),
      promoter: (q) => ({ name: 'promoter-performance', columns: [{ key: 'user_code', label: 'Promoter ID' }, { key: 'name', label: 'Promoter' }, { key: 'status', label: 'Status' },
        { key: 'shops_assigned', label: 'Shops Assigned', num: true }, { key: 'shops_sold', label: 'Shops Sold At', num: true, sum: false },
        { key: 'mobile_units', label: 'Mobile Units', num: true }, { key: 'gifts_given', label: 'Gifts Given', num: true }, { key: 'ratio', label: 'Gift-to-Mobile %', num: true, pct: true, sum: false },
        { key: 'transactions', label: 'Transactions', num: true }, { key: 'last_activity', label: 'Last Activity', date: true }],
        rows: G.performanceRows(q) }),
      shop: (q) => {
        const sold = new Map(_A().byShop(G.salesRows(q)).map((r) => [r.shop_pk, r]));
        const totals = G.invTotalsByShop();
        const rows = G.filterShops({ city_id: q.city_id, market_id: q.market_id, promoter_id: q.promoter_id }).filter((s) => !q.shop_id || s.id === Number(q.shop_id)).map((s) => {
          const r = sold.get(s.id) || { units: 0, gifts: 0, txns: 0, ratio: null };
          const t = totals.get(s.id) || { allocated: 0, distributed: 0, pending: 0 };
          return { shop_id: s.shop_id, shop_name: s.shop_name, city_name: s.city_name, market_name: s.market_name, promoter_name: s.promoter_name, status: s.status,
            units: r.units, gifts: r.gifts, ratio: r.ratio, txns: r.txns, allocated: t.allocated, given_total: t.distributed, remaining: t.allocated - t.distributed };
        }).sort((a, b) => b.units - a.units || a.shop_id.localeCompare(b.shop_id));
        return { name: 'shop-performance', columns: [{ key: 'shop_id', label: 'Shop ID' }, { key: 'shop_name', label: 'Shop' }, { key: 'city_name', label: 'City' }, { key: 'market_name', label: 'Market' },
          { key: 'promoter_name', label: 'Promoter' }, C.units, C.gifts, C.ratio, C.txns, { key: 'allocated', label: 'Gifts Allocated', num: true }, { key: 'given_total', label: 'Gifts Given (all time)', num: true }, { key: 'remaining', label: 'Gift Stock Remaining', num: true }], rows };
      },
      'gift-distribution': (q) => {
        const all = G.filterTxns({ ...q, status: '', search: '' }).filter((t) => t.status !== 'rejected');
        const rows = _A().byGift(all).map((g) => ({ gift_id: g.gift_id, gift_name: g.gift_name, given: g.gifts, units: g.units, ratio: g.ratio, txns: g.txns, shops: g.shops, promoters: g.promoters }));
        return { name: 'gift-distribution', columns: [{ key: 'gift_id', label: 'Gift ID' }, { key: 'gift_name', label: 'Gift' }, { key: 'given', label: 'Gifts Given', num: true },
          { key: 'units', label: 'Mobile Units With Gift', num: true },
          { key: 'ratio', label: 'Gift-to-Mobile %', num: true, pct: true, sum: false }, C.txns, C.shops, C.promoters], rows, totalsRatio: ['given', 'units'] };
      },
      'gift-inventory': (q) => {
        const rows = G.filterInv(q).sort((a, b) => a.shop_pk - b.shop_pk || a.gift_name.localeCompare(b.gift_name));
        return { name: 'gift-inventory', columns: [{ key: 'shop_id', label: 'Shop ID' }, { key: 'shop_name', label: 'Shop' }, { key: 'city_name', label: 'City' }, { key: 'market_name', label: 'Market' },
          { key: 'promoter_name', label: 'Promoter' }, { key: 'gift_id', label: 'Gift ID' }, { key: 'gift_name', label: 'Gift' }, { key: 'allocated', label: 'Allocated', num: true },
          { key: 'distributed', label: 'Given', num: true }, { key: 'remaining', label: 'Remaining', num: true }], rows };
      },
      'remaining-inventory': () => {
        const rows = G.giftViews().map((v) => ({ gift_id: v.gift_id, gift_name: v.gift_name, category: v.category, status: v.status, total_quantity: v.total_quantity, unallocated: v.unallocated, allocated: v.allocated,
          shops: v.shop_count, given: v.distributed, waiting: v.pending, remaining_in_shops: v.remaining_in_shops, total_remaining: v.total_quantity - v.distributed }));
        return { name: 'remaining-gift-inventory', columns: [{ key: 'gift_id', label: 'Gift ID' }, { key: 'gift_name', label: 'Gift' }, { key: 'category', label: 'Category' },
          { key: 'total_quantity', label: 'Total Stock', num: true }, { key: 'allocated', label: 'Allocated to Shops', num: true }, { key: 'unallocated', label: 'In Warehouse', num: true },
          { key: 'shops', label: 'Shops', num: true, sum: false }, { key: 'given', label: 'Given', num: true },
          { key: 'remaining_in_shops', label: 'Remaining in Shops', num: true }, { key: 'total_remaining', label: 'Total Remaining', num: true }], rows };
      },
      transactions: (q) => ({ name: 'transaction-history', columns: [
        { key: 'transaction_id', label: 'Transaction ID' }, { key: 'date', label: 'Date' }, { key: 'time', label: 'Time' }, { key: 'promoter_code', label: 'Promoter ID' }, { key: 'promoter_name', label: 'Promoter Name' },
        { key: 'shop_id', label: 'Shop ID' }, { key: 'shop_name', label: 'Shop Name' }, { key: 'city_name', label: 'City' }, { key: 'market_name', label: 'Market' },
        { key: 'brand_code', label: 'Mobile Brand ID' }, { key: 'brand_name', label: 'Mobile Brand' }, { key: 'item_code', label: 'Mobile Model ID' }, { key: 'model_name', label: 'Mobile Model' },
        { key: 'mobile_qty', label: 'Mobile Quantity', num: true }, { key: 'mobile_photo', label: 'Mobile Sale Proof Photo' }, { key: 'gift_id', label: 'Gift ID' }, { key: 'gift_name', label: 'Gift Name' },
        { key: 'quantity', label: 'Gift Quantity', num: true }, { key: 'gift_photo', label: 'Gift Proof Photo' }, { key: 'status_label', label: 'Status' }, { key: 'created', label: 'Created At' }],
      rows: G.filterTxns(q).sort(byTimeDesc).slice(0, 50000).map((t) => ({ ...t, date: G.localDay(t.created_at), time: G.localTime(t.created_at), created: G.localStamp(t.created_at), approved: G.localStamp(t.approved_at),
        mobile_photo: t.has_mobile_photo ? `${t.transaction_id}-mobile.jpg` : '', gift_photo: t.has_photo ? `${t.transaction_id}-gift.jpg` : '' })) }),
      dos: (q) => {
        const d = G.dosQuery({ ...q, sort: '' });
        return { name: `shop-gift-dos-${d.days}d`, columns: [
          { key: 'shop_id', label: 'Shop ID' }, { key: 'shop_name', label: 'Shop' }, { key: 'city_name', label: 'City' }, { key: 'market_name', label: 'Market' },
          { key: 'gift_name', label: 'Gift' }, { key: 'stock', label: 'Stock', num: true }, { key: 'sold', label: `Sold ${d.days}d`, num: true },
          { key: 'ads', label: 'Avg/Day', num: true, sum: false, dec: true }, { key: 'dos', label: 'DOS', num: true, sum: false, dec: true },
          { key: 'status_label', label: 'Status' }, { key: 'refill', label: `Refill to ${d.target}d`, num: true }], rows: d.rows };
      },
    };

    function run(type, q) {
      const fn = REPORTS[type];
      if (!fn) return null;
      const r = fn(q || {});
      const totals = {};
      for (const c of r.columns) if (c.num && c.sum !== false) totals[c.key] = sum(r.rows, c.key);
      if (totals.units !== undefined) totals.ratio = A.ratio(totals.gifts || 0, totals.units);
      if (r.totalsRatio) totals.ratio = A.ratio(totals[r.totalsRatio[0]] || 0, totals[r.totalsRatio[1]]);
      if (type === 'promoter') totals.ratio = A.ratio(totals.gifts_given || 0, totals.mobile_units);
      return { name: r.name, columns: r.columns, rows: r.rows, totals, mode: G.salesMode() };
    }
    return { REPORTS, run, types: Object.keys(REPORTS) };
  }

  const api = { build };
  return api;
})();
export default api;
