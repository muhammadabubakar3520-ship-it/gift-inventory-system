/* Promoter "My Sales" screen (promoter.js mySales()). Range and filters are kept while the app is open. */
import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon';
import { LoadingBlock, ErrorBlock } from '../../components/ui';
import useApi from '../../hooks/useApi';
import { api } from '../../services/api';
import { fmt } from '../../utils/format';
import { useTop, useNav, usePromoter, ratioText } from './common';

export const RANGES = [['today', 'Today'], ['week', '7 days'], ['month', 'This month'], ['all', 'All time']];
export const rangeQuery = (r) => (r === 'today' ? { from: fmt.today(), to: fmt.today() } : r === 'week' ? { from: fmt.daysAgo(6), to: fmt.today() } : r === 'month' ? { from: fmt.monthStart(), to: fmt.today() } : {});
const FILTER_KEYS = ['brand_id', 'model_id', 'shop_id', 'city_id', 'market_id'];

export default function MySales() {
  useTop('My Sales');
  useNav('sales');
  const { store } = usePromoter();
  const [st, setSt] = useState(store.sales);
  const [showFilters, setShowFilters] = useState(false);
  const [dim, setDim] = useState(true); // legacy dims #sBody during every load, also the first one
  const update = (patch) => { const next = { ...store.sales, ...patch }; store.sales = next; setSt(next); };
  const filtered = FILTER_KEYS.some((k) => st[k]);

  const { data: d, error, reload } = useApi(() => api('/promoter/sales', { query: { ...rangeQuery(st.range), brand_id: st.brand_id, model_id: st.model_id, shop_id: st.shop_id, city_id: st.city_id, market_id: st.market_id } }), []);
  // range / filter change: reload with the old figures dimmed; only a successful load clears it (the error view stays dimmed, like legacy)
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setDim(true);
    reload();
  }, [st.range, st.brand_id, st.model_id, st.shop_id, st.city_id, st.market_id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (d !== undefined) setDim(false); }, [d]);

  const F = d && d.filters;
  const sel = (k, list, ph) => (
    <select className="select" data-k={k} value={String(st[k])} onChange={(e) => update({ [k]: e.target.value })}>
      <option value="">{ph}</option>{list.map((x) => <option key={x.id} value={String(x.id)}>{x.name}</option>)}</select>
  );
  const sm = d && d.summary;
  return (
    <>
      <div className="chips" id="sRange">{RANGES.map(([k, l]) => <button key={k} data-r={k} className={k === st.range ? 'on' : ''} onClick={() => update({ range: k })}>{l}</button>)}
        <button data-f="1" className={filtered ? 'on' : ''} onClick={() => setShowFilters((v) => !v)}><Icon name="adjust" />Filters</button></div>
      <div id="sFilters" className={`pm-card pm-pad filters-box ${showFilters ? '' : 'hidden'}`}>{F ? <>
        <div className="fgrid">{sel('brand_id', F.brands, 'All brands')}{sel('model_id', F.models, 'All models')}{sel('shop_id', F.shops, 'All shops')}{sel('city_id', F.cities, 'All cities')}{sel('market_id', F.markets, 'All markets')}</div>
        <button className="link-btn" id="fClear" style={{ marginTop: 8 }} onClick={() => update({ brand_id: '', model_id: '', shop_id: '', city_id: '', market_id: '' })}>Clear filters</button>
      </> : null}</div>
      <div id="sBody" style={dim ? { opacity: 0.6 } : undefined}>{error ? <ErrorBlock message={error.message} /> : !d ? <LoadingBlock /> : (
        <>
          <div className="pm-card total-card"><div><span className="l">Total Mobile Units Sold</span><b>{fmt.n(sm.units)}</b></div>
            <div className="mini"><span><b>{fmt.n(sm.gifts)}</b> gifts</span><span><b>{ratioText(sm.ratio)}</b> gift ratio</span><span><b>{fmt.n(sm.txns)}</b> sales</span></div></div>
          <div className="pm-sec"><h2>Sales by brand · tap a brand to see models</h2><div className="pm-card">{d.brands.length ? d.brands.map((b) => (
            <div key={b.key} className={`brand-row ${st.open === b.key ? 'open' : ''}`} data-open={b.key}>
              <div className="bh" onClick={() => update({ open: st.open === b.key ? null : b.key })}><span className="nm">{b.brand_name}</span><b>{fmt.n(b.units)} <small>units</small></b><Icon name="chevron" className="chev" /></div>
              <div className="models">{b.models.map((m, i) => <div className="mrow" key={i}><span>{m.model_name} <span className="muted mono small">{m.item_code || ''}</span></span><b>{fmt.n(m.units)}</b></div>)}
                <div className="mrow tot"><span>Total {b.brand_name}</span><b>{fmt.n(b.units)} units</b></div></div></div>)) : <div className="pm-pad muted small">No sales for this period.</div>}
            {d.brands.length ? <div className="brand-total"><span>Total</span><b>{fmt.n(sm.units)} Units</b></div> : null}</div></div>
          <div className="pm-sec"><h2>Model-wise summary</h2><div className="pm-card">{d.models.length ? (
            <table className="pm-tbl"><thead><tr><th>Brand</th><th>Model</th><th className="num">Units</th></tr></thead>
              <tbody>{d.models.map((m, i) => <tr key={i}><td>{m.brand_name}</td><td>{m.model_name}</td><td className="num"><b>{fmt.n(m.units)}</b></td></tr>)}</tbody>
              <tfoot><tr><td colSpan={2}>Total Mobile Units Sold</td><td className="num">{fmt.n(sm.units)}</td></tr></tfoot></table>
          ) : <div className="pm-pad muted small">No sales for this period.</div>}</div></div>
          {d.shops.length > 1 ? <div className="pm-sec"><h2>By shop</h2><div className="pm-card">{d.shops.map((x) => <div className="mrow pad" key={x.shop_id}><span>{x.shop_name} <span className="muted mono small">{x.shop_id}</span></span><b>{fmt.n(x.units)}</b></div>)}</div></div> : null}
        </>
      )}</div>
    </>
  );
}
