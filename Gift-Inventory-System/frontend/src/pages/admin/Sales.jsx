/* Mobile Sales: All Sales, Brand-wise, Model-wise, Shop-wise (from pages-sales.js). */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import DataTable from '../../components/DataTable';
import BusyButton from '../../components/BusyButton';
import { Chip, EmptyState, LoadingBlock, ErrorBlock, PageHead, ratio } from '../../components/ui';
import { toastError } from '../../components/Toasts';
import ChartCanvas from '../../components/admin/ChartCanvas';
import FilterBar from '../../components/admin/FilterBar';
import { openTransaction, ProofThumb } from '../../components/admin/Transactions';
import usePaged, { PagedView } from '../../hooks/usePaged';
import useApi from '../../hooks/useApi';
import { api } from '../../services/api';
import { fmt } from '../../utils/format';
import { rangeDates, clean, filterText, PALETTE } from '../../utils/admin';
import Excel from '../../utils/excel';
import { exportPdf } from '../../utils/pdf';
import { usePageMeta } from '../../context/PageMetaContext';
import { useLookups } from '../../context/LookupsContext';
import { useSync } from '../../context/SyncContext';

// filters are shared by the four sales pages and kept while the app is open (like the original)
const st = { ...rangeDates('mtd'), city_id: '', market_id: '', promoter_id: '', shop_id: '', brand_id: '', model_id: '' };
const FILTERS = ['range', 'city', 'market', 'promoter', 'shop', 'brand', 'model'];
const TABS = [['', 'All Sales'], ['brands', 'Brand-wise'], ['models', 'Model-wise'], ['shops', 'Shop-wise']];
let shopView = 'lines';

const KpiStrip = ({ s }) => (
  <div className="kpis kpis-sm">
    <div className="kpi"><div className="k-label">Mobile units sold</div><div className="k-value">{fmt.n(s.units)}</div></div>
    <div className="kpi"><div className="k-label">Gifts given</div><div className="k-value">{fmt.n(s.gifts)}</div></div>
    <div className="kpi"><div className="k-label">Gift-to-Mobile ratio</div><div className="k-value">{ratio(s.ratio)}</div></div>
    <div className="kpi"><div className="k-label">Sales (transactions)</div><div className="k-value">{fmt.n(s.txns)}</div></div>
    <div className="kpi"><div className="k-label">Shops selling</div><div className="k-value">{fmt.n(s.shops)}</div></div>
    <div className="kpi"><div className="k-label">Promoters selling</div><div className="k-value">{fmt.n(s.promoters)}</div></div>
  </div>
);

/** Page head + tabs + filter bar + KPI strip + body (legacy shell()). */
function Shell({ tab, title, desc, f, onFilter, onXls, onPdf, kpi, bodyStyle, children }) {
  return (
    <>
      <PageHead title={title} desc={desc} actions={<>
        <BusyButton className="btn" id="sXls" onClick={onXls}><Icon name="sheet" />Export Excel</BusyButton>
        <BusyButton className="btn" id="sPdf" onClick={onPdf}><Icon name="file" />PDF</BusyButton>
      </>} />
      <section className="panel">
        <div className="tabs">{TABS.map(([k, l]) => <Link key={k} className={`tab ${k === tab ? 'on' : ''}`} to={`/admin/sales${k ? '/' + k : ''}`}>{l}</Link>)}</div>
        <FilterBar keys={FILTERS} value={f} onChange={onFilter} />
        <div id="sKpi" style={{ padding: '12px 16px 0' }}>{kpi ? <KpiStrip s={kpi} /> : null}</div>
        <div id="sBody" style={bodyStyle}>{children}</div>
      </section>
    </>
  );
}

/** Module filter state + a React copy; returns [f, fRef, apply(patch)]. */
function useSalesFilters() {
  const [f, setF] = useState(() => ({ ...st }));
  const fRef = useRef(f);
  const apply = (patch) => {
    Object.assign(st, patch);
    fRef.current = { ...st };
    setF(fRef.current);
  };
  return [f, fRef, apply];
}

