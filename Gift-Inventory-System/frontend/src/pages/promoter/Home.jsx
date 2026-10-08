/* Promoter home screen (promoter.js home()). */
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon';
import { LoadingBlock, ErrorBlock } from '../../components/ui';
import useApi from '../../hooks/useApi';
import { api } from '../../services/api';
import { fmt } from '../../utils/format';
import { useAuth } from '../../context/AuthContext';
import { useTop, useNav, useGo, firstName, ratioText, manualEntry, TxnRow } from './common';

export default function Home() {
  const { user: u } = useAuth();
  const go = useGo();
  useTop('Gift & Sales Promoter');
  useNav('home');
  const { data: s, error } = useApi(() => api('/promoter/summary'), []);
  return (
    <>
      <div className="hello"><b>Welcome, {firstName(u.name)}</b><span>{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>
      <div id="homeStats">{error ? <ErrorBlock message={error.message} /> : !s ? <LoadingBlock /> : (
        <>
          <div className="pm-card today-grid">
            <div><span className="l">Today&apos;s Mobile Sales</span><b>{fmt.n(s.today.units)}</b><span className="u">{s.today.units === 1 ? 'Unit' : 'Units'}</span></div>
            <div><span className="l">Today&apos;s Gifts Given</span><b>{fmt.n(s.today.gifts)}</b><span className="u">{s.today.gifts === 1 ? 'Gift' : 'Gifts'}</span></div>
          </div>
          <div className="pm-card month-row"><span className="l">This Month</span>
            <div><b>{fmt.n(s.month.units)}</b><span>Mobile Sales</span></div><div><b>{fmt.n(s.month.gifts)}</b><span>Gifts Given</span></div>
            <div><b>{ratioText(s.month.ratio)}</b><span>Gift ratio</span></div></div>
        </>
      )}</div>
      <button className="scan-hero" id="scanBtn" onClick={() => go('/app/scan')}><Icon name="scan" /><b>SCAN SHOP</b><span>Scan the QR code of your assigned shop</span></button>
      <button className="link-btn manual-link" id="manualBtn" onClick={() => manualEntry(go)}><Icon name="edit" />QR not working? Enter Shop ID manually</button>
      <div id="homeData">{s && !error ? (
        <>
          <div className="pm-sec"><h2>My Top Brands{s.top_brands_period === 'month' ? ' · this month' : ''}</h2>
            <div className="pm-card">{s.top_brands.length ? s.top_brands.map((b, i) => (
              <div className="brand-bar" key={i}><span className="rk">{i + 1}</span><span className="nm">{b.brand_name}</span>
                <span className="bar"><i style={{ width: `${Math.max(4, Math.round((b.units / s.top_brands[0].units) * 100))}%` }} /></span><b>{fmt.n(b.units)}</b></div>))
              : <div className="pm-pad muted small">No sales yet. Scan a shop to record your first sale.</div>}</div></div>
          {s.recent.length ? (
            <div className="pm-sec"><h2>Recent sales</h2><div className="pm-card">{s.recent.map((t) => <TxnRow key={t.transaction_id} t={t} />)}</div>
              <Link className="btn block" to="/app/history" style={{ marginTop: 10 }}>All my transactions</Link></div>
          ) : null}
        </>
      ) : null}</div>
    </>
  );
}
