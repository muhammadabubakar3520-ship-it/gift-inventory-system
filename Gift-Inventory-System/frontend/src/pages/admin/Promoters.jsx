/* Promoters: list, assign shops, performance, promoter performance, promoter details (from pages-promoters.js). */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import DataTable from '../../components/DataTable';
import { Chip, EmptyState, PageHead, SearchBox, AuthImage, LoadingBlock, ErrorBlock, ratio } from '../../components/ui';
import { confirmDialog } from '../../components/Modal';
import BusyButton from '../../components/BusyButton';
import { toast, toastError } from '../../components/Toasts';
import { openUserForm, toggleUser } from '../../components/admin/UserForm';
import { openTransaction } from '../../components/admin/Transactions';
import FilterBar from '../../components/admin/FilterBar';
import ChartCanvas from '../../components/admin/ChartCanvas';
import { cityOpts, marketOpts } from '../../components/admin/options';
import usePaged, { PagedView } from '../../hooks/usePaged';
import useApi from '../../hooks/useApi';
import { api } from '../../services/api';
import { fmt } from '../../utils/format';
import { RANGES, rangeDates, clean, filterText, PALETTE } from '../../utils/admin';
import { exportPdf } from '../../utils/pdf';
import Excel from '../../utils/excel';
import { usePageMeta } from '../../context/PageMetaContext';
import { useLookups } from '../../context/LookupsContext';
import { useHoldLive, useLiveRefresh } from '../../context/SyncContext';

/**
 * Load data and keep the previous result on screen while filters change. The first failure shows an
 * error block; later failures (filter change, live refresh) only show a toast, like the original.
 */