/* ------------------------------ All Sales ------------------------------ */
const listCols = [
  { label: 'Transaction', render: (t) => <><div className="cell-main mono">{t.transaction_id}</div><div className="cell-sub">{fmt.date(t.created_at)} · {fmt.time(t.created_at)}</div></> },
  { label: 'Promoter', render: (t) => <><div>{t.promoter_name}</div><div className="cell-sub mono">{t.promoter_code}</div></> },
  { label: 'Shop', render: (t) => <><div className="cell-main">{t.shop_name}</div><div className="cell-sub">{t.shop_id} · {t.market_name}</div></> },
  { label: 'Brand / Model', render: (t) => (t.model_name ? <><div className="cell-main">{t.brand_name || ''} {t.model_name}</div><div className="cell-sub mono">{t.item_code}</div></> : <span className="muted">—</span>) },
  { label: 'Mobile qty', num: true, render: (t) => <b>{t.mobile_qty === null ? '—' : fmt.n(t.mobile_qty)}</b> },
  { label: 'Gift', render: (t) => <div>{t.gift_name}</div> },
  { label: 'Gift qty', num: true, render: (t) => <b>{fmt.n(t.quantity)}</b> },
  { label: 'Proof', render: (t) => <div className="thumbs">
    {t.has_mobile_photo ? <ProofThumb title="Mobile sale proof" path={`/files/transactions/${t.transaction_id}/mobile-photo`} /> : null}
    {t.has_photo ? <ProofThumb title="Gift proof" path={`/files/transactions/${t.transaction_id}/photo`} /> : null}</div> },
  { label: 'Status', render: (t) => <Chip status={t.status} /> },
];

/** Apply ?brand= / ?shop= links to the shared filters (legacy route query). */
function applyQuery(sp) {
  const patch = {};
  if (sp.get('brand')) patch.brand_id = sp.get('brand');
  if (sp.get('shop')) Object.assign(patch, { shop_id: sp.get('shop') }, rangeDates('all'));
  return patch;
}

export function SalesList() {
  usePageMeta('All Sales', 'Mobile Sales');
  const [sp] = useSearchParams();
  const { lkRef, allShops } = useLookups();
  const qs = sp.toString();
  // ?brand= / ?shop= are applied before anything loads; a later query change (same page) re-applies them
  useState(() => { Object.assign(st, applyQuery(sp)); return null; });
  const [f, fRef, apply] = useSalesFilters();
  const lastQs = useRef(qs);
  const shops = useApi(() => allShops(), []);

  const list = usePaged({
    initial: { dir: 'desc', status: '' },
    fetch: (s) => api('/transactions', { query: clean({ ...fRef.current, status: s.status, page: s.page, pageSize: s.pageSize, dir: 'desc' }) }),
  });
  const kpis = useApi(() => api('/sales/summary', { query: clean(fRef.current), quiet: true }), [], { live: false });
  useEffect(() => { if (kpis.error) toastError(kpis.error); }, [kpis.error]);
  useEffect(() => { if (shops.error) toastError(shops.error); }, [shops.error]);

  const onFilter = (patch) => { apply(patch); list.set({}); kpis.reload(); };
  useEffect(() => {
    if (lastQs.current === qs) return; // (also skips StrictMode's second mount run)
    lastQs.current = qs;
    onFilter(applyQuery(sp));
  }, [qs]); // eslint-disable-line react-hooks/exhaustive-deps

  const onXls = async () => {
    try {
      const r = await api('/reports/transactions', { query: clean({ ...fRef.current, status: list.state.status }) });
      await Excel.exportReport({ title: 'Total Mobile Sales', subtitle: `${filterText(fRef.current, lkRef.current)} · Generated ${new Date().toLocaleString('en-GB')}`, columns: r.columns, rows: r.rows, totals: { mobile_qty: r.totals.mobile_qty, quantity: r.totals.quantity }, filename: `mobile-sales-${fmt.today()}.xlsx`, sheetName: 'Mobile Sales' });
    } catch (e) { toastError(e); }
  };
  const onPdf = async () => {
    try {
      const r = await api('/reports/mobile-sales', { query: clean({ ...fRef.current, group: 'shop_model' }) });
      await exportPdf({ title: 'Mobile Sales', subtitle: filterText(fRef.current, lkRef.current), columns: r.columns, rows: r.rows, totals: r.totals, filename: `mobile-sales-${fmt.today()}.pdf` });
    } catch (e) { toastError(e); }
  };

  if (shops.error && !shops.data) return <ErrorBlock message={shops.error.message} onRetry={shops.reload} />;
  if (kpis.error && !kpis.data) return <ErrorBlock message={kpis.error.message} onRetry={() => { kpis.reload(); list.reload(); }} />;
  if (!shops.data) return <LoadingBlock />;
  return (
    <Shell tab="" title="All Mobile Sales" desc="Every sale recorded by promoters: mobile sold + gift given, with both proof photos."
      f={f} onFilter={onFilter} onXls={onXls} onPdf={onPdf} kpi={kpis.data && kpis.data.summary}>
      <PagedView list={list}>{(d) => (
        <DataTable cols={listCols} rows={d.rows} rowKey="transaction_id"
          onRow={(t) => openTransaction(t.transaction_id, () => { list.reload(); kpis.reload(); })}
          empty={<EmptyState title="No sales found" text="Try a wider date range or fewer filters." />} />
      )}</PagedView>
    </Shell>
  );
}

