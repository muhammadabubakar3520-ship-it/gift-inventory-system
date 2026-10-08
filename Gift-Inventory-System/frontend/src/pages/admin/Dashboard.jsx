/* Dashboard (from pages-dashboard.js). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon';
import { EmptyState, LoadingBlock, ErrorBlock, PageHead, ratio } from '../../components/ui';
import { toastError } from '../../components/Toasts';
import ChartCanvas from '../../components/admin/ChartCanvas';
import { cityOpts } from '../../components/admin/options';
import { openTransaction } from '../../components/admin/Transactions';
import { dosChip, dosNum } from '../../components/admin/dos-widgets';
import useApi from '../../hooks/useApi';
import { api } from '../../services/api';
import { fmt } from '../../utils/format';
import { RANGES, rangeDates, clean, PALETTE as P } from '../../utils/admin';
import DOS from '../../utils/shared/dos-calc';
import { usePageMeta } from '../../context/PageMetaContext';
import { useLookups } from '../../context/LookupsContext';

// filters are kept while the app is open (module state, like the original)
const st = { ...rangeDates('mtd'), city_id: '' };

const noData = (rows) => !rows.length || rows.every((r) => !(r.value || r.units || r.gifts || r.allocated));
const dayLbl = (k) => new Date(k + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const hbarCfg = (rows, color, label = 'Mobile units') => ({
  type: 'bar',
  data: { labels: rows.map((r) => (r.label.length > 26 ? r.label.slice(0, 25) + '…' : r.label)), datasets: [{ label, data: rows.map((r) => r.value), backgroundColor: color, borderRadius: 3, maxBarThickness: 18 }] },
  options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { grid: { display: false } } } },
});
const unitsGiftsOpts = { scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'bottom' } }, interaction: { mode: 'index', intersect: false } };

function buildCharts(C) {
  return {
    daily: {
      type: 'line',
      data: { labels: C.daily.map((x) => dayLbl(x.key)), datasets: [
        { label: 'Mobile units', data: C.daily.map((x) => x.units), borderColor: P[0], backgroundColor: 'rgba(31,79,209,.12)', fill: true, tension: 0.3, pointRadius: 2, borderWidth: 2 },
        { label: 'Gifts given', data: C.daily.map((x) => x.gifts), borderColor: P[1], backgroundColor: P[1], tension: 0.3, pointRadius: 2, borderWidth: 2 },
      ] },
      options: { scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } }, y: { beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'bottom' } }, interaction: { mode: 'index', intersect: false } },
    },
    brand: noData(C.byBrand) ? null : {
      type: 'doughnut',
      data: { labels: C.byBrand.map((r) => r.label), datasets: [{ data: C.byBrand.map((r) => r.units), backgroundColor: P, borderWidth: 2, borderColor: '#fff' }] },
      options: { cutout: '60%', plugins: { legend: { position: 'right' } } },
    },
    model: noData(C.byModel) ? null : hbarCfg(C.byModel, P[2]),
    promoter: noData(C.byPromoter) ? null : {
      type: 'bar',
      data: { labels: C.byPromoter.map((r) => r.label), datasets: [
        { label: 'Mobile units', data: C.byPromoter.map((r) => r.units), backgroundColor: P[0], borderRadius: 3, maxBarThickness: 26 },
        { label: 'Gifts given', data: C.byPromoter.map((r) => r.gifts), backgroundColor: '#9fd6c0', borderRadius: 3, maxBarThickness: 26 },
      ] },
      options: unitsGiftsOpts,
    },
    city: noData(C.byCity) ? null : hbarCfg(C.byCity, P[0]),
    market: noData(C.byMarket) ? null : hbarCfg(C.byMarket, P[5]),
    shop: noData(C.byShop) ? null : hbarCfg(C.byShop, P[3]),
    gift: noData(C.byGift) ? null : {
      type: 'doughnut',
      data: { labels: C.byGift.map((r) => r.label), datasets: [{ data: C.byGift.map((r) => r.value), backgroundColor: P.slice(1), borderWidth: 2, borderColor: '#fff' }] },
      options: { cutout: '60%', plugins: { legend: { position: 'right' } } },
    },
    remain: noData(C.remainingByGift) ? null : {
      type: 'bar',
      data: { labels: C.remainingByGift.map((r) => r.label), datasets: [
        { label: 'Given', data: C.remainingByGift.map((r) => r.distributed), backgroundColor: P[1], borderRadius: 3, maxBarThickness: 40 },
        { label: 'Remaining', data: C.remainingByGift.map((r) => r.remaining), backgroundColor: '#c9d6f5', borderRadius: 3, maxBarThickness: 40 },
      ] },
      options: { scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'bottom' } }, interaction: { mode: 'index', intersect: false } },
    },
    monthly: {
      type: 'bar',
      data: { labels: C.monthly.map((m) => new Date(m.key + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' })), datasets: [
        { label: 'Mobile units', data: C.monthly.map((m) => m.units), backgroundColor: P[0], borderRadius: 3, maxBarThickness: 22 },
        { label: 'Gifts given', data: C.monthly.map((m) => m.gifts), backgroundColor: '#9fd6c0', borderRadius: 3, maxBarThickness: 22 },
      ] },
      options: unitsGiftsOpts,
    },
  };
}

/** Chart box: the canvas, or "No data for this period" (config null). */
const Chart = ({ id, config, tall }) => (
  <div className={`chart-box ${tall ? 'tall' : ''}`.trim()}>
    {config ? <ChartCanvas id={id} config={config} /> : <div className="chart-empty">No data for this period</div>}
  </div>
);

