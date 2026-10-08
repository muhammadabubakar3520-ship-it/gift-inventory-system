/* Promoter mobile app (from public/promoter/index.html + promoter.js): shell, router and live sync.
   Flow: SCAN SHOP → Shop Verified → Mobile Sold (brand, model, qty, photo)
         → Gift Given (gift, qty, photo) → Review → SUBMIT SALE → Success
   Screens: Home · Scan Shop · My Sales · My Gifts · My Transactions · Profile */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import PromoterTop from '../../components/promoter/PromoterTop';
import PromoterNav from '../../components/promoter/PromoterNav';
import { useAuth } from '../../context/AuthContext';
import { useSync } from '../../context/SyncContext';
import { PromoterContext, useGo } from './common';
import Home from './Home';
import Scan from './Scan';
import Shop from './Shop';
import Sale from './Sale';
import MySales from './MySales';
import MyGifts from './MyGifts';
import History from './History';
import Profile from './Profile';

export default function PromoterApp() {
  const { refresh } = useAuth();
  const sync = useSync();
  const loc = useLocation();
  const go = useGo();
  const [ready, setReady] = useState(false);
  const [top, setTop] = useState({ title: '', back: null, sub: null });
  const [nav, setNav] = useState('');
  // kept while the app is open: the sale being entered, the brands list, My Sales / My Gifts filters
  const store = useRef({
    draft: null,
    brands: null,
    sales: { range: 'month', brand_id: '', model_id: '', shop_id: '', city_id: '', market_id: '', open: null },
    gifts: { range: 'month' },
  }).current;
  const ctx = useMemo(() => ({ setTop, setNav, store }), [store]);

  useEffect(() => {
    document.body.className = 'pm';
    document.title = 'Promoter · Gift Inventory';
    return () => { document.body.className = ''; };
  }, []);
  // refresh the signed-in user's details, then show the first screen
  useEffect(() => {
    let live = true;
    refresh().then(() => { if (live) setReady(true); }, (e) => { if (live && e.status !== 401) setReady(true); });
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // every navigation re-runs the screen from the top, like the legacy hash router
  const routeKey = `${loc.pathname}|${(loc.state && loc.state.n) || ''}|${sync ? sync.reloadKey : 0}`;
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname, loc.state]);

  return (
    <PromoterContext.Provider value={ctx}>
      <div className="pm-shell">
        <PromoterTop title={top.title} back={top.back} sub={top.sub} onBack={go} />
        <main className="pm-main" id="view">
          {ready && (
            <Routes key={routeKey}>
              <Route index element={<Navigate to="home" replace />} />
              <Route path="home" element={<Home />} />
              <Route path="scan" element={<Scan />} />
              <Route path="shop/:code" element={<Shop />} />
              <Route path="sale/:code/:step?" element={<Sale />} />
              <Route path="sales" element={<MySales />} />
              <Route path="gifts" element={<MyGifts />} />
              <Route path="history/:status?" element={<History />} />
              <Route path="profile" element={<Profile />} />
              <Route path="*" element={<Home />} />
            </Routes>
          )}
        </main>
        <PromoterNav active={nav} />
      </div>
    </PromoterContext.Provider>
  );
}