/* ------------------------------ grouped pages ------------------------------ */
const tot = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
const barCfg = (rows, label) => ({
  type: 'bar',
  data: { labels: rows.map(label), datasets: [
    { label: 'Mobile units', data: rows.map((r) => r.units), backgroundColor: PALETTE[0], borderRadius: 3, maxBarThickness: 34 },
    { label: 'Gifts given', data: rows.map((r) => r.gifts), backgroundColor: '#9fd6c0', borderRadius: 3, maxBarThickness: 34 },
  ] },
  options: { scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'bottom' } }, interaction: { mode: 'index', intersect: false } },
});

/* Brand-wise: click a brand to see its models */
function BrandsBody({ d }) {
  const rows = d.brands;
  const [open, setOpen] = useState(() => new Set());
  useEffect(() => { setOpen(new Set()); }, [d]);
  const config = useMemo(() => (rows.length ? barCfg(rows, (r) => r.brand_name) : null), [rows]);
  const toggle = (i) => setOpen((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  if (!rows.length) return <EmptyState title="No sales in this period" text="Sales recorded by promoters appear here." />;
  return (
    <>
      <div className="panel-b"><div className="chart-box"><ChartCanvas id="cB" config={config} /></div></div>
      <div className="table-wrap"><table className="tbl drill"><thead><tr><th style={{ width: 28 }} /><th>Brand</th><th className="num">Units sold</th><th className="num">Share</th><th className="num">Gifts given</th><th className="num">Gift ratio</th><th className="num">Transactions</th><th className="num">Shops</th><th className="num">Promoters</th></tr></thead>
        <tbody>{rows.map((b, i) => (
          <Fragment key={i}>
            <tr className={`clickable brand-line ${open.has(i) ? 'open' : ''}`.trim()} onClick={() => toggle(i)}><td><Icon name="chevron" className="caret" /></td><td><b>{b.brand_name}</b> <span className="muted mono small">{b.brand_code || ''}</span></td>
              <td className="num"><b>{fmt.n(b.units)}</b></td><td className="num">{d.summary.units ? Math.round((b.units / d.summary.units) * 100) : 0}%</td><td className="num">{fmt.n(b.gifts)}</td><td className="num">{ratio(b.ratio)}</td>
              <td className="num">{fmt.n(b.txns)}</td><td className="num">{fmt.n(b.shops)}</td><td className="num">{fmt.n(b.promoters)}</td></tr>
            <tr className={`sub-rows ${open.has(i) ? '' : 'hidden'}`.trim()}><td /><td colSpan={8}><table className="tbl compact inner"><thead><tr><th>Model</th><th>Model ID</th><th className="num">Units</th><th className="num">Gifts</th><th className="num">Ratio</th><th className="num">Transactions</th></tr></thead>
              <tbody>{b.models.map((m, j) => <tr key={j}><td>{m.model_name}</td><td className="mono muted">{m.item_code || ''}</td><td className="num"><b>{fmt.n(m.units)}</b></td><td className="num">{fmt.n(m.gifts)}</td><td className="num">{ratio(m.ratio)}</td><td className="num">{fmt.n(m.txns)}</td></tr>)}</tbody>
              <tfoot><tr><td>Total {b.brand_name}</td><td /><td className="num">{fmt.n(b.units)}</td><td className="num">{fmt.n(b.gifts)}</td><td className="num">{ratio(b.ratio)}</td><td className="num">{fmt.n(b.txns)}</td></tr></tfoot></table></td></tr>
          </Fragment>
        ))}</tbody>
        <tfoot><tr><td /><td>Total</td><td className="num">{fmt.n(d.summary.units)}</td><td className="num">100%</td><td className="num">{fmt.n(d.summary.gifts)}</td><td className="num">{ratio(d.summary.ratio)}</td><td className="num">{fmt.n(d.summary.txns)}</td><td /><td /></tr></tfoot></table></div>
    </>
  );
}

/* Model-wise */
function ModelsBody({ d }) {
  const rows = d.models;
  const config = useMemo(() => {
    if (!rows.length) return null;
    const top = rows.slice(0, 15);
    return { type: 'bar',
      data: { labels: top.map((m) => `${m.brand_name} ${m.model_name}`), datasets: [{ label: 'Mobile units', data: top.map((m) => m.units), backgroundColor: PALETTE[2], borderRadius: 3, maxBarThickness: 18 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { grid: { display: false } } } } };
  }, [rows]);
  return (
    <>
      {rows.length ? <div className="panel-b"><div className="chart-box tall"><ChartCanvas id="cM" config={config} /></div></div> : null}
      <DataTable rows={rows} cols={[
        { label: 'Brand', key: 'brand_name' }, { label: 'Model ID', render: (m) => <span className="mono">{m.item_code || '—'}</span> }, { label: 'Model', render: (m) => <b>{m.model_name}</b> },
        { label: 'Units sold', num: true, key: 'units', render: (m) => <b>{fmt.n(m.units)}</b> }, { label: 'Gifts given', num: true, key: 'gifts' }, { label: 'Gift ratio', num: true, render: (m) => ratio(m.ratio) },
        { label: 'Transactions', num: true, key: 'txns' }, { label: 'Shops', num: true, key: 'shops' }, { label: 'Promoters', num: true, key: 'promoters' },
      ]} footer={{ units: tot(rows, 'units'), gifts: tot(rows, 'gifts'), txns: tot(rows, 'txns') }} empty={<EmptyState title="No sales in this period" text="" />} />
    </>
  );
}

/* Shop-wise: Shop | City | Market | Brand | Model | Quantity */
function ShopsBody({ d }) {
  const navigate = useNavigate();
  const { reloadPage } = useSync();
  const lines = d.shop_models; const shops = d.shops;
  const pick = (v) => { shopView = v; reloadPage(); };
  return (
    <>
      <div className="filters" style={{ borderBottom: 0 }}><div className="seg" id="svMode">
        <button className={shopView === 'lines' ? 'on' : ''} onClick={() => pick('lines')}>Shop × Model</button>
        <button className={shopView === 'shops' ? 'on' : ''} onClick={() => pick('shops')}>Shop totals</button></div></div>
      {shopView === 'lines' ? (
        <DataTable rows={lines} cols={[
          { label: 'Shop', render: (r) => <><div className="cell-main">{r.shop_name}</div><div className="cell-sub mono">{r.shop_id}</div></> }, { label: 'City', key: 'city_name' }, { label: 'Market', key: 'market_name' },
          { label: 'Brand', key: 'brand_name' }, { label: 'Model', render: (r) => <>{r.model_name} <span className="muted mono small">{r.item_code || ''}</span></> },
          { label: 'Quantity', num: true, key: 'units', render: (r) => <b>{fmt.n(r.units)}</b> }, { label: 'Gifts given', num: true, key: 'gifts' }, { label: 'Gift ratio', num: true, render: (r) => ratio(r.ratio) },
        ]} footer={{ units: tot(lines, 'units'), gifts: tot(lines, 'gifts') }} empty={<EmptyState title="No sales in this period" text="" />} />
      ) : (
        <DataTable rows={shops} onRow={(r) => navigate('/admin/shops/' + r.shop_id)} cols={[
          { label: 'Shop', render: (r) => <><div className="cell-main">{r.shop_name}</div><div className="cell-sub mono">{r.shop_id}</div></> }, { label: 'City', key: 'city_name' }, { label: 'Market', key: 'market_name' },
          { label: 'Mobile units', num: true, key: 'units', render: (r) => <b>{fmt.n(r.units)}</b> }, { label: 'Gifts given', num: true, key: 'gifts' }, { label: 'Gift ratio', num: true, render: (r) => ratio(r.ratio) },
          { label: 'Transactions', num: true, key: 'txns' }, { label: 'Promoters', num: true, key: 'promoters' },
        ]} footer={{ units: tot(shops, 'units'), gifts: tot(shops, 'gifts'), txns: tot(shops, 'txns') }} empty={<EmptyState title="No sales in this period" text="" />} />
      )}
    </>
  );
}

const GROUPED = {
  brands: { tab: 'brands', title: 'Brand-wise Sales', desc: 'Mobile units sold per brand. Click a brand to see its models.', report: { type: 'brand', file: 'brand-wise-sales' }, Body: BrandsBody },
  models: { tab: 'models', title: 'Model-wise Sales', desc: 'Mobile units sold per model.', report: { type: 'model', file: 'model-wise-sales' }, Body: ModelsBody },
  shops: { tab: 'shops', title: 'Shop-wise Sales', desc: 'Which brands and models sold at each shop.', report: { type: 'mobile-sales', group: 'shop_model', file: 'shop-wise-sales' }, Body: ShopsBody },
};

function GroupedPage({ kind }) {
  const G = GROUPED[kind] || GROUPED.brands;
  const { title, desc, report, Body } = G;
  usePageMeta(title, 'Mobile Sales');
  const { lkRef, allShops } = useLookups();
  const [f, fRef, apply] = useSalesFilters();
  const shops = useApi(() => allShops(), []);
  const q = useApi(() => api('/sales/summary', { query: clean(fRef.current) }), []);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.error) toastError(q.error); }, [q.error]);
  useEffect(() => { if (shops.error) toastError(shops.error); }, [shops.error]);

  const onFilter = async (patch) => { apply(patch); setBusy(true); await q.reload(); setBusy(false); };
  const exportRows = () => api(`/reports/${report.type}`, { query: clean({ ...fRef.current, ...(report.group ? { group: report.group } : {}) }) });
  const onXls = async () => {
    try {
      const r = await exportRows();
      await Excel.exportReport({ title, subtitle: `${filterText(fRef.current, lkRef.current)} · Generated ${new Date().toLocaleString('en-GB')}`, columns: r.columns, rows: r.rows, totals: r.totals, filename: `${report.file}-${fmt.today()}.xlsx`, sheetName: title });
    } catch (e) { toastError(e); }
  };
  const onPdf = async () => {
    try {
      const r = await exportRows();
      await exportPdf({ title, subtitle: filterText(fRef.current, lkRef.current), columns: r.columns, rows: r.rows, totals: r.totals, filename: `${report.file}-${fmt.today()}.pdf` });
    } catch (e) { toastError(e); }
  };

  if (shops.error && !shops.data) return <ErrorBlock message={shops.error.message} onRetry={shops.reload} />;
  if (q.error && !q.data) return <ErrorBlock message={q.error.message} onRetry={q.reload} />;
  if (!shops.data) return <LoadingBlock />;
  return (
    <Shell tab={G.tab} title={title} desc={desc} f={f} onFilter={onFilter} onXls={onXls} onPdf={onPdf} kpi={q.data && q.data.summary} bodyStyle={busy ? { opacity: 0.55 } : undefined}>
      {q.data ? <Body d={q.data} /> : <LoadingBlock />}
    </Shell>
  );
}

/** /sales/brands | /sales/models | /sales/shops — keyed so each tab gets fresh page state. */
export function SalesGrouped({ kind }) {
  return <GroupedPage key={kind} kind={kind} />;
}
