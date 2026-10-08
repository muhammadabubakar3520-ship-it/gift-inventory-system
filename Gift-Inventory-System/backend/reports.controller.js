'use strict';
/* =====================================================================
   reports.js — report data for the Reports pages and Excel exports.
   The definitions live in public/js/report-defs.js (shared with the server).
   Every report returns { columns, rows, totals } (or CSV with ?format=csv).
   ===================================================================== */
module.exports = function register(G) {
  const { S, R } = G;
  G.giftViews = () => S.gifts.map(G.giftView);
  const reports = G.ReportDefs.build(G);
  G.runReport = reports.run;

  R('GET', '/reports/:type', 'admin', ({ params, query }) => {
    const r = reports.run(params.type, query);
    if (!r) throw G.notFound('Report');
    if (query.format === 'csv') return G.csv(`${r.name}.csv`, r.columns.map((c) => ({ label: c.label, key: c.key })), r.rows);
    return r;
  });
};