function useKeptApi(fn, deps) {
  const [data, setData] = useState(undefined);
  const [error, setError] = useState(null);
  const seq = useRef(0);
  const has = useRef(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const load = useCallback(async () => {
    const my = ++seq.current;
    try {
      const d = await fnRef.current();
      if (my === seq.current) { setData(d); setError(null); has.current = true; }
    } catch (e) {
      if (my !== seq.current) return;
      if (has.current) toastError(e); else setError(e);
    }
  }, []);
  useEffect(() => { load(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useLiveRefresh(() => load());
  return { data, error, reload: load, retry: () => { setError(null); load(); } };
}

/* ------------------------------ Promoter list ------------------------------ */
export function PromoterList() {
  usePageMeta('Promoter List', 'Promoters');
  const navigate = useNavigate();
  const list = usePaged({ initial: { role: 'promoter', search: '', status: '' }, fetch: async (st) => ({ rows: await api('/users', { query: st }) }) });
  const cols = [
    { label: 'Promoter', render: (u) => <><div className="cell-main">{u.name}</div><div className="cell-sub mono">{u.user_code}</div></> },
    { label: 'Contact', render: (u) => <><div>{u.phone || '—'}</div><div className="cell-sub">{u.email}</div></> },
    { label: 'Shops', num: true, render: (u) => <>{fmt.n(u.active_shops)}{u.shops_assigned !== u.active_shops ? <span className="muted"> / {fmt.n(u.shops_assigned)}</span> : null}</> },
    { label: 'Mobile units', num: true, render: (u) => <b>{fmt.n(u.mobile_units)}</b> },
    { label: 'Gifts given', num: true, key: 'gifts_given' },
    { label: 'Last sale', render: (u) => <span className="muted nowrap">{u.last_txn_at ? fmt.ago(u.last_txn_at) : '—'}</span> },
    { label: 'Status', render: (u) => <Chip status={u.status} /> },
    { label: '', cls: 'actions', render: (u) => <>
      <button className="btn sm" onClick={() => navigate(`/admin/promoters/${u.id}/performance`)}>Performance</button>{' '}
      <button className="btn sm ghost" title="Edit" onClick={() => openUserForm(u, 'promoter', list.reload)}><Icon name="edit" /></button>
    </> },
  ];
  return (
    <>
      <PageHead title="Promoters" desc="Field promoters, their assigned shops and their sales." actions={<>
        <Link className="btn" to="/admin/import/promoters"><Icon name="upload" />Upload promoters (Excel)</Link><Link className="btn" to="/admin/promoters/assign"><Icon name="link" />Assign shops</Link><button className="btn primary" id="pAdd" onClick={() => openUserForm(null, 'promoter', list.reload)}><Icon name="plus" />Add promoter</button>
      </>} />
      <section className="panel">
        <div className="filters" id="pFilters">
          <SearchBox value={list.state.search} onChange={(v) => list.set({ search: v })} placeholder="Search name, email, phone, Promoter ID" />
          <select className="select" value={list.state.status} onChange={(e) => list.set({ status: e.target.value })}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
        </div>
        <div id="pList">
          <PagedView list={list}>{(d) => (
            <DataTable rows={d.rows} cols={cols} onRow={(u) => navigate('/admin/promoters/' + u.id)}
              empty={<EmptyState title="No promoters yet" text="Add promoters so they can sign in to the mobile app." />} />
          )}</PagedView>
        </div>
      </section>
    </>
  );
}

/* ------------------------------ Assign shops ------------------------------ */
export function AssignShops() {
  usePageMeta('Assign Shops', 'Promoters');
  useHoldLive();
  const [sp] = useSearchParams();
  const qp = sp.get('promoter') || '';
  const { loadLookups } = useLookups();
  const { data, error, reload } = useApi(async () => {
    const l = await loadLookups();
    const promoters = l.promoters.filter((p) => p.status === 'active');
    if (!promoters.length) return { promoters, shops: [] };
    const shops = (await api('/shops', { query: { all: '1' } })).rows;
    return { promoters, shops };
  }, [qp], { live: false }); // a new ?promoter= re-runs the page, like the original route
  if (error && !data) return <ErrorBlock message={error.message} onRetry={reload} />;
  if (!data) return <LoadingBlock />;
  return <AssignBody key={qp} promoters={data.promoters} initialShops={data.shops} initialPromoter={qp} />;
}

function AssignBody({ promoters, initialShops, initialPromoter }) {
  const { lk, lkRef } = useLookups();
  const [current, setCurrent] = useState(initialPromoter || (promoters[0] ? String(promoters[0].id) : ''));
  const [st, setSt] = useState({ search: '', city_id: '', market_id: '', show: 'all' });
  const [shops, setShops] = useState(initialShops);
  const [sel, setSel] = useState(() => new Set());

  if (!promoters.length) {
    return (
      <>
        <PageHead title="Assign Shops" desc="Choose a promoter, then tick the shops they work at. A promoter can only record sales at assigned shops." />
        <EmptyState title="No active promoters" text="Add promoters first." action={<Link className="btn primary" to="/admin/promoters">Go to promoters</Link>} />
      </>
    );
  }

  const p = promoters.find((x) => String(x.id) === current);
  const count = (id) => shops.filter((s) => String(s.promoter_id) === String(id)).length;
  const s = st.search.toLowerCase();
  const rows = shops.filter((x) => (!s || `${x.shop_id} ${x.shop_name} ${x.market_name}`.toLowerCase().includes(s)) && (!st.city_id || String(x.city_id) === st.city_id) && (!st.market_id || String(x.market_id) === st.market_id) &&
    (st.show === 'all' || (st.show === 'mine' && String(x.promoter_id) === current) || (st.show === 'none' && !x.promoter_id) || (st.show === 'other' && x.promoter_id && String(x.promoter_id) !== current)));
  const mine = shops.filter((x) => String(x.promoter_id) === current).length;

  const save = async (pid) => {
    const moving = shops.filter((x) => sel.has(x.id) && x.promoter_id && String(x.promoter_id) !== String(pid || ''));
    if (pid && moving.length && !(await confirmDialog({ title: 'Change assignment?', message: <>{moving.length} selected shop(s) are assigned to another promoter. They will move to <b>{p.name}</b>.</>, confirmText: 'Move shops' }))) return;
    try {
      const r = await api('/shops/bulk-assign', { method: 'POST', body: { ids: [...sel], promoter_id: pid || null } });
      toast(`${r.updated} shop(s) updated`, 'ok'); setSel(new Set());
      const fresh = (await api('/shops', { query: { all: '1' } })).rows;
      setShops(fresh);
      lkRef.current.shops = fresh; // like Admin.lk.shops = shops (shop cache for filters / quick search)
    } catch (e) { toastError(e); }
  };
  const n = sel.size;
  const SHOW = [['all', 'All shops'], ['mine', 'Assigned'], ['none', 'Unassigned'], ['other', 'Other promoter']];

  return (
    <>
      <PageHead title="Assign Shops" desc="Choose a promoter, then tick the shops they work at. A promoter can only record sales at assigned shops." />
      <div className="assign-grid">
        <section className="panel"><div className="panel-h"><h2>Promoters</h2></div>
          <div className="assign-people" id="aPeople">
            {promoters.map((x) => (
              <button key={x.id} className={`ap ${String(x.id) === current ? 'on' : ''}`} onClick={() => { setCurrent(String(x.id)); setSel(new Set()); }}>
                <span className="av">{x.name.split(/\s+/).map((y) => y[0]).slice(0, 2).join('').toUpperCase()}</span>
                <span className="nm"><b>{x.name}</b><small className="mono">{x.user_code}</small></span><span className="ct">{count(x.id)}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-h" id="aHead">{p && <><h2>{p.name}</h2><span className="sub">{fmt.n(mine)} shop(s) assigned</span></>}</div>
          <div className="filters" id="aF">
            <SearchBox value={st.search} onChange={(v) => setSt((x) => ({ ...x, search: v }))} placeholder="Search shop" delay={200} />
            <select className="select" id="aCity" value={st.city_id} onChange={(e) => { const v = e.target.value; setSt((x) => ({ ...x, city_id: v, market_id: '' })); }}>{cityOpts(lk)}</select>
            <select className="select" id="aMarket" value={st.market_id} onChange={(e) => { const v = e.target.value; setSt((x) => ({ ...x, market_id: v })); }}>{marketOpts(lk, st.city_id)}</select>
            <div className="seg" id="aShow">{SHOW.map(([k, l]) => <button key={k} className={st.show === k ? 'on' : ''} onClick={() => setSt((x) => ({ ...x, show: k }))}>{l}</button>)}</div>
          </div>
          <div id="aBar">{n > 0 && p && (
            <div className="bulkbar"><b>{n} selected</b>
              <BusyButton className="btn sm primary" id="aAssign" busyText="Saving…" onClick={() => save(current)}><Icon name="link" />Assign to {p.name}</BusyButton>
              <BusyButton className="btn sm" id="aUn" busyText="Saving…" onClick={() => save(null)}>Unassign</BusyButton><span className="spacer" /><button className="link-btn" id="aClr" onClick={() => setSel(new Set())}>Clear selection</button></div>
          )}</div>
          <div id="aList">
            <DataTable rows={rows} selectable selected={sel} onSelect={setSel} cols={[
              { label: 'Shop ID', render: (x) => <b className="mono">{x.shop_id}</b> }, { label: 'Shop', key: 'shop_name' }, { label: 'City', key: 'city_name' }, { label: 'Market', key: 'market_name' },
              { label: 'Assigned to', render: (x) => (String(x.promoter_id) === current ? <span className="chip approved">{x.promoter_name}</span> : x.promoter_name ? <span>{x.promoter_name}</span> : <span className="muted">Unassigned</span>) },
              { label: 'Status', render: (x) => <Chip status={x.status} /> },
            ]} empty={<EmptyState title="No shops match" text="" />} />
          </div>
        </section>
      </div>
    </>
  );
}

/* ------------------------------ Performance ------------------------------ */
/* Filters shared by the performance list and a promoter's performance page (kept while the app runs). */
const pst = { ...rangeDates('mtd'), city_id: '', market_id: '', shop_id: '', brand_id: '', model_id: '' };

export function Performance() {
  usePageMeta('Performance', 'Promoters');
  const navigate = useNavigate();
  const { lk } = useLookups();
  const [st, setSt] = useState(() => ({ ...pst }));
  const change = (patch) => { Object.assign(pst, patch); setSt({ ...pst }); };
  const q = clean(st);
  const { data, error, retry } = useKeptApi(() => api('/promoters/performance', { query: q }), [JSON.stringify(q)]);

  const config = useMemo(() => {
    if (!data) return null;
    const rows = data.rows.filter((r) => r.transactions > 0 || r.status === 'active');
    return {
      type: 'bar',
      data: { labels: rows.map((r) => r.name), datasets: [
        { label: 'Mobile units', data: rows.map((r) => r.mobile_units), backgroundColor: PALETTE[0], borderRadius: 3, maxBarThickness: 34 },
        { label: 'Gifts given', data: rows.map((r) => r.gifts_given), backgroundColor: '#9fd6c0', borderRadius: 3, maxBarThickness: 34 },
        { label: 'Shops sold at', data: rows.map((r) => r.shops_sold), type: 'line', yAxisID: 'y2', borderColor: '#0f1a2b', backgroundColor: '#0f1a2b', pointRadius: 3, borderWidth: 1.5 },
      ] },
      options: { scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } }, y2: { position: 'right', beginAtZero: true, grid: { display: false }, ticks: { precision: 0 } } }, plugins: { legend: { position: 'bottom' } }, interaction: { mode: 'index', intersect: false } },
    };
  }, [data]);

  if (error && !data) return <ErrorBlock message={error.message} onRetry={retry} />;

  const report = () => api('/reports/promoter', { query: clean(pst) });
  const xls = async () => { try { const r = await report(); await Excel.exportReport({ title: 'Promoter Performance', subtitle: `${filterText(pst, lk)} · Generated ${new Date().toLocaleString('en-GB')}`, columns: r.columns, rows: r.rows, totals: r.totals, filename: `promoter-performance-${fmt.today()}.xlsx` }); } catch (e) { toastError(e); } };
  const pdf = async () => { try { const r = await report(); await exportPdf({ title: 'Promoter Performance', subtitle: filterText(pst, lk), columns: r.columns, rows: r.rows, totals: r.totals, filename: `promoter-performance-${fmt.today()}.pdf` }); } catch (e) { toastError(e); } };

  return (
    <>
      <PageHead title="Promoter Performance" desc="Shops, mobile units sold and gifts given per promoter. Click a promoter for details." actions={<>
        <BusyButton className="btn" id="ppXls" onClick={xls}><Icon name="sheet" />Export Excel</BusyButton><BusyButton className="btn" id="ppPdf" onClick={pdf}><Icon name="file" />PDF</BusyButton>
      </>} />
      <section className="panel">
        <FilterBar keys={['range', 'city', 'market', 'shop', 'brand', 'model']} value={st} onChange={change} />
        <div className="panel-b"><div className="chart-box tall"><ChartCanvas id="ppChart" config={config} /></div></div>
        <div id="ppTable">
          {data && <DataTable rows={data.rows} rowKey="promoter_id" onRow={(r) => navigate(`/admin/promoters/${r.promoter_id}/performance`)} cols={[
            { label: 'Promoter', render: (r) => <><div className="cell-main">{r.name}</div><div className="cell-sub mono">{r.user_code}</div></> },
            { label: 'Shops', num: true, key: 'shops_assigned' }, { label: 'Shops sold at', num: true, key: 'shops_sold' },
            { label: 'Mobile Units', num: true, key: 'mobile_units', render: (r) => <b>{fmt.n(r.mobile_units)}</b> }, { label: 'Gifts Given', num: true, key: 'gifts_given' },
            { label: 'Gift ratio', num: true, render: (r) => ratio(r.ratio) }, { label: 'Transactions', num: true, key: 'transactions' },
            { label: 'Last activity', render: (r) => <span className="muted nowrap">{r.last_activity ? fmt.ago(r.last_activity) : '—'}</span> }, { label: 'Status', render: (r) => <Chip status={r.status} /> },
          ]} footer={{ shops_assigned: data.totals.shops_assigned, mobile_units: data.totals.mobile_units, gifts_given: data.totals.gifts_given, transactions: data.totals.transactions }}
          empty={<EmptyState title="No promoters" text="" />} />}
        </div>
      </section>
    </>
  );
}

/* ------------------------------ Promoter performance detail ------------------------------ */
export function PromoterPerformance() {
  usePageMeta('Promoter Performance', 'Promoters');
  const { id } = useParams();
  return <PromoterPerformancePage key={id} id={id} />; // another promoter starts from the loading block
}

function PromoterPerformancePage({ id }) {
  const navigate = useNavigate();
  const [range, setRange] = useState(() => ({ from: pst.from, to: pst.to }));
  const { data: d, error, reload, retry } = useKeptApi(() => api(`/promoters/${id}/performance`, { query: clean({ from: range.from, to: range.to }) }), [id, range.from, range.to]);
  const [openBrands, setOpenBrands] = useState(() => new Set());
  useEffect(() => { setOpenBrands(new Set()); }, [d]);

  const daily = useMemo(() => (d ? { type: 'bar',
    data: { labels: d.daily.map((x) => new Date(x.key + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })), datasets: [
      { label: 'Mobile units', data: d.daily.map((x) => x.units), backgroundColor: PALETTE[0], borderRadius: 2, maxBarThickness: 16 },
      { label: 'Gifts given', data: d.daily.map((x) => x.gifts), backgroundColor: '#9fd6c0', borderRadius: 2, maxBarThickness: 16 }] },
    options: { scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } }, y: { beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'bottom' } }, interaction: { mode: 'index', intersect: false } } } : null), [d]);

  if (error && !d) return <ErrorBlock message={error.message} onRetry={retry} />;
  if (!d) return <LoadingBlock />;
  const u = d.user; const s = d.summary;
  const curRange = (RANGES.find(([r]) => { const x = rangeDates(r); return x.from === (range.from || '') && x.to === (range.to || ''); }) || [''])[0];
  const pick = (r) => { const x = rangeDates(r); Object.assign(pst, x); setRange({ from: x.from, to: x.to }); };
  const toggleBrand = (i) => setOpenBrands((o) => { const n = new Set(o); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  return (
    <>
      <PageHead title={u.name} desc={<><span className="mono">{u.user_code}</span> · {u.email}{u.phone ? ' · ' + u.phone : ''} · <Chip status={u.status} /></>} actions={<>
        <Link className="btn" to="/admin/promoters/performance"><Icon name="back" />All promoters</Link><Link className="btn" to={`/admin/promoters/${u.id}`}>Profile &amp; shops</Link>
        <Link className="btn" to={`/admin/reports/gifts?promoter=${u.id}`}>Transactions</Link>
        <div className="seg" id="pdRange">{RANGES.map(([r, l]) => <button key={r} className={r === curRange ? 'on' : ''} onClick={() => pick(r)}>{l}</button>)}</div>
      </>} />
      <div className="kpis">
        <div className="kpi"><div className="k-label">Mobile units sold</div><div className="k-value">{fmt.n(s.units)}</div></div>
        <div className="kpi"><div className="k-label">Gifts given</div><div className="k-value">{fmt.n(s.gifts)}</div></div>
        <div className="kpi"><div className="k-label">Gift-to-Mobile ratio</div><div className="k-value">{ratio(s.ratio)}</div></div>
        <div className="kpi"><div className="k-label">Sales</div><div className="k-value">{fmt.n(s.txns)}</div></div>
        <div className="kpi"><div className="k-label">Shops sold at</div><div className="k-value">{fmt.n(s.shops)}</div><div className="k-sub">{fmt.n(u.shops_assigned)} assigned</div></div>
      </div>
      <div className="grid g-main-side" style={{ marginTop: 16 }}>
        <section className="panel"><div className="panel-h"><h2>Daily sales</h2><span className="sub">Last 30 days</span></div><div className="panel-b"><div className="chart-box"><ChartCanvas id="pdDaily" config={daily} /></div></div></section>
        <section className="panel"><div className="panel-h"><h2>Gifts given</h2></div>{d.gifts.length ? (
          <table className="tbl compact"><thead><tr><th>Gift</th><th className="num">Qty given</th><th className="num">With units</th></tr></thead>
            <tbody>{d.gifts.map((g, i) => <tr key={i}><td>{g.gift_name}</td><td className="num"><b>{fmt.n(g.gifts)}</b></td><td className="num">{fmt.n(g.units)}</td></tr>)}</tbody></table>
        ) : <EmptyState title="No gifts given" text="" />}</section>
      </div>
      <div className="grid g2" style={{ marginTop: 16 }}>
        <section className="panel"><div className="panel-h"><h2>Brands sold</h2><span className="sub">Click a brand to see models</span></div>{d.brands.length ? (
          <table className="tbl drill"><thead><tr><th style={{ width: 28 }} /><th>Brand</th><th className="num">Units</th><th className="num">Gifts</th><th className="num">Ratio</th></tr></thead>
            <tbody>{d.brands.map((b, i) => (
              <Fragment key={i}>
                <tr className={`clickable brand-line ${openBrands.has(i) ? 'open' : ''}`.trim()} onClick={() => toggleBrand(i)}><td><Icon name="chevron" className="caret" /></td><td><b>{b.brand_name}</b></td><td className="num"><b>{fmt.n(b.units)}</b></td><td className="num">{fmt.n(b.gifts)}</td><td className="num">{ratio(b.ratio)}</td></tr>
                <tr className={`sub-rows ${openBrands.has(i) ? '' : 'hidden'}`.trim()}><td /><td colSpan={4}><table className="tbl compact inner"><tbody>{b.models.map((m, j) => <tr key={j}><td>{m.model_name} <span className="muted mono small">{m.item_code || ''}</span></td><td className="num"><b>{fmt.n(m.units)}</b></td><td className="num">{fmt.n(m.gifts)}</td></tr>)}</tbody></table></td></tr>
              </Fragment>
            ))}</tbody></table>
        ) : <EmptyState title="No sales in this period" text="" />}</section>
        <section className="panel"><div className="panel-h"><h2>Shops</h2><span className="sub">Where this promoter sold</span></div><div id="pdShops">
          <DataTable rows={d.shops} rowKey="shop_pk" compact onRow={(x) => navigate('/admin/shops/' + x.shop_id)} cols={[
            { label: 'Shop', render: (x) => <><div className="cell-main">{x.shop_name}</div><div className="cell-sub mono">{x.shop_id}{x.assigned ? '' : ' · not assigned now'}</div></> }, { label: 'Market', key: 'market_name' },
            { label: 'Units', num: true, key: 'units' }, { label: 'Gifts', num: true, key: 'gifts' }, { label: 'Ratio', num: true, render: (x) => ratio(x.ratio) },
          ]} empty={<EmptyState title="No shops" text="" />} />
        </div></section>
      </div>
      <section className="panel" style={{ marginTop: 16 }}><div className="panel-h"><h2>Recent transactions &amp; proof photos</h2><Link className="btn sm" style={{ marginLeft: 'auto' }} to={`/admin/reports/gifts?promoter=${u.id}`}>All</Link></div>
        <div id="pdRecent">
          <DataTable rows={d.recent} rowKey="transaction_id" onRow={(t) => openTransaction(t.transaction_id, reload)} cols={[
            { label: 'Transaction', render: (t) => <><div className="mono cell-main">{t.transaction_id}</div><div className="cell-sub">{fmt.dt(t.created_at)}</div></> }, { label: 'Shop', key: 'shop_name' },
            { label: 'Mobile', render: (t) => `${t.brand_name || ''} ${t.model_name || '—'}` }, { label: 'Qty', num: true, key: 'mobile_qty' }, { label: 'Gift', key: 'gift_name' }, { label: 'Gift qty', num: true, key: 'quantity' },
            { label: 'Proof', render: (t) => <div className="thumbs">{t.has_mobile_photo ? <AuthImage className="thumb" path={`/files/transactions/${t.transaction_id}/mobile-photo`} /> : null}{t.has_photo ? <AuthImage className="thumb" path={`/files/transactions/${t.transaction_id}/photo`} /> : null}</div> },
            { label: 'Status', render: (t) => <Chip status={t.status} /> },
          ]} empty={<EmptyState title="No transactions yet" text="" />} />
        </div>
      </section>
    </>
  );
}

/* ------------------------------ Promoter detail ------------------------------ */
export function PromoterDetail() {
  usePageMeta('Promoter', 'Promoters');
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, error, reload } = useApi(() => api('/users/' + id), [id]);
  if (error && !data) return <ErrorBlock message={error.message} onRetry={reload} />;
  if (!data) return <LoadingBlock />;
  const { user: u, shops } = data;
  return (
    <>
      <PageHead title={u.name} desc={<><span className="mono">{u.user_code}</span> · {u.email}{u.phone ? ' · ' + u.phone : ''}</>} actions={<>
        <Link className="btn" to="/admin/promoters"><Icon name="back" />All promoters</Link>
        <button className="btn" id="uToggle" onClick={() => toggleUser(u, reload)}>{u.status === 'active' ? 'Deactivate' : 'Activate'}</button>
        <button className="btn" id="uEdit" onClick={() => openUserForm(u, 'promoter', reload)}><Icon name="edit" />Edit</button>
        <Link className="btn primary" to={`/admin/promoters/${u.id}/performance`}><Icon name="trend" />Performance</Link>
      </>} />
      <div className="kpis">
        <div className="kpi"><div className="k-label">Status</div><div className="k-value" style={{ fontSize: 16, marginTop: 8 }}><Chip status={u.status} /></div><div className="k-sub">Last login {u.last_login_at ? fmt.ago(u.last_login_at) : 'never'}</div></div>
        <div className="kpi"><div className="k-label">Assigned shops</div><div className="k-value">{fmt.n(u.shops_assigned)}</div><div className="k-sub">{fmt.n(u.active_shops)} active</div></div>
        <div className="kpi"><div className="k-label">Mobile units sold</div><div className="k-value">{fmt.n(u.mobile_units)}</div><div className="k-sub">All time</div></div>
        <div className="kpi"><div className="k-label">Gifts given</div><div className="k-value">{fmt.n(u.gifts_given)}</div><div className="k-sub">All time</div></div>
        <div className="kpi"><div className="k-label">Transactions</div><div className="k-value">{fmt.n(u.transactions)}</div><div className="k-sub">All time</div></div>
      </div>
      <section className="panel" style={{ marginTop: 16 }}><div className="panel-h"><h2>Assigned shops</h2><span className="sub">The promoter can only record sales at these shops</span>
        <Link className="btn sm" style={{ marginLeft: 'auto' }} to={`/admin/promoters/assign?promoter=${u.id}`}><Icon name="link" />Change assignment</Link></div>
        <div id="uShops">
          <DataTable rows={shops} onRow={(x) => navigate('/admin/shops/' + x.shop_id)} cols={[
            { label: 'Shop ID', render: (x) => <b className="mono">{x.shop_id}</b> }, { label: 'Shop', key: 'shop_name' },
            { label: 'City', key: 'city_name' }, { label: 'Market', key: 'market_name' }, { label: 'Status', render: (x) => <Chip status={x.status} /> },
          ]} empty={<EmptyState title="No shops assigned" text="Use Promoters → Assign Shops." />} />
        </div>
      </section>
    </>
  );
}
