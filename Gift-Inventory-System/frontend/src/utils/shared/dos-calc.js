/* =====================================================================
   DOS (Days of Stock) calculation — shared by the server, the
   single-file engine and the screens, so every place shows the same number.

   For each shop x gift:
     Stock        = Allocated − Distributed − Pending   (gifts physically left in the shop)
     Sold         = quantity handed out in the last N days (approved + pending)
     Sales days   = N, or fewer if the gift was first allocated less than N days ago
     Avg / day    = Sold ÷ Sales days
     DOS          = Stock ÷ Avg/day
     Refill       = Target DOS × Avg/day − Stock   (never below 0)

   Status bands:
     Out of stock  Stock = 0
     Critical      DOS < 7
     Low           DOS 7 – 14
     Healthy       DOS 15 – 45
     Overstock     DOS > 45
     No sales      Stock > 0 and nothing sold in the last N days
   ===================================================================== */
const api = (function () {
  'use strict';

  const STATUS = [
    { key: 'out', label: 'Out of stock', rank: 0 },
    { key: 'critical', label: 'Critical', rank: 1 },
    { key: 'low', label: 'Low', rank: 2 },
    { key: 'healthy', label: 'Healthy', rank: 3 },
    { key: 'overstock', label: 'Overstock', rank: 4 },
    { key: 'nosales', label: 'No sales', rank: 5 },
  ];
  const BANDS = { critical: 7, low: 15, overstock: 45 };
  const WINDOWS = [7, 14, 30, 60, 90];

  function statusOf(stock, dos) {
    if (stock <= 0) return 'out';
    if (dos === null) return 'nosales';
    if (dos < BANDS.critical) return 'critical';
    if (dos < BANDS.low) return 'low';
    if (dos <= BANDS.overstock) return 'healthy';
    return 'overstock';
  }

  /**
   * row: { allocated, distributed, pending, sold, first_allocated_at }
   * opts: { days, target, now (ms) }
   */
  function calc(row, opts) {
    const days = Math.max(1, Number(opts.days) || 30);
    const target = Math.max(1, Number(opts.target) || 30);
    const nowMs = opts.now || Date.now();
    const stock = Math.max(0, (row.allocated || 0) - (row.distributed || 0) - (row.pending || 0));
    let salesDays = days;
    if (row.first_allocated_at) {
      const since = (nowMs - Date.parse(String(row.first_allocated_at).replace(' ', 'T') + 'Z')) / 86400000;
      if (Number.isFinite(since)) salesDays = Math.max(1, Math.min(days, Math.round(since)));
    }
    const sold = row.sold || 0;
    const ads = sold / salesDays;
    const dos = ads > 0 ? stock / ads : null;
    const status = statusOf(stock, dos);
    const refill = ads > 0 ? Math.max(0, Math.ceil(target * ads - stock)) : 0;
    return {
      stock, sold, sales_days: salesDays,
      ads: Math.round(ads * 100) / 100,
      dos: dos === null ? null : Math.round(dos * 10) / 10,
      status, status_label: STATUS.find((s) => s.key === status).label,
      status_rank: STATUS.find((s) => s.key === status).rank,
      refill,
    };
  }

  /** Sort helper: most urgent first (out, critical, low...), then lowest DOS. */
  function urgency(a, b) {
    return a.status_rank - b.status_rank || (a.dos ?? 1e9) - (b.dos ?? 1e9) || b.sold - a.sold;
  }

  function summary(rows) {
    const out = Object.fromEntries(STATUS.map((s) => [s.key, 0]));
    for (const r of rows) out[r.status]++;
    return out;
  }

  const api = { calc, urgency, summary, STATUS, BANDS, WINDOWS };
  return api;
})();
export default api;
