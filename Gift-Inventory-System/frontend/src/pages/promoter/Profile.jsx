/* Promoter profile screen (promoter.js profile()). */
import Icon from '../../components/Icon';
import { EmptyState, LoadingBlock, ErrorBlock } from '../../components/ui';
import useApi from '../../hooks/useApi';
import { api } from '../../services/api';
import { fmt } from '../../utils/format';
import { useAuth } from '../../context/AuthContext';
import { useTop, useNav } from './common';

export default function Profile() {
  useTop('Profile');
  useNav('profile');
  const { user: u, logout } = useAuth();
  const { data: shops, error } = useApi(() => api('/promoter/shops'), []);
  return (
    <>
      <div className="pm-card shop-card"><div className="id">{u.user_code}</div><div className="nm">{u.name}</div><div className="loc">{u.email}</div>{u.phone ? <div className="muted small">{u.phone}</div> : null}</div>
      <div className="pm-sec"><h2>My assigned shops</h2><div className="pm-card" id="pShops">{error ? <ErrorBlock message={error.message} /> : !shops ? <LoadingBlock />
        : shops.length ? shops.map((s) => (
          <div className="list-item static" key={s.shop_id}><span className="gift-ico"><Icon name="store" /></span>
            <div className="main"><div className="t">{s.shop_name}</div><div className="s"><span className="mono">{s.shop_id}</span> · {s.market_name}, {s.city_name}{s.last_visit ? ` · last sale ${fmt.ago(s.last_visit)}` : ''}</div></div>
            <div className={`avail ${s.available <= 0 ? 'out' : ''}`}><b>{fmt.n(s.available)}</b><span>gifts</span></div></div>))
          : <EmptyState title="No shops assigned" text="Ask your admin to assign shops to you." />}</div>
        <p className="muted small" style={{ margin: '6px 2px 0' }}>To record a sale, go to the shop and scan its QR code.</p></div>
      <div className="pm-sec"><button className="btn block" id="logout" style={{ height: 48, color: 'var(--bad)' }} onClick={logout}><Icon name="logout" />Sign out</button></div>
      <p className="muted small" style={{ textAlign: 'center', marginTop: 18 }}>Gift Inventory &amp; Shop Sales · Promoter app</p>
    </>
  );
}
