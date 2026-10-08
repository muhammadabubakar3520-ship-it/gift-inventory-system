/* =====================================================================
   Admin shell: sidebar navigation, top bar (breadcrumb, live-sync status, quick search) and the
   page area. Pages are nested routes (see App.jsx).
   ===================================================================== */
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import { LoadingBlock, ErrorBlock } from '../components/ui';
import { toastError } from '../components/Toasts';
import { useAuth } from '../context/AuthContext';
import { useLookups } from '../context/LookupsContext';
import { useSync } from '../context/SyncContext';
import { usePageMetaValue } from '../context/PageMetaContext';
import { ensureVendor } from '../utils/vendor';
import { openTransaction } from '../components/admin/Transactions';

const A = '/admin';
const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', href: '/dashboard' },
  { key: 'shops', label: 'Shops', icon: 'store', sub: [['All Shops', '/shops'], ['Add Shop', '/shops/new'], ['Shop QR Codes', '/shops/qr']] },
  { key: 'sales', label: 'Mobile Sales', icon: 'phone', sub: [['All Sales', '/sales'], ['Brand-wise Sales', '/sales/brands'], ['Model-wise Sales', '/sales/models'], ['Shop-wise Sales', '/sales/shops']] },
  { key: 'models', label: 'Mobile Models', icon: 'tag', sub: [['Brands', '/brands'], ['Models', '/models']] },
  { key: 'gifts', label: 'Gifts', icon: 'gift', sub: [['Gift List', '/gifts'], ['Gift Inventory', '/inventory'], ['Allocate Gifts', '/inventory/allocate'], ['Gift DOS (Days of Stock)', '/inventory/dos'], ['Inventory Adjustments', '/inventory/adjustments']] },
  { key: 'promoters', label: 'Promoters', icon: 'users', sub: [['Promoter List', '/promoters'], ['Assign Shops', '/promoters/assign'], ['Performance', '/promoters/performance']] },
  { key: 'import', label: 'Excel Import', icon: 'upload', sub: [['Upload Shops', '/import/shops'], ['Upload Models', '/import/models'], ['Upload Gifts', '/import/gifts'], ['Upload Inventory', '/import/inventory'], ['Upload Brands', '/import/brands'], ['Upload Promoters', '/import/promoters']] },
  { key: 'reports', label: 'Reports', icon: 'chart', sub: [['Sales Report', '/reports/sales'], ['Gift Report & Transactions', '/reports/gifts'], ['Promoter Report', '/reports/promoters'], ['Shop Report', '/reports/shops'], ['More reports & Excel exports', '/reports/brands']] },
  { key: 'settings', label: 'Settings', icon: 'settings', href: '/settings' },
];
const ALL_LINKS = NAV.flatMap((n) => (n.sub ? n.sub.map(([, h]) => h) : [n.href]));

/** The menu link that best matches the current page (longest prefix), like the original. */
function activeLink(path) {
  const p = path.startsWith(A) ? path.slice(A.length) || '/dashboard' : path;
  let best = null;
  for (const h of ALL_LINKS) if (p === h || p.startsWith(h + '/')) if (!best || h.length > best.length) best = h;
  return best;
}

