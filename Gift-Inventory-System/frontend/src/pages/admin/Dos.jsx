/* Shop Gift DOS (Days of Stock) page (from pages-dos.js). */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import DataTable from '../../components/DataTable';
import BusyButton from '../../components/BusyButton';
import { EmptyState, PageHead, SearchBox } from '../../components/ui';
import { toast, toastError } from '../../components/Toasts';
import { dosChip, dosNum, dosBar } from '../../components/admin/dos-widgets';
import { cityOpts, marketOpts, promoterOpts, giftOpts } from '../../components/admin/options';
import usePaged, { PagedView } from '../../hooks/usePaged';
import { api, download } from '../../services/api';
import { fmt } from '../../utils/format';
import { exportPdf } from '../../utils/pdf';
import { pendingAllocation } from '../../utils/admin';
import D from '../../utils/shared/dos-calc';
import { usePageMeta } from '../../context/PageMetaContext';
import { useLookups } from '../../context/LookupsContext';

// Remembers the last settings during the session
const pref = { days: 30, target: 30 };

const keyOf = (r) => `${r.shop_pk}|${r.gift_pk}`;

export default function GiftDos() {
  usePageMeta('Shop Gift DOS', 'Inventory');
  const navigate = useNavigate();
  const [query] = useSearchParams();
  const { lk } = useLookups();
  const [selected, setSelected] = useState(() => new Set());
  const list = usePaged({
    initial: { days: pref.days, target: pref.target, search: query.get('search') || '', city_id: '', market_id: '', promoter_id: '', gift_id: '', status: query.get('status') || '', sort: '', dir: '', pageSize: 50 },
    fetch: (st) => api('/inventory/dos', { query: st }),
  });
  const st = list.state;
  const d = list.data;
  const lastRows = d ? d.rows.map((r) => ({ ...r, _k: keyOf(r) })) : [];

  // Target DOS: applied on the input's native "change" (blur / Enter / spinner), like the original
  const targetRef = useRef(null);
  const listRef = useRef(list);
  listRef.current = list;
  useEffect(() => {
    const el = targetRef.current;
    if (!el) return undefined;
    const onChange = () => {
      const v = Math.min(180, Math.max(1, parseInt(el.value, 10) || 30));
      el.value = v; pref.target = v;
      listRef.current.set({ target: v }, true);
    };
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, []);

  const cols = (s) => [
    { label: 'Shop', sort: 'shop_id', render: (r) => <><div className="cell-main">{r.shop_name}</div><div className="cell-sub"><Link className="mono" to={`/admin/shops/${r.shop_id}`}>{r.shop_id}</Link> · {r.market_name}, {r.city_name}</div></> },
    { label: 'Promoter', render: (r) => <span className="nowrap">{r.promoter_name || '—'}</span> },
    { label: 'Gift', render: (r) => <span className="cell-main nowrap">{r.gift_name}</span> },
    { label: 'Stock', num: true, sort: 'stock', key: 'stock', render: (r) => <><b>{fmt.n(r.stock)}</b>{r.pending ? <div className="cell-sub">{fmt.n(r.pending)} pending</div> : null}</> },
    { label: `Sold ${s.days}d`, num: true, sort: 'sold', key: 'sold' },
    { label: 'Avg / day', num: true, render: (r) => fmt.n(r.ads) },
    { label: 'DOS (days)', num: true, sort: 'dos', key: 'dos', render: (r) => <div className="dos-cell">{dosNum(r)}{dosBar(r)}</div> },
    { label: 'Status', render: dosChip },
    { label: `Refill to ${s.target}d`, num: true, sort: 'refill', key: 'refill', render: (r) => (r.refill ? <b className="stock">{fmt.n(r.refill)}</b> : <span className="muted">0</span>) },
    { label: 'Last sale', render: (r) => <span className="muted nowrap">{r.last_sale_at ? fmt.ago(r.last_sale_at) : 'Never'}</span> },
  ];

  const setDays = (v) => { pref.days = v; list.set({ days: v }); };
  const pickStatus = (key) => list.set({ status: st.status === key ? '' : key });

  // Strip of status tiles
  const sum = d && d.summary;
  const total = sum ? Object.values(sum).reduce((a, b) => a + b, 0) : 0;

  // Bulk bar
  const selRows = lastRows.filter((r) => selected.has(r._k));
  const withRefill = selRows.filter((r) => r.refill > 0);
  const urgent = lastRows.filter((r) => r.refill > 0 && (r.status === 'critical' || r.status === 'low' || r.status === 'out'));
  let bulk = null;
  if (d && !selected.size) {
    bulk = urgent.length ? (
      <div className="bulkbar" style={{ background: '#fff6e5', borderBottomColor: '#f3dcae' }}>
        <b>{fmt.n(urgent.length)}</b>&nbsp;line(s) on this page need a refill (Out of stock / Critical / Low).
        <button className="btn sm" id="dPickUrgent" onClick={() => { const n = new Set(selected); urgent.forEach((r) => n.add(r._k)); setSelected(n); list.reload(); }}>Select them</button></div>
    ) : null;
  } else if (d) {
    bulk = (
      <div className="bulkbar"><b>{selected.size} selected</b>
        <span>{fmt.n(withRefill.reduce((a, r) => a + r.refill, 0))} units suggested</span>
        <button className="btn sm primary" id="dAlloc" disabled={!withRefill.length} onClick={() => {
          pendingAllocation.lines = withRefill.map((r) => ({
            shop: { id: r.shop_pk, shop_id: r.shop_id, shop_name: r.shop_name, city_name: r.city_name, market_name: r.market_name, status: 'active' },
            gift_id: r.gift_pk, quantity: r.refill,
          }));
          pendingAllocation.note = `Refill to ${list.state.target} days DOS (sales period ${list.state.days} days)`;
          navigate('/admin/inventory/allocate');
        }}><Icon name="plus" />Allocate suggested refill</button>
        <span className="spacer" /><button className="link-btn" id="dClear" onClick={() => { setSelected(new Set()); list.reload(); }}>Clear selection</button></div>
    );
  }

  const exportCsv = () => download('/inventory/dos/export.csv', list.state).catch(toastError);
  const exportPdfReport = async () => {
    try {
      const s = list.state;
      const r = await api('/reports/dos', { query: { ...s } });
      if (!r.rows.length) return toast('Nothing to export', 'warn');
      await exportPdf({ title: 'Shop Gift DOS Report', subtitle: `Sales period: last ${s.days} days · Target DOS: ${s.target} days · DOS = Stock ÷ avg sold per day`,
        columns: r.columns, rows: r.rows, totals: r.totals, filename: `shop-gift-dos-${fmt.today()}.pdf` });
    } catch (ex) { toastError(ex); }
    return undefined;
  };

  return (
    <>
      <PageHead title="Shop Gift DOS" desc="Days of Stock: how many days each shop's gift stock will last at the current sales speed." actions={<>
        <BusyButton className="btn" id="dCsv" onClick={exportCsv}><Icon name="download" />Excel / CSV</BusyButton>
        <BusyButton className="btn" id="dPdf" onClick={exportPdfReport}><Icon name="file" />PDF</BusyButton>
        <Link className="btn primary" to="/admin/inventory/allocate"><Icon name="plus" />Allocate gifts</Link>
      </>} />
      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="filters" style={{ borderBottom: 0 }}>
          <span className="small muted" style={{ fontWeight: 600 }}>Sales period</span>
          <div className="seg" id="dDays">{D.WINDOWS.map((x) => <button key={x} data-d={x} className={x === st.days ? 'on' : ''} onClick={() => setDays(x)}>Last {x} days</button>)}</div>
          <span className="small muted" style={{ fontWeight: 600, marginLeft: 8 }}>Target DOS</span>
          <input ref={targetRef} className="input" type="number" min="1" max="180" id="dTarget" defaultValue={pref.target} style={{ width: 80, minWidth: 80 }} /> <span className="small muted">days</span>
          <span className="spacer" />
          <span className="small muted">DOS = Stock ÷ average gifts sold per day · Refill = stock needed to reach the target DOS</span>
        </div>
        <div className="dos-strip" id="dStrip">{sum && D.STATUS.map((s) => (
          <button key={s.key} className={`dos-tile dos-${s.key} ${st.status === s.key ? 'on' : ''}`} data-st={s.key} onClick={() => pickStatus(s.key)}>
            <span className="t">{s.label}</span><span className="v">{fmt.n(sum[s.key])}</span><span className="s">{total ? Math.round((sum[s.key] / total) * 100) : 0}% of lines</span></button>
        ))}</div>
      </section>
      <section className="panel">
        <div className="filters" id="dFilters">
          <SearchBox value={st.search} onChange={(v) => list.set({ search: v })} placeholder="Search Shop ID or name" />
          <select className="select" id="dCity" value={st.city_id} onChange={(e) => list.set({ city_id: e.target.value, market_id: '' })}>{cityOpts(lk)}</select>
          <select className="select" id="dMarket" value={st.market_id} onChange={(e) => list.set({ market_id: e.target.value })}>{marketOpts(lk, st.city_id)}</select>
          <select className="select" value={st.promoter_id} onChange={(e) => list.set({ promoter_id: e.target.value })}>{promoterOpts(lk)}</select>
          <select className="select" value={st.gift_id} onChange={(e) => list.set({ gift_id: e.target.value })}>{giftOpts(lk, 'All gifts', true)}</select>
          <select className="select" id="dStatus" value={st.status} onChange={(e) => list.set({ status: e.target.value })}><option value="">All statuses</option>{D.STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
        </div>
        <div id="dBulk">{bulk}</div>
        <div id="dList">
          <PagedView list={list}>{(data, s) => (
            <DataTable cols={cols(s)} rows={data.rows.map((r) => ({ ...r, _k: keyOf(r) }))} rowKey="_k" selectable selected={selected} onSelect={setSelected}
              sort={s.sort} dir={s.dir} onSort={list.sortBy}
              footer={data.rows.length ? { stock: data.totals.stock, sold: data.totals.sold, refill: data.totals.refill, dos: data.totals.dos ?? '' /* '' renders as — */ } : null}
              empty={<EmptyState title="No shop stock found" text="Allocate gifts to active shops, or change the filters." />} />
          )}</PagedView>
        </div>
      </section>
    </>
  );
}
