/* Settings: cities & markets, admin users, data & backup (central database), audit log, my account (from pages-settings.js). */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import DataTable from '../../components/DataTable';
import { Chip, EmptyState, PageHead, SearchBox, LoadingBlock, ErrorBlock } from '../../components/ui';
import { confirmDialog } from '../../components/Modal';
import BusyButton from '../../components/BusyButton';
import { toast, toastError } from '../../components/Toasts';
import { openUserForm, toggleUser } from '../../components/admin/UserForm';
import { promptText } from '../../components/admin/shop-widgets';
import usePaged, { PagedView } from '../../hooks/usePaged';
import useApi from '../../hooks/useApi';
import { api, download, session } from '../../services/api';
import { fmt } from '../../utils/format';
import { usePageMeta } from '../../context/PageMetaContext';
import { useLookups } from '../../context/LookupsContext';
import { useAuth } from '../../context/AuthContext';

// No approval process any more, so the "Sales & Approval" tab is gone (every sale counts and deducts stock at once).
const TABS = [['locations', 'Cities & Markets'], ['admins', 'Admin Users'], ['data', 'Data & Backup'], ['audit', 'Audit Log'], ['account', 'My Account']];

export default function Settings() {
  usePageMeta('Settings');
  const [sp] = useSearchParams();
  const q = sp.get('tab');
  const tab = TABS.some((t) => t[0] === q) ? q : TABS[0][0];
  return (
    <>
      <PageHead title="Settings" desc="Locations, administrator accounts, data & backup, audit trail and your account." />
      <section className="panel"><div className="tabs">{TABS.map(([k, l]) => <Link key={k} className={`tab ${k === tab ? 'on' : ''}`} to={`/admin/settings?tab=${k}`}>{l}</Link>)}</div>
        <div id="sBody" key={tab}>
          {tab === 'locations' && <Locations />}
          {tab === 'admins' && <Admins />}
          {tab === 'audit' && <AuditLog />}
          {tab === 'account' && <Account />}
          {tab === 'data' && <DataTab />}
        </div>
      </section>
    </>
  );
}

