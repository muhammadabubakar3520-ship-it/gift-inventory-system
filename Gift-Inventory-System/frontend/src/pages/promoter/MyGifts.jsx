/* Promoter "My Gifts" screen (promoter.js myGifts()). The range is kept while the app is open. */
import { useEffect, useRef, useState } from 'react';
import { LoadingBlock, ErrorBlock } from '../../components/ui';
import useApi from '../../hooks/useApi';
import { api } from '../../services/api';
import { fmt } from '../../utils/format';
import { useTop, useNav, usePromoter } from './common';
import { RANGES, rangeQuery } from './MySales';

export default function MyGifts() {
  useTop('My Gifts');
  useNav('gifts');
  const { store } = usePromoter();
  const [range, setRange] = useState(store.gifts.range);
  const { data: d, error, reload } = useApi(() => api('/promoter/gifts', { query: rangeQuery(range) }), []);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    reload();
  }, [range]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="chips" id="gRange">{RANGES.map(([k, l]) => <button key={k} data-r={k} className={k === range ? 'on' : ''} onClick={() => { store.gifts.range = k; setRange(k); }}>{l}</button>)}</div>
      <div id="gBody">{error ? <ErrorBlock message={error.message} /> : !d ? <LoadingBlock /> : (
        <>
          <div className="pm-card total-card"><div><span className="l">Total Gifts Given</span><b>{fmt.n(d.total)}</b></div></div>
          <div className="pm-sec"><h2>Gifts given</h2><div className="pm-card">{d.gifts.length ? (
            <table className="pm-tbl"><thead><tr><th>Gift</th><th className="num">Quantity Given</th></tr></thead>
              <tbody>{d.gifts.map((g, i) => <tr key={i}><td>{g.gift_name}</td><td className="num"><b>{fmt.n(g.given)}</b></td></tr>)}</tbody>
              <tfoot><tr><td>Total Gifts Given</td><td className="num">{fmt.n(d.total)}</td></tr></tfoot></table>
          ) : <div className="pm-pad muted small">No gifts given in this period.</div>}</div></div>
          <div className="pm-sec"><h2>Gift inventory used · my shops</h2>{d.inventory.length ? d.inventory.map((g, i) => {
            const pct = g.allocated ? Math.round((g.given / g.allocated) * 100) : 0;
            return (
              <div className="pm-card inv-card" key={i}><div className="ih"><b>{g.gift_name}</b><span className="muted small">{pct}% used</span></div>
                <div className="meter"><i style={{ width: `${pct}%` }} /></div>
                <div className="inv3"><div><span>Allocated</span><b>{fmt.n(g.allocated)}</b></div><div><span>Given</span><b>{fmt.n(g.given)}</b></div><div><span>Remaining</span><b>{fmt.n(g.remaining)}</b></div></div></div>
            );
          }) : <div className="pm-card pm-pad muted small">No gift stock at your shops yet.</div>}</div>
        </>
      )}</div>
    </>
  );
}
