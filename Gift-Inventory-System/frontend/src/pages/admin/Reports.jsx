/* Reports with filters + formatted Excel / PDF / CSV exports (from pages-reports.js). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import BusyButton from '../../components/BusyButton';
import { LoadingBlock, ErrorBlock, PageHead, ratio } from '../../components/ui';
import { toast, toastError } from '../../components/Toasts';
import FilterBar from '../../components/admin/FilterBar';
import ReportTable from '../../components/admin/ReportTable';
import { TxnList } from '../../components/admin/Transactions';
import useApi from '../../hooks/useApi';
import { api, download } from '../../services/api';
import { fmt } from '../../utils/format';
import { rangeDates, clean, filterText } from '../../utils/admin';
import Excel from '../../utils/excel';
import { exportPdf } from '../../utils/pdf';
import DOS from '../../utils/shared/dos-calc';
import { usePageMeta } from '../../context/PageMetaContext';
import { useLookups } from '../../context/LookupsContext';
import { useLiveRefresh } from '../../context/SyncContext';

const ALL = ['range', 'city', 'market', 'promoter', 'shop', 'brand', 'model', 'gift'];
const REPORTS = {
  sales: { title: 'Mobile Sales Report', short: 'Mobile Sales', type: 'mobile-sales', desc: 'Mobile units sold and gifts given, grouped the way you choose.', filters: ALL.filter((k) => k !== 'gift'), group: true },
  gifts: { title: 'Gift Distribution Report', short: 'Gift Distribution', type: 'gift-distribution', desc: 'Gifts given per gift with the mobile units sold with them, and every transaction below.', filters: ALL, txns: true },
  promoters: { title: 'Promoter Performance Report', short: 'Promoters', type: 'promoter', desc: 'Shops, mobile units and gifts per promoter.', filters: ['range', 'city', 'market', 'shop', 'brand', 'model', 'promoter'] },
  shops: { title: 'Shop Performance Report', short: 'Shops', type: 'shop', desc: 'Mobile units, gifts and gift stock per shop.', filters: ['range', 'city', 'market', 'promoter', 'shop', 'brand', 'model'] },
  brands: { title: 'Brand Performance Report', short: 'Brands', type: 'brand', desc: 'Units, gifts and reach per mobile brand.', filters: ['range', 'city', 'market', 'promoter', 'shop', 'brand'] },
  models: { title: 'Model Performance Report', short: 'Models', type: 'model', desc: 'Units, gifts and reach per mobile model.', filters: ['range', 'city', 'market', 'promoter', 'shop', 'brand', 'model'] },
  inventory: { title: 'Gift Inventory Report', short: 'Gift Inventory', type: 'gift-inventory', desc: 'Shop-wise gift stock: Allocated, Given, Remaining. Remaining = Allocated − Given.', filters: ['city', 'market', 'promoter', 'shop', 'gift'] },
  remaining: { title: 'Remaining Inventory Report', short: 'Remaining', type: 'remaining-inventory', desc: 'Per gift: total stock, in warehouse, allocated, given and remaining.', filters: [] },
  transactions: { title: 'Transaction History', short: 'Transactions', type: 'transactions', desc: 'Every transaction with all fields (mobile sale + gift + photos).', filters: ALL },
  dos: { title: 'Gift DOS Report', short: 'Gift DOS', type: 'dos', desc: 'Days of Stock per shop and gift: Stock ÷ average gifts per day, with suggested refill.', filters: ['city', 'market', 'promoter', 'gift'], dos: true },
};
const GROUPS = [['brand', 'Brand'], ['model', 'Model'], ['shop', 'Shop'], ['shop_model', 'Shop × Model'], ['promoter', 'Promoter'], ['city', 'City'], ['market', 'Market'], ['day', 'Day'], ['month', 'Month']];

/** The 9 standard Excel exports (each can also go into one workbook). */
const EXPORTS = [
  ['Total Mobile Sales', 'transactions', { status: 'counted' }],
  ['Brand-wise Sales', 'brand'], ['Model-wise Sales', 'model'], ['Shop-wise Sales', 'mobile-sales', { group: 'shop_model' }],
  ['Promoter-wise Sales', 'promoter'], ['Gift Distribution', 'gift-distribution'], ['Gift Inventory', 'gift-inventory'],
  ['Remaining Inventory', 'remaining-inventory'], ['Transaction History', 'transactions'],
];
// filters are shared by all reports and kept while the app is open (like the original)
const st = { ...rangeDates('mtd'), city_id: '', market_id: '', promoter_id: '', shop_id: '', brand_id: '', model_id: '', gift_id: '', group: 'brand', status: '', days: 30, target: 30 };
const FKEY = { from: 'range', to: 'range', city_id: 'city', market_id: 'market', promoter_id: 'promoter', shop_id: 'shop', brand_id: 'brand', model_id: 'model', gift_id: 'gift' };