/* ------------------------------ Cities & markets ------------------------------ */
function Locations() {
  const { lk, loadLookups } = useLookups();
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState(null);
  const [selCity, setSelCity] = useState(null);
  const first = async () => { setErr(null); try { await loadLookups(); setReady(true); } catch (e) { setErr(e); } };
  useEffect(() => { first(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (err && !ready) return <ErrorBlock message={err.message} onRetry={first} />;
  if (!ready) return <LoadingBlock />;

  const cities = lk.cities;
  const cur = selCity || (cities.length ? cities[0].id : null);
  const markets = lk.markets.filter((m) => m.city_id === cur);
  const city = cities.find((c) => c.id === cur);
  const act = async (fn, msg) => { try { await fn(); toast(msg, 'ok'); await loadLookups(); } catch (e) { toastError(e); } };

  const addCity = async () => { const n = await promptText('Add city', 'City name'); if (n) act(async () => { const c = await api('/masters/cities', { method: 'POST', body: { city_name: n } }); setSelCity(c.id); }, 'City added'); };
  const addMarket = async () => { const n = await promptText(`Add market in ${city.city_name}`, 'Market name'); if (n) act(() => api('/masters/markets', { method: 'POST', body: { city_id: cur, market_name: n } }), 'Market added'); };
  const renCity = async (c) => { const n = await promptText('Rename city', 'New name'); if (n) act(() => api('/masters/cities/' + c.id, { method: 'PUT', body: { city_name: n } }), 'City renamed'); };
  const renMarket = async (m) => { const n = await promptText('Rename market', 'New name'); if (n) act(() => api('/masters/markets/' + m.id, { method: 'PUT', body: { market_name: n } }), 'Market renamed'); };
  const delCity = async (c) => { if (await confirmDialog({ title: 'Delete city?', confirmText: 'Delete', danger: true })) act(async () => { await api('/masters/cities/' + c.id, { method: 'DELETE' }); setSelCity(null); }, 'City deleted'); };
  const delMarket = async (m) => { if (await confirmDialog({ title: 'Delete market?', confirmText: 'Delete', danger: true })) act(() => api('/masters/markets/' + m.id, { method: 'DELETE' }), 'Market deleted'); };

  return (
    <div className="grid g2" style={{ padding: 16 }}>
      <div className="panel"><div className="panel-h"><h2>Cities</h2><span className="sub">{cities.length}</span><button className="btn sm primary" style={{ marginLeft: 'auto' }} id="cAdd" onClick={addCity}><Icon name="plus" />Add city</button></div>
        {cities.length ? (
          <div className="table-wrap"><table className="tbl compact"><thead><tr><th>City</th><th className="num">Markets</th><th className="num">Shops</th><th /></tr></thead><tbody>
            {cities.map((c) => (
              <tr key={c.id} className={`clickable ${c.id === cur ? 'selected' : ''}`.trim()} onClick={(e) => { if (e.target.closest('button')) return; setSelCity(c.id); }}>
                <td className="cell-main">{c.city_name}</td><td className="num">{c.market_count}</td><td className="num">{c.shop_count}</td>
                <td className="actions"><button className="btn sm ghost" title="Rename" onClick={() => renCity(c)}><Icon name="edit" /></button>{!c.shop_count && !c.market_count ? <button className="btn sm ghost" title="Delete" onClick={() => delCity(c)}><Icon name="x" /></button> : null}</td>
              </tr>
            ))}
          </tbody></table></div>
        ) : <EmptyState title="No cities" text="Add the cities where your shops are located." />}</div>
      <div className="panel"><div className="panel-h"><h2>Markets {city ? <>in {city.city_name}</> : null}</h2><span className="sub">{markets.length}</span>
        {city ? <button className="btn sm primary" style={{ marginLeft: 'auto' }} id="mAdd" onClick={addMarket}><Icon name="plus" />Add market</button> : null}</div>
        {markets.length ? (
          <div className="table-wrap"><table className="tbl compact"><thead><tr><th>Market</th><th className="num">Shops</th><th /></tr></thead><tbody>
            {markets.map((m) => (
              <tr key={m.id}><td className="cell-main">{m.market_name}</td><td className="num">{m.shop_count}</td>
                <td className="actions"><button className="btn sm ghost" title="Rename" onClick={() => renMarket(m)}><Icon name="edit" /></button>{!m.shop_count ? <button className="btn sm ghost" title="Delete" onClick={() => delMarket(m)}><Icon name="x" /></button> : null}</td></tr>
            ))}
          </tbody></table></div>
        ) : <EmptyState title="No markets" text={city ? `Add markets for ${city.city_name}.` : 'Select a city.'} />}</div>
    </div>
  );
}

/* ------------------------------ Admins ------------------------------ */
function Admins() {
  const { user: me } = useAuth();
  const { data: rows, error, reload } = useApi(() => api('/users', { query: { role: 'admin' } }), []);
  return (
    <>
      <div className="filters"><span className="muted small">Administrators have full access to all data and settings.</span><span className="spacer" /><button className="btn sm primary" id="aAdd" onClick={() => openUserForm(null, 'admin', reload)}><Icon name="plus" />Add admin</button></div>
      <div id="aList">
        {error && !rows ? <ErrorBlock message={error.message} onRetry={reload} /> : !rows ? <LoadingBlock /> : (
          <DataTable rows={rows} cols={[
            { label: 'Name', render: (u) => <><div className="cell-main">{u.name}{u.id === me.id ? <> <span className="tag">You</span></> : null}</div><div className="cell-sub mono">{u.user_code}</div></> },
            { label: 'Email', key: 'email' }, { label: 'Phone', render: (u) => u.phone || '—' },
            { label: 'Last login', render: (u) => <span className="muted">{u.last_login_at ? fmt.dt(u.last_login_at) : 'Never'}</span> },
            { label: 'Status', render: (u) => <Chip status={u.status} /> },
            { label: '', cls: 'actions', render: (u) => (u.id === me.id ? '' : <>
              <button className="btn sm" onClick={() => toggleUser(u, reload)}>{u.status === 'active' ? 'Deactivate' : 'Activate'}</button>{' '}
              <button className="btn sm ghost" onClick={() => openUserForm(u, 'admin', reload)}><Icon name="edit" /></button>
            </>) },
          ]} />
        )}
      </div>
    </>
  );
}

/* ------------------------------ Audit ------------------------------ */
const LABELS = {
  shop_created: 'Shop created', shop_updated: 'Shop updated', shop_deleted: 'Shop deleted', shop_activated: 'Shop activated', shop_deactivated: 'Shop deactivated', shops_assigned: 'Shops assigned',
  qr_generated: 'QR generated', qr_regenerated: 'QR regenerated', qr_downloaded: 'QR downloaded', qr_printed: 'QR printed',
  inventory_uploaded: 'Inventory uploaded', inventory_allocated: 'Inventory allocated', inventory_adjusted: 'Inventory adjusted',
  sales_finalised: 'Open sales made final (approval removed)', mobile_sale_submitted: 'Mobile sale submitted', gift_transaction_submitted: 'Gift transaction submitted', transaction_submitted: 'Transaction submitted',
  transaction_review_started: 'Moved to Pending Review', transaction_approved: 'Transaction approved', transaction_rejected: 'Transaction rejected', transaction_reversed: 'Approval reversed',
  brand_created: 'Brand created', brand_updated: 'Brand updated', model_created: 'Model created', model_updated: 'Model updated',
  gift_created: 'Gift created', gift_updated: 'Gift updated', gift_stock_received: 'Gift stock received', user_created: 'User created', user_updated: 'User updated',
  user_password_reset: 'Password reset', login: 'Signed in', login_failed: 'Sign-in failed', logout: 'Signed out', settings_updated: 'Settings updated',
  import_shops: 'Excel import: shops', import_brands: 'Excel import: brands', import_models: 'Excel import: models', import_gifts: 'Excel import: gifts', import_inventory: 'Excel import: inventory', import_promoters: 'Excel import: promoters',
  backup_exported: 'Backup downloaded', backup_restored: 'Backup restored',
};
const ACTION_LABEL = (a) => LABELS[a] || a.replace(/_/g, ' ');
const KEY_ACTIONS = ['shop_created', 'shop_updated', 'qr_generated', 'qr_regenerated', 'inventory_uploaded', 'inventory_allocated', 'inventory_adjusted', 'mobile_sale_submitted', 'gift_transaction_submitted', 'transaction_review_started', 'transaction_approved', 'transaction_rejected', 'transaction_reversed', 'shops_assigned', 'brand_created', 'model_created', 'gift_created', 'user_created', 'login', 'login_failed'];
const actionStyle = (a) => (/failed|rejected|deactivated|reversed|deleted/.test(a) ? { background: 'var(--bad-soft)', color: 'var(--bad)' } : /approved|created|submitted/.test(a) ? { background: 'var(--ok-soft)', color: 'var(--ok)' } : undefined);

function AuditLog() {
  const list = usePaged({ initial: { search: '', action: '', from: '', to: '' }, pageSize: 50, fetch: (st) => api('/audit', { query: st }) });
  return (
    <>
      <div className="filters" id="auF">
        <SearchBox value={list.state.search} onChange={(v) => list.set({ search: v })} placeholder="Search action, reference, user, details" />
        <select className="select" value={list.state.action} onChange={(e) => list.set({ action: e.target.value })}><option value="">All actions</option>{KEY_ACTIONS.map((a) => <option key={a} value={a}>{ACTION_LABEL(a)}</option>)}<option value="import_*">Excel imports (all)</option></select>
        <input className="input date" type="date" aria-label="From date" value={list.state.from} onChange={(e) => list.set({ from: e.target.value })} /><input className="input date" type="date" aria-label="To date" value={list.state.to} onChange={(e) => list.set({ to: e.target.value })} />
        <span className="spacer" /><BusyButton className="btn sm" id="auExp" onClick={() => download('/audit/export.csv', list.state).catch(toastError)}><Icon name="download" />Export</BusyButton>
      </div>
      <div id="auList">
        <PagedView list={list}>{(d) => (
          <DataTable rows={d.rows} compact cols={[
            { label: 'Date', render: (r) => <span className="nowrap">{fmt.date(r.created_at)}</span> },
            { label: 'Time', render: (r) => <span className="nowrap">{fmt.time(r.created_at)}</span> },
            { label: 'User', render: (r) => (r.user_name ? <>{r.user_name} <span className="muted small">{r.role}</span></> : <span className="muted">—</span>) },
            { label: 'Action', render: (r) => <span className="tag" style={actionStyle(r.action)}>{ACTION_LABEL(r.action)}</span> },
            { label: 'Transaction / reference', render: (r) => <span className="mono">{r.entity_id || '—'}</span> },
            { label: 'Details', render: (r) => <span className="muted small" style={{ display: 'block', maxWidth: 440, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.details || ''}>{r.details || ''}</span> },
          ]} empty={<EmptyState title="No log entries" text="" />} />
        )}</PagedView>
      </div>
    </>
  );
}

/* ------------------------------ Data & backup (central database) ------------------------------ */
const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
function DataTab() {
  const { data: info, error, reload } = useApi(() => api('/system/info'), []);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  if (error && !info) return <ErrorBlock message={error.message} onRetry={reload} />;
  if (!info) return <LoadingBlock />;

  const restore = async () => {
    const f = file;
    if (!f) return toast('Choose a backup file first', 'warn');
    const ok = await confirmDialog({ title: 'Replace all central data?', message: <>All data in the central database (shops, gifts, promoters, stock, sales, photos) will be <b>replaced</b> by this backup, for every device. This cannot be undone. Download a backup first if you are not sure.</>, confirmText: 'Replace all data', danger: true });
    if (!ok) return undefined;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append('file', f);
      const r = await api('/system/restore', { method: 'POST', form: fd });
      toast(`Restored: ${fmt.n(r.shops)} shops, ${fmt.n(r.transactions)} transactions, ${fmt.n(r.photos)} photos. Please sign in again.`, 'ok', 7000);
      session.clear(); setTimeout(() => { window.location.href = '/'; }, 1800); // like legacy App.nav('/'): full reload to the sign-in page
    } catch (ex) { toastError(ex); }
    setBusy(false);
    return undefined;
  };

  return (
    <div className="panel-b stack" style={{ maxWidth: 760 }}>
      <div className="callout ok"><b>All data is saved in the central database on the server.</b> Every phone and computer that signs in sees the same data. Changes appear on other devices within seconds.</div>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <div className="kpi"><div className="k-label">Shops</div><div className="k-value">{fmt.n(info.shops)}</div></div>
        <div className="kpi"><div className="k-label">Gifts</div><div className="k-value">{fmt.n(info.gifts)}</div><div className="k-sub">{fmt.n(info.brands)} brands · {fmt.n(info.models)} models</div></div>
        <div className="kpi"><div className="k-label">Transactions</div><div className="k-value">{fmt.n(info.transactions)}</div><div className="k-sub">{fmt.n(info.photos)} photos</div></div>
        <div className="kpi"><div className="k-label">Database size</div><div className="k-value" style={{ fontSize: 20 }}>{mb(info.db_bytes || 0)}</div></div>
      </div>
      <div className="panel"><div className="panel-h"><h2>Backup</h2><span className="sub">Download all data (+ photos) as one file</span></div>
        <div className="panel-b row wrap">
          <BusyButton className="btn primary" id="bkFull" onClick={() => download('/system/backup').then(() => toast('Backup downloaded', 'ok')).catch(toastError)}><Icon name="download" />Download full backup</BusyButton>
          <BusyButton className="btn" id="bkLite" onClick={() => download('/system/backup', { photos: 'no' }).then(() => toast('Backup downloaded', 'ok')).catch(toastError)}><Icon name="download" />Backup without photos (smaller)</BusyButton>
        </div></div>
      <div className="panel"><div className="panel-h"><h2>Move data in / Restore</h2><span className="sub">Replace ALL data in the central database with a backup file</span></div>
        <div className="panel-b row wrap"><input type="file" accept=".json,application/json" id="rsFile" className="input" style={{ paddingTop: 6, maxWidth: 360 }} onChange={(e) => setFile(e.target.files[0] || null)} />
          <button className="btn" id="rsGo" disabled={busy} onClick={restore}>{busy ? <span className="spinner" /> : <><Icon name="upload" />Restore backup</>}</button></div>
        <div className="panel-b" style={{ paddingTop: 0 }}><div className="muted small">To move data from a device that used the offline HTML file: open the offline file on that device → Settings → Data &amp; Backup → Download full backup. Then upload that file here. Everyone must sign in again afterwards. The admin signs in with the admin email and password set on the server.</div></div></div>
    </div>
  );
}

/* ------------------------------ Account ------------------------------ */
function Account() {
  const { user: u } = useAuth();
  return (
    <div className="panel-b" style={{ maxWidth: 520 }}><div className="stack">
      <dl className="dl"><dt>Name</dt><dd>{u.name}</dd><dt>Email</dt><dd>{u.email}</dd><dt>Role</dt><dd>Administrator</dd></dl>
      <div className="muted small">Passwords are fixed and cannot be changed in the app.</div></div></div>
  );
}
