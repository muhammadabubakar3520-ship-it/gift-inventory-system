/* =====================================================================
   Standard filter bar: date range + city, market, promoter, shop, brand, model, gift.
     <FilterBar keys={['range','city','market','promoter','shop','brand','model','gift']}
                value={st} onChange={(patch) => setSt((s) => ({ ...s, ...patch }))} />
   Changing the city clears the market; changing the brand clears the model.
   "Clear filters" clears the dropdowns (not the dates), like the original.
   ===================================================================== */
import { useEffect } from 'react';
import { useLookups } from '../../context/LookupsContext';
import { RANGES, rangeDates } from '../../utils/admin';
import { cityOpts, marketOpts, promoterOpts, shopOpts, brandOpts, modelOpts, giftOpts } from './options';

const IDS = ['city_id', 'market_id', 'promoter_id', 'shop_id', 'brand_id', 'model_id', 'gift_id'];

export default function FilterBar({ keys, value: st, onChange, children }) {
  const { lk, allShops } = useLookups();
  const has = (k) => keys.includes(k);
  useEffect(() => { if (keys.includes('shop') && !lk.shops) allShops().catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = RANGES.find(([r]) => { const d = rangeDates(r); return d.from === (st.from || '') && d.to === (st.to || ''); });
  const sel = (k, el) => (e) => {
    const v = e.target.value;
    if (k === 'city_id') onChange({ city_id: v, ...('market_id' in st || has('market') ? { market_id: '' } : {}) });
    else if (k === 'brand_id') onChange({ brand_id: v, ...('model_id' in st || has('model') ? { model_id: '' } : {}) });
    else onChange({ [k]: v });
    void el;
  };
  const clear = () => { const p = {}; for (const k of IDS) if (k in st) p[k] = ''; onChange(p); };
  return (
    <div className="filters fbar">
      {has('range') && <>
        <div className="seg">{RANGES.map(([r, l]) => (
          <button key={r} type="button" className={cur && cur[0] === r ? 'on' : ''} onClick={() => onChange(rangeDates(r))}>{l}</button>
        ))}</div>
        <input className="input date" type="date" value={st.from || ''} aria-label="From date" title="From date" onChange={(e) => onChange({ from: e.target.value })} />
        <input className="input date" type="date" value={st.to || ''} aria-label="To date" title="To date" onChange={(e) => onChange({ to: e.target.value })} />
      </>}
      {has('city') && <select className="select" value={st.city_id || ''} onChange={sel('city_id')}>{cityOpts(lk)}</select>}
      {has('market') && <select className="select" value={st.market_id || ''} onChange={sel('market_id')}>{marketOpts(lk, st.city_id)}</select>}
      {has('promoter') && <select className="select" value={st.promoter_id || ''} onChange={sel('promoter_id')}>{promoterOpts(lk)}</select>}
      {has('shop') && <select className="select" value={st.shop_id || ''} onChange={sel('shop_id')}>{shopOpts(lk.shops || [])}</select>}
      {has('brand') && <select className="select" value={st.brand_id || ''} onChange={sel('brand_id')}>{brandOpts(lk)}</select>}
      {has('model') && <select className="select" value={st.model_id || ''} onChange={sel('model_id')}>{modelOpts(lk, 'All models', st.brand_id)}</select>}
      {has('gift') && <select className="select" value={st.gift_id || ''} onChange={sel('gift_id')}>{giftOpts(lk)}</select>}
      {children}
      <button type="button" className="link-btn" onClick={clear}>Clear filters</button>
    </div>
  );
}