async function exportOne([title, type, extra], q, lk) {
  const query = clean({ ...q, ...(extra || {}) });
  if (extra && extra.status === 'counted') delete query.status;
  const r = await api(`/reports/${type}`, { query });
  if (extra && extra.status === 'counted') r.rows = r.rows.filter((x) => x.status !== 'rejected');
  return { title, subtitle: `${filterText(q, lk)} · Generated ${new Date().toLocaleString('en-GB')}`, columns: r.columns, rows: r.rows,
    totals: type === 'transactions' ? { mobile_qty: r.rows.reduce((a, x) => a + (x.mobile_qty || 0), 0), quantity: r.rows.reduce((a, x) => a + (x.quantity || 0), 0) } : r.totals, sheetName: title };
}

/** "Target DOS" input: applied on the native change event (blur / Enter / arrows), like the original. */
function TargetInput({ onCommit }) {
  const ref = useRef(null);
  const cb = useRef(onCommit);
  cb.current = onCommit;
  useEffect(() => {
    const el = ref.current;
    const h = () => cb.current(el.value);
    el.addEventListener('change', h);
    return () => el.removeEventListener('change', h);
  }, []);
  return <input ref={ref} className="input" type="number" id="rTarget" defaultValue={st.target} min="1" max="180" style={{ width: 76, minWidth: 76 }} />;
}

/** A new ?promoter= / ?shop= query re-runs the page, like the legacy route (the type is keyed in App.jsx). */
export default function Reports() {
  const { search } = useLocation();
  return <ReportsPage key={search} />;
}