function Sidebar({ open, onNavigate }) {
  const { user, logout } = useAuth();
  const loc = useLocation();
  const on = activeLink(loc.pathname);
  const groupOf = (h) => (NAV.find((n) => n.sub && n.sub.some(([, x]) => x === h)) || {}).key;
  const [openGroups, setOpenGroups] = useState(() => new Set([groupOf(on)].filter(Boolean)));
  useEffect(() => { const g = groupOf(on); if (g) setOpenGroups((s) => (s.has(g) ? s : new Set([...s, g]))); }, [on]);
  const toggle = (k) => setOpenGroups((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const initials = (user.name || '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  return (
    <aside className={`sidebar ${open ? 'open' : ''}`} id="sidebar" aria-label="Main navigation">
      <div className="sb-brand"><span className="logo-mark"><Icon name="gift" /></span><div>Gift Inventory<small>Shop Sales Management</small></div></div>
      <nav className="sb-nav">
        {NAV.map((n) => (n.sub ? (
          <div key={n.key} className={`sb-group ${openGroups.has(n.key) ? 'open' : ''}`}>
            <button className="sb-item" type="button" onClick={() => toggle(n.key)}><Icon name={n.icon} /><span>{n.label}</span><Icon name="chevron" className="caret" /></button>
            <div className="sb-sub">{n.sub.map(([l, h]) => <NavLink key={h} to={A + h} end className={() => (on === h ? 'on' : '')} onClick={onNavigate}>{l}</NavLink>)}</div>
          </div>
        ) : (
          <div key={n.key} className="sb-group"><NavLink className={() => `sb-item ${on === n.href ? 'on' : ''}`} to={A + n.href} onClick={onNavigate}><Icon name={n.icon} /><span>{n.label}</span></NavLink></div>
        )))}
      </nav>
      <div className="sb-foot"><span className="avatar">{initials}</span><div className="who"><b>{user.name}</b><span>{user.email}</span></div>
        <button type="button" title="Log out" aria-label="Log out" onClick={logout}><Icon name="logout" /></button></div>
    </aside>
  );
}

function SyncPill() {
  const { state } = useSync();
  const label = state === 'live' ? 'Live' : state === 'polling' ? 'Auto-refresh' : 'Connecting…';
  const title = state === 'live' ? 'Connected: changes from other devices appear at once' : state === 'polling' ? 'Live link not available: checking for changes every 20 seconds' : 'Connecting to the server';
  return <span className="sync-pill" id="syncPill" data-state={state} title={title}><i />{label}</span>;
}

function QuickSearch() {
  const [v, setV] = useState('');
  const navigate = useNavigate();
  const { lk } = useLookups();
  const submit = (e) => {
    e.preventDefault();
    const q = v.trim();
    if (!q) return;
    const exact = (lk.shops || []).find((x) => x.shop_id.toLowerCase() === q.toLowerCase());
    if (exact) navigate(`${A}/shops/${encodeURIComponent(exact.shop_id)}`);
    else if (/^shp-?\d+$/i.test(q)) navigate(`${A}/shops/${q.toUpperCase().replace(/^SHP-?/, 'SHP-')}`);
    else if (/^txn-\d+$/i.test(q)) openTransaction(q.toUpperCase());
    else navigate(`${A}/shops?search=${encodeURIComponent(q)}`);
    setV('');
  };
  return (
    <form className="search gsearch" role="search" onSubmit={submit}>
      <Icon name="search" />
      <input className="input" value={v} onChange={(e) => setV(e.target.value)} placeholder="Jump to Shop ID, TXN ID or shop name" aria-label="Quick search" />
    </form>
  );
}

function SyncBanner() {
  const { waiting, reloadPage } = useSync();
  if (!waiting) return null;
  return (
    <div className="sync-banner no-print" id="syncBanner"><Icon name="refresh" /><span>New data was saved on another device.</span>
      <button className="btn sm primary" type="button" onClick={reloadPage}>Refresh</button></div>
  );
}

export default function AdminLayout() {
  const [menu, setMenu] = useState(false);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState(null);
  const { refresh } = useAuth();
  const { loadLookups, allShops } = useLookups();
  const { reloadKey } = useSync();
  const meta = usePageMetaValue();
  const loc = useLocation();

  const boot = async () => {
    setErr(null);
    try {
      await refresh();
      await Promise.all([loadLookups(), ensureVendor('chart', 'pdf', 'xlsx')]);
      allShops().catch(() => {}); // for the quick search
      setReady(true);
    } catch (e) { if (e.status !== 401) { toastError(e); setErr(e); } }
  };
  useEffect(() => { boot(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);

  return (
    <>
      <Sidebar open={menu} onNavigate={() => setMenu(false)} />
      <div className={`scrim ${menu ? 'on' : ''}`} id="scrim" onClick={() => setMenu(false)} />
      <div className="main">
        <header className="topbar no-print">
          <button className="btn ghost sm menu-btn" id="menuBtn" aria-label="Open menu" onClick={() => setMenu(true)}><Icon name="menu" /></button>
          <div className="crumbs" id="crumbs">{meta.crumb ? <>{meta.crumb} / </> : null}<b>{meta.title}</b></div>
          <SyncPill />
          <QuickSearch />
        </header>
        <main className="content" id="view" tabIndex={-1}>
          <SyncBanner />
          {err ? <ErrorBlock message={err.message} onRetry={boot} /> : ready ? <Outlet key={reloadKey} /> : <LoadingBlock />}
        </main>
      </div>
    </>
  );
}