/** "Gift stock health (DOS)" panel body: loads after the main dashboard. */
function DosPanel({ dd, onShop }) {
  if (dd === undefined) return <LoadingBlock />;
  if (dd === null) return null;
  const total = Object.values(dd.summary).reduce((a, b) => a + b, 0);
  return (
    <>
      <div className="dos-strip" style={{ borderTop: 0, borderBottom: '1px solid var(--line)' }}>{DOS.STATUS.map((x) => (
        <Link key={x.key} className={`dos-tile dos-${x.key}`} to={`/admin/inventory/dos?status=${x.key}`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="t">{x.label}</span><span className="v">{fmt.n(dd.summary[x.key])}</span><span className="s">{total ? Math.round(dd.summary[x.key] / total * 100) : 0}% of shop-gift lines</span></Link>
      ))}</div>
      {dd.rows.length ? (
        <div className="table-wrap"><table className="tbl compact"><thead><tr><th>Most urgent</th><th>Gift</th><th className="num">Stock</th><th className="num">Avg / day</th><th className="num">DOS</th><th>Status</th><th className="num">Refill to 30d</th></tr></thead>
          <tbody>{dd.rows.map((r, i) => (
            <tr key={i} className="clickable" onClick={() => onShop(r.shop_id)}><td><span className="cell-main">{r.shop_name}</span> <span className="muted mono">{r.shop_id}</span></td><td>{r.gift_name}</td>
              <td className="num">{fmt.n(r.stock)}</td><td className="num">{fmt.n(r.ads)}</td><td className="num">{dosNum(r)}</td><td>{dosChip(r)}</td><td className="num"><b>{fmt.n(r.refill)}</b></td></tr>
          ))}</tbody></table></div>
      ) : <EmptyState title="No gift stock yet" text="Allocate gifts to shops to see Days of Stock." />}
    </>
  );
}

export default function Dashboard() {
  usePageMeta('Dashboard');
  const navigate = useNavigate();
  const { lk } = useLookups();
  const [f, setF] = useState(() => ({ ...st }));
  const fRef = useRef(f);
  const { data: d, error, reload } = useApi(() => api('/reports/dashboard', { query: clean(fRef.current) }), []);
  useEffect(() => { if (error) toastError(error); }, [error]);

  const change = (patch) => {
    Object.assign(st, patch);
    fRef.current = { ...fRef.current, ...patch };
    setF(fRef.current);
    reload();
  };

  // DOS panel (loads after the main dashboard, every time it reloads)
  const [dd, setDd] = useState(undefined);
  useEffect(() => {
    if (!d) return undefined;
    let live = true;
    setDd(undefined);
    api('/inventory/dos', { query: { days: 30, city_id: fRef.current.city_id, pageSize: 6 }, quiet: true })
      .then((x) => { if (live) setDd(x); }, () => { if (live) setDd(null); });
    return () => { live = false; };
  }, [d]);

  const charts = useMemo(() => (d ? buildCharts(d.charts) : null), [d]);

  if (error && !d) return <ErrorBlock message={error.message} onRetry={reload} />;
  if (!d) return <LoadingBlock />;

  const k = d.kpis;
  const rangeLabel = (RANGES.find(([r]) => { const x = rangeDates(r); return x.from === (f.from || '') && x.to === (f.to || ''); }) || [null, `${f.from || 'start'} – ${f.to || 'today'}`])[1];
  const used = k.total_allocated ? Math.round((k.total_given / k.total_allocated) * 100) : 0;
  const goShop = (id) => navigate('/admin/shops/' + id);

  return (
    <>
      <PageHead title="Dashboard" desc="Company-wide mobile sales, gifts given and gift stock." actions={
        <div className="dash-filters">
          <select className="select sm" id="dCity" style={{ width: 'auto' }} value={f.city_id} onChange={(e) => change({ city_id: e.target.value })}>{cityOpts(lk)}</select>
          <div className="seg" id="dRange">{RANGES.map(([v, l]) => <button key={v} className={l === rangeLabel ? 'on' : ''} onClick={() => change(rangeDates(v))}>{l}</button>)}</div>
        </div>} />
      <div className="kpis">
        <Link className="kpi kpi-link" to="/admin/sales"><div className="k-label"><Icon name="phone" />Total Mobile Units Sold</div><div className="k-value">{fmt.n(k.total_mobile_units)}</div><div className="k-sub">{rangeLabel} · {fmt.n(k.transactions)} sales</div></Link>
        <Link className="kpi kpi-link" to="/admin/reports/gifts"><div className="k-label"><Icon name="gift" />Total Gift Units Given</div><div className="k-value">{fmt.n(k.total_gift_units)}</div><div className="k-sub">Gift-to-Mobile ratio <b>{ratio(k.ratio)}</b></div></Link>
        <Link className="kpi kpi-link" to="/admin/shops"><div className="k-label"><Icon name="store" />Total Shops</div><div className="k-value">{fmt.n(k.total_shops)}</div><div className="k-sub">{fmt.n(k.active_shops)} active</div></Link>
        <Link className="kpi kpi-link" to="/admin/promoters/performance"><div className="k-label"><Icon name="users" />Active Promoters</div><div className="k-value">{fmt.n(k.active_promoters)}</div><div className="k-sub">{fmt.n(k.selling_promoters)} selling in period</div></Link>
        <Link className="kpi kpi-link" to="/admin/reports/gifts"><div className="k-label"><Icon name="receipt" />Transactions</div><div className="k-value">{fmt.n(k.transactions)}</div><div className="k-sub">Sales recorded · {rangeLabel}</div></Link>
        <Link className="kpi kpi-link" to="/admin/inventory"><div className="k-label"><Icon name="box" />Remaining Gift Inventory</div><div className="k-value">{fmt.n(k.remaining_gift_inventory)}</div><div className="bar"><i style={{ width: `${used}%` }} /></div><div className="k-sub">{used}% of allocated given · {fmt.n(k.warehouse_unallocated)} in warehouse</div></Link>
      </div>

      <div className="grid g-main-side" style={{ marginTop: 16 }}>
        <section className="panel"><div className="panel-h"><h2>Daily sales trend</h2><span className="sub">Mobile units and gifts per day</span></div>
          <div className="panel-b"><Chart id="cDaily" config={charts.daily} tall /></div></section>
        <section className="panel"><div className="panel-h"><h2>Recent sales</h2><span className="sub">Latest transactions</span>
          <Link className="btn sm" style={{ marginLeft: 'auto' }} to="/admin/reports/gifts">All transactions</Link></div>
          <div className="pending-list">{(d.recent || []).length ? d.recent.map((t) => (
            <div key={t.transaction_id} className="item" onClick={() => openTransaction(t.transaction_id, () => reload())}>
              <div style={{ minWidth: 0, flex: 1 }}><div className="cell-main" style={{ fontWeight: 600 }}>{t.shop_name}</div>
                <div className="muted small">{t.brand_name ? `${t.brand_name} ${t.model_name} × ${t.mobile_qty || '—'}` : t.model_name || '—'} · {t.gift_name} × {t.quantity}</div>
                <div className="muted small">{t.promoter_name} · {fmt.ago(t.created_at)}</div></div>
              <span className="qty-pill">{fmt.n(t.mobile_qty || 0)}</span></div>
          )) : <EmptyState title="No sales yet" text="Sales appear here as soon as promoters submit them." />}</div>
        </section>
      </div>

      <div className="grid g3" style={{ marginTop: 16 }}>
        <section className="panel"><div className="panel-h"><h2>Brand-wise mobile sales</h2><span className="sub">{rangeLabel}</span><Link className="btn sm" style={{ marginLeft: 'auto' }} to="/admin/sales/brands">Details</Link></div><div className="panel-b"><Chart id="cBrand" config={charts.brand} /></div></section>
        <section className="panel"><div className="panel-h"><h2>Model-wise mobile sales</h2><span className="sub">Top 10</span><Link className="btn sm" style={{ marginLeft: 'auto' }} to="/admin/sales/models">Details</Link></div><div className="panel-b"><Chart id="cModel" config={charts.model} /></div></section>
        <section className="panel"><div className="panel-h"><h2>Promoter performance</h2><span className="sub">Units vs gifts</span><Link className="btn sm" style={{ marginLeft: 'auto' }} to="/admin/promoters/performance">Details</Link></div><div className="panel-b"><Chart id="cPromoter" config={charts.promoter} /></div></section>
      </div>
      <div className="grid g3" style={{ marginTop: 16 }}>
        <section className="panel"><div className="panel-h"><h2>City-wise sales</h2><span className="sub">Mobile units</span></div><div className="panel-b"><Chart id="cCity" config={charts.city} /></div></section>
        <section className="panel"><div className="panel-h"><h2>Market-wise sales</h2><span className="sub">Top 10</span></div><div className="panel-b"><Chart id="cMarket" config={charts.market} /></div></section>
        <section className="panel"><div className="panel-h"><h2>Shop-wise sales</h2><span className="sub">Top 10 shops</span><Link className="btn sm" style={{ marginLeft: 'auto' }} to="/admin/sales/shops">Details</Link></div><div className="panel-b"><Chart id="cShop" config={charts.shop} /></div></section>
      </div>
      <div className="grid g3" style={{ marginTop: 16 }}>
        <section className="panel"><div className="panel-h"><h2>Gift distribution</h2><span className="sub">Gifts given · {rangeLabel}</span></div><div className="panel-b"><Chart id="cGift" config={charts.gift} /></div></section>
        <section className="panel"><div className="panel-h"><h2>Gift inventory remaining</h2><span className="sub">Current stock in shops</span></div><div className="panel-b"><Chart id="cRemain" config={charts.remain} /></div></section>
        <section className="panel"><div className="panel-h"><h2>Monthly sales trend</h2><span className="sub">Last 12 months</span></div><div className="panel-b"><Chart id="cMonthly" config={charts.monthly} /></div></section>
      </div>

      <section className="panel" style={{ marginTop: 16 }} id="dDos"><div className="panel-h"><h2>Gift stock health (DOS)</h2><span className="sub">Days of Stock per shop × gift · last 30 days</span>
        <Link className="btn sm" style={{ marginLeft: 'auto' }} to="/admin/inventory/dos">Open Gift DOS</Link></div><div id="dDosBody"><DosPanel dd={dd} onShop={goShop} /></div></section>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <section className="panel"><div className="panel-h"><h2>Top shops</h2><span className="sub">{rangeLabel}</span><Link className="btn sm" style={{ marginLeft: 'auto' }} to="/admin/reports/shops">Shop report</Link></div>
          {d.topShops.length ? (
            <div className="table-wrap"><table className="tbl compact rank"><thead><tr><th>Shop</th><th>City / Market</th><th className="num">Mobile units</th><th className="num">Gifts</th><th className="num">Ratio</th></tr></thead>
              <tbody>{d.topShops.map((s) => (
                <tr key={s.shop_id} className="clickable" onClick={() => goShop(s.shop_id)}><td><span className="cell-main">{s.shop_name}</span> <span className="muted mono">{s.shop_id}</span></td>
                  <td className="muted">{s.city_name} · {s.market_name}</td><td className="num"><b>{fmt.n(s.units)}</b></td><td className="num">{fmt.n(s.gifts)}</td><td className="num">{ratio(s.ratio)}</td></tr>
              ))}</tbody></table></div>
          ) : <EmptyState title="No sales yet" text="Sales recorded by promoters appear here." />}
        </section>
        <section className="panel"><div className="panel-h"><h2>Top promoters</h2><span className="sub">{rangeLabel}</span><Link className="btn sm" style={{ marginLeft: 'auto' }} to="/admin/promoters/performance">Performance</Link></div>
          {d.topPromoters.length ? (
            <div className="table-wrap"><table className="tbl compact rank"><thead><tr><th>Promoter</th><th className="num">Shops</th><th className="num">Mobile units</th><th className="num">Gifts</th><th className="num">Ratio</th></tr></thead>
              <tbody>{d.topPromoters.map((p) => (
                <tr key={p.promoter_id} className="clickable" onClick={() => navigate('/admin/promoters/' + p.promoter_id + '/performance')}><td><span className="cell-main">{p.name}</span> <span className="muted mono">{p.user_code}</span></td>
                  <td className="num">{fmt.n(p.shops)}</td><td className="num"><b>{fmt.n(p.units)}</b></td><td className="num">{fmt.n(p.gifts)}</td><td className="num">{ratio(p.ratio)}</td></tr>
              ))}</tbody></table></div>
          ) : <EmptyState title="No activity yet" text="" />}
        </section>
      </div>
      <p className="muted small" style={{ marginTop: 12 }}>Every sale is counted and its gifts are deducted from the shop&apos;s stock as soon as the promoter submits it.</p>
    </>
  );
}