function ReportsPage() {
  usePageMeta('Reports', 'Reports');
  const params = useParams();
  const [sp] = useSearchParams();
  const key = REPORTS[params.type] ? params.type : 'sales';
  const R = REPORTS[key];
  // links like /reports/gifts?promoter=5 or ?shop=3 (from a promoter or shop page) show all time for that promoter / shop
  useState(() => {
    const promoter = sp.get('promoter'), shop = sp.get('shop');
    if (promoter || shop) Object.assign(st, { from: '', to: '', promoter_id: promoter || '', shop_id: shop || '' });
    return null;
  });
  const { lkRef, allShops } = useLookups();
  const [f, setF] = useState(() => ({ ...st }));
  const fRef = useRef(f);
  const [sort, setSort] = useState(null);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState('');
  const [txnKey, setTxnKey] = useState(0);
  const dataRef = useRef(null);
  const seq = useRef(0);
  const shops = useApi(() => allShops(), []);
  useEffect(() => { if (shops.error) toastError(shops.error); }, [shops.error]);

  const query = (s = fRef.current) => {
    const q = {};
    for (const k of ['from', 'to', 'city_id', 'market_id', 'promoter_id', 'shop_id', 'brand_id', 'model_id', 'gift_id']) if (R.filters.includes(FKEY[k]) && s[k]) q[k] = s[k];
    if (R.group) q.group = s.group;
    if (R.status && s.status) q.status = s.status;
    if (R.dos) { q.days = s.days; q.target = s.target; }
    return q;
  };
  const subtitle = (s = fRef.current) => {
    const parts = [R.filters.length ? filterText(Object.assign({}, s, R.filters.includes('range') ? {} : { from: '', to: '' }), lkRef.current) : 'Current stock'];
    if (R.group) parts.push(`Grouped by ${GROUPS.find((g) => g[0] === s.group)[1]}`);
    if (R.dos) parts.push(`Sales period: last ${s.days} days · Target DOS ${s.target} days`);
    return parts.join(' · ');
  };
  const txnQuery = (s = fRef.current) => { const q = query(s); delete q.group; return q; };

  const load = useCallback(async () => {
    const my = ++seq.current;
    setBusy(true);
    try {
      const d = await api(`/reports/${R.type}`, { query: query() });
      if (my !== seq.current) return;
      const t = d.totals || {};
      const bits = [`${fmt.n(d.rows.length)} rows`];
      if (t.units !== undefined) bits.push(`${fmt.n(t.units)} mobile units`, ...(t.gifts !== undefined ? [`${fmt.n(t.gifts)} gifts`] : []), `ratio ${ratio(t.ratio)}`);
      if (t.mobile_units !== undefined) bits.push(`${fmt.n(t.mobile_units)} mobile units`, `${fmt.n(t.gifts_given)} gifts`);
      if (t.given !== undefined) bits.push(`${fmt.n(t.given)} gifts given`);
      if (t.remaining !== undefined) bits.push(`${fmt.n(t.remaining)} remaining`);
      dataRef.current = d;
      setData(d); setErr(null);
      setSummary(`${bits.join(' · ')} — ${subtitle()}`);
    } catch (e) {
      if (my === seq.current) setErr(e);
    } finally { if (my === seq.current) setBusy(false); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // first load once the shop list (filter names) is ready
  const started = useRef(false);
  useEffect(() => { if (shops.data && !started.current) { started.current = true; load(); } }, [shops.data, load]);
  // live sync: the transaction list reloads itself; reports without it reload their data (legacy page re-run)
  useLiveRefresh(() => { if (!R.txns && started.current) load(); });

  const change = (patch, resetSort) => {
    Object.assign(st, patch);
    fRef.current = { ...st };
    setF(fRef.current);
    if (resetSort) setSort(null);
    if (R.txns) setTxnKey((k) => k + 1); // legacy load(): the transaction list goes back to page 1 and reloads
    load();
  };
  const onSort = (k) => setSort((s) => ({ key: k, dir: s && s.key === k && s.dir === 'desc' ? 'asc' : 'desc' }));

  const onXls = async () => {
    const d = dataRef.current;
    if (!d || !d.rows.length) return toast('Nothing to export', 'warn');
    try {
      await Excel.exportReport({ title: R.title, subtitle: `${subtitle()} · Generated ${new Date().toLocaleString('en-GB')}`, columns: d.columns, rows: d.rows, totals: d.totals, filename: `${R.type}-report-${fmt.today()}.xlsx`, sheetName: R.short });
    } catch (e) { toastError(e); }
    return undefined;
  };
  const onCsv = () => download(`/reports/${R.type}`, { ...query(), format: 'csv' }).catch(toastError);
  const onPdf = () => {
    const d = dataRef.current;
    if (!d || !d.rows.length) return toast('Nothing to export', 'warn');
    exportPdf({ title: R.title, subtitle: subtitle(), columns: d.columns, rows: d.rows, totals: d.totals, filename: `${R.type}-report-${fmt.today()}.pdf` }).catch(toastError);
    return undefined;
  };
  const onTxnXls = async () => {
    try {
      const r = await api('/reports/transactions', { query: txnQuery() });
      if (!r.rows.length) return toast('Nothing to export', 'warn');
      await Excel.exportReport({ title: 'All Transactions', subtitle: `${subtitle()} · Generated ${new Date().toLocaleString('en-GB')}`, columns: r.columns, rows: r.rows,
        totals: { mobile_qty: r.rows.reduce((a, x) => a + (x.mobile_qty || 0), 0), quantity: r.rows.reduce((a, x) => a + (x.quantity || 0), 0) }, filename: `transactions-${fmt.today()}.xlsx`, sheetName: 'Transactions' });
    } catch (e) { toastError(e); }
    return undefined;
  };
  const exportQuery = () => { const s = fRef.current; return clean({ from: s.from, to: s.to, city_id: s.city_id, market_id: s.market_id, promoter_id: s.promoter_id, shop_id: s.shop_id, brand_id: s.brand_id, model_id: s.model_id, gift_id: s.gift_id }); };
  const onExport = async (i) => {
    try {
      const x = EXPORTS[i];
      const sh = await exportOne(x, exportQuery(), lkRef.current);
      await Excel.exportWorkbook([sh], `${x[0].toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${fmt.today()}.xlsx`);
    } catch (e) { toastError(e); }
  };
  const onAll = async () => {
    try {
      const q = exportQuery();
      const sheets = [];
      for (const x of EXPORTS) sheets.push(await exportOne(x, q, lkRef.current));
      await Excel.exportWorkbook(sheets, `gift-inventory-sales-reports-${fmt.today()}.xlsx`);
      toast('Workbook with 9 sheets downloaded', 'ok');
    } catch (e) { toastError(e); }
  };

  const txnBase = useMemo(() => txnQuery(f), [f]); // eslint-disable-line react-hooks/exhaustive-deps

  if (shops.error && !shops.data) return <ErrorBlock message={shops.error.message} onRetry={shops.reload} />;
  if (!shops.data) return <LoadingBlock />;

  // like the original: an error replaces the table (no retry button); the next load fades it until new data arrives
  let body;
  if (!data && (busy || !err)) body = <LoadingBlock />;
  else if (err) body = <ErrorBlock message={err.message} />;
  else body = <ReportTable data={data} sort={sort} onSort={onSort} />;

  return (
    <>
      <PageHead title={R.title} desc={R.desc} />
      <div className="report-tabs">{Object.entries(REPORTS).map(([k, r]) => <Link key={k} to={`/admin/reports/${k}`} className={k === key ? 'on' : ''}>{r.short}</Link>)}</div>
      <section className="panel">
        {R.filters.length ? <FilterBar keys={R.filters} value={f} onChange={(p) => change(p)} /> : null}
        {R.group || R.status || R.dos ? (
          <div className="filters" id="rExtra">
            {R.group ? <><label className="small muted">Group by</label><div className="seg" id="rGroup">{GROUPS.map(([g, l]) => <button key={g} className={g === f.group ? 'on' : ''} onClick={() => change({ group: g }, true)}>{l}</button>)}</div></> : null}
            {R.status ? <><label className="small muted">Status</label><select className="select" id="rStatus" value={f.status} onChange={(e) => change({ status: e.target.value })}><option value="">All</option><option value="open">Waiting (Submitted + Pending Review)</option><option value="pending">Submitted</option><option value="review">Pending Review</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></> : null}
            {R.dos ? <><label className="small muted">Sales period</label><select className="select" id="rDays" value={f.days} onChange={(e) => change({ days: Number(e.target.value) })}>{DOS.WINDOWS.map((d) => <option key={d} value={d}>Last {d} days</option>)}</select>
              <label className="small muted">Target DOS</label><TargetInput onCommit={(v) => change({ target: Number(v) || 30 })} /></> : null}
          </div>
        ) : null}
        <div className="panel-h" style={{ borderBottom: '1px solid var(--line)' }}><div className="sub" id="rSummary">{summary}</div>
          <div className="row" style={{ marginLeft: 'auto', gap: 6 }}>
            <BusyButton className="btn sm primary" id="rXls" onClick={onXls}><Icon name="sheet" />Excel</BusyButton>
            <button className="btn sm" id="rPdf" onClick={onPdf}><Icon name="file" />PDF</button>
            <BusyButton className="btn sm" id="rCsv" onClick={onCsv}><Icon name="download" />CSV</BusyButton>
            <button className="btn sm" id="rPrint" onClick={() => window.print()}><Icon name="print" />Print</button></div></div>
        <div id="rBody" style={busy && data ? { opacity: 0.55 } : undefined}>{body}</div>
      </section>
      {R.txns ? (
        <section className="panel" style={{ marginTop: 16 }}><div className="panel-h"><h2><Icon name="receipt" /> All Transactions</h2><span className="sub">Every sale: mobile sold + gift given · uses the filters above · click a row to see both photos</span>
          <BusyButton className="btn sm" style={{ marginLeft: 'auto' }} id="rTxnXls" onClick={onTxnXls}><Icon name="sheet" />Export Excel</BusyButton></div>
          <div id="rTxns"><TxnList base={txnBase} reloadKey={txnKey} /></div></section>
      ) : null}
      <section className="panel" style={{ marginTop: 16 }}><div className="panel-h"><h2><Icon name="sheet" /> Excel exports</h2><span className="sub">Formatted .xlsx with headers, filters, totals and column widths · uses the filters above</span>
        <BusyButton className="btn sm primary" style={{ marginLeft: 'auto' }} id="xAll" busyText="Building workbook…" onClick={onAll}><Icon name="layers" />All 9 in one workbook</BusyButton></div>
        <div className="export-grid">{EXPORTS.map(([t], i) => <BusyButton key={i} className="export-btn" onClick={() => onExport(i)}><Icon name="sheet" /><span>{t}</span></BusyButton>)}</div></section>
    </>
  );
}
