/* Gifts: gift list and gift details (from pages-gifts.js). */
import { useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import DataTable from '../../components/DataTable';
import { Chip, StockCell, EmptyState, PageHead, SearchBox, AuthImage, LoadingBlock, ErrorBlock } from '../../components/ui';
import { confirmDialog } from '../../components/Modal';
import { toast, toastError } from '../../components/Toasts';
import { openGiftForm, openReceiveStock } from '../../components/admin/GiftForm';
import usePaged, { PagedView } from '../../hooks/usePaged';
import useApi from '../../hooks/useApi';
import { api } from '../../services/api';
import { fmt } from '../../utils/format';
import { usePageMeta } from '../../context/PageMetaContext';
import { useLookups } from '../../context/LookupsContext';

const Thumb = ({ g }) => (g.image_path
  ? <AuthImage className="thumb" path={`/files/gifts/${g.gift_id}/image`} />
  : <span className="thumb" style={{ display: 'grid', placeItems: 'center', color: '#98a4b5' }}><Icon name="gift" /></span>);

export function GiftList({ openNew = false }) {
  usePageMeta(openNew ? 'Add Gift' : 'Gift List', 'Gifts');
  const navigate = useNavigate();
  const { lk } = useLookups();
  const list = usePaged({ initial: { search: '', status: '', category: '' }, fetch: async (st) => ({ rows: await api('/gifts', { query: st }) }) });
  // open the form once per visit of /gifts/new (the ref keeps StrictMode's second effect run from opening a second form)
  const opened = useRef(false);
  useEffect(() => {
    if (!openNew) { opened.current = false; return; }
    if (opened.current) return;
    opened.current = true;
    openGiftForm(null, () => list.reload());
  }, [openNew]); // eslint-disable-line react-hooks/exhaustive-deps

  const cols = [
    { label: '', width: '56px', render: (g) => <Thumb g={g} /> },
    { label: 'Gift ID', render: (g) => <span className="mono"><b>{g.gift_id}</b></span> },
    { label: 'Gift', render: (g) => <><div className="cell-main">{g.gift_name}</div><div className="cell-sub">{g.category || '—'} · {g.unit}</div></> },
    { label: 'Total stock', num: true, key: 'total_quantity' },
    { label: 'Allocated', num: true, key: 'allocated' },
    { label: 'In warehouse', num: true, render: (g) => <StockCell remaining={g.unallocated} allocated={g.total_quantity} /> },
    { label: 'Given', num: true, key: 'distributed' },
    { label: 'Remaining in shops', num: true, key: 'remaining_in_shops' },
    { label: 'Shops', num: true, key: 'shop_count' },
    { label: 'Status', render: (g) => <Chip status={g.status} /> },
    { label: '', cls: 'actions', render: (g) => <><button className="btn sm" onClick={() => openReceiveStock(g, list.reload)}>+ Stock</button> <button className="btn sm ghost" title="Edit" onClick={() => openGiftForm(g, list.reload)}><Icon name="edit" /></button></> },
  ];
  const cats = [...new Set(lk.gifts.map((x) => x.category).filter(Boolean))];
  return (
    <>
      <PageHead title="Gifts" desc="Promotional gift catalogue with central warehouse stock and shop allocation."
        actions={<button className="btn primary" id="gAdd" onClick={() => openGiftForm(null, list.reload)}><Icon name="plus" />Add gift</button>} />
      <section className="panel">
        <div className="filters" id="gFilters">
          <SearchBox value={list.state.search} onChange={(v) => list.set({ search: v })} placeholder="Search gift ID, name, category" />
          <select className="select" value={list.state.category} onChange={(e) => list.set({ category: e.target.value })}><option value="">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>
          <select className="select" value={list.state.status} onChange={(e) => list.set({ status: e.target.value })}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
        </div>
        <div id="gList">
          <PagedView list={list}>{(d) => (
            <DataTable cols={cols} rows={d.rows} onRow={(g) => navigate('/admin/gifts/' + g.gift_id)}
              empty={<EmptyState title="No gifts yet" text="Add the promotional gifts you distribute." action={<button className="btn primary" onClick={() => openGiftForm(null, list.reload)}><Icon name="plus" />Add gift</button>} />}
              footer={d.rows.length ? ['total_quantity', 'allocated', 'distributed', 'remaining_in_shops'].reduce((a, k) => ({ ...a, [k]: d.rows.reduce((s, r) => s + r[k], 0) }), {}) : null} />
          )}</PagedView>
        </div>
      </section>
    </>
  );
}

export function GiftDetail() {
  usePageMeta('Gift Details', 'Gifts');
  const { id } = useParams();
  const navigate = useNavigate();
  const { loadLookups } = useLookups();
  const { data, error, reload } = useApi(() => api('/gifts/' + encodeURIComponent(id)), [id]);
  if (error && !data) return <ErrorBlock message={error.message} onRetry={reload} />;
  if (!data) return <LoadingBlock />;
  const { gift: g, shops } = data;

  const toggle = async () => {
    const to = g.status === 'active' ? 'inactive' : 'active';
    const ok = await confirmDialog({ title: to === 'inactive' ? 'Deactivate gift?' : 'Activate gift?', message: to === 'inactive' ? 'Promoters will no longer see this gift and cannot submit it. Existing stock and history are kept.' : 'Promoters will be able to submit this gift again.', confirmText: to === 'inactive' ? 'Deactivate' : 'Activate', danger: to === 'inactive' });
    if (!ok) return;
    try { await api(`/gifts/${g.id}/status`, { method: 'PATCH', body: { status: to } }); await loadLookups(); toast('Gift updated', 'ok'); reload(); } catch (e) { toastError(e); }
  };

  return (
    <>
      <PageHead title={g.gift_name} desc={<><span className="mono">{g.gift_id}</span> · {g.category || 'No category'} · {g.unit}</>} actions={<>
        <Link className="btn" to="/admin/gifts"><Icon name="back" />All gifts</Link>
        <button className="btn" id="gToggle" onClick={toggle}>{g.status === 'active' ? 'Deactivate' : 'Activate'}</button>
        <button className="btn" id="gStock" onClick={() => openReceiveStock(g, reload)}>+ Receive stock</button>
        <button className="btn" id="gEdit" onClick={() => openGiftForm(g, reload)}><Icon name="edit" />Edit</button>
        <Link className="btn primary" to={`/admin/inventory/allocate?gift=${g.id}`}><Icon name="plus" />Allocate to shops</Link>
      </>} />
      <section className="panel">
        <div className="panel-b profile-head">
          <div style={{ width: 132, flex: 'none' }}>{g.image_path
            ? <AuthImage path={`/files/gifts/${g.gift_id}/image`} style={{ width: 132, height: 132, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)' }} />
            : <div style={{ width: 132, height: 132, borderRadius: 8, background: '#eef1f5', display: 'grid', placeItems: 'center', color: '#98a4b5' }}><Icon name="gift" /></div>}</div>
          <dl className="dl" style={{ flex: 1 }}><dt>Description</dt><dd>{g.description || '—'}</dd><dt>Status</dt><dd><Chip status={g.status} /></dd><dt>Added</dt><dd>{fmt.date(g.created_at)}</dd></dl>
        </div>
        <div className="stat-row" style={{ gridTemplateColumns: 'repeat(5,1fr)' }}>
          <div><div className="v">{fmt.n(g.total_quantity)}</div><div className="l">Total stock</div></div>
          <div><div className="v">{fmt.n(g.unallocated)}</div><div className="l">In warehouse</div></div>
          <div><div className="v">{fmt.n(g.allocated)}</div><div className="l">Allocated to {fmt.n(g.shop_count)} shops</div></div>
          <div><div className="v">{fmt.n(g.distributed)}</div><div className="l">Given</div></div>
          <div><div className="v">{fmt.n(g.remaining_in_shops)}</div><div className="l">Remaining in shops</div></div>
        </div>
      </section>
      <section className="panel" style={{ marginTop: 16 }}><div className="panel-h"><h2>Shops holding this gift</h2><span className="sub">{fmt.n(shops.length)} shops</span></div>
        <div id="gShops">
          <DataTable rows={shops} onRow={(s) => navigate('/admin/shops/' + s.shop_id)} cols={[
            { label: 'Shop', render: (s) => <><span className="mono"><b>{s.shop_id}</b></span> <span className="cell-main">{s.shop_name}</span></> },
            { label: 'City / Market', render: (s) => `${s.city_name} · ${s.market_name}` },
            { label: 'Allocated', num: true, key: 'allocated' }, { label: 'Given', num: true, key: 'distributed' },
            { label: 'Remaining', num: true, render: (s) => <StockCell remaining={s.remaining} allocated={s.allocated} /> },
          ]} empty={<EmptyState title="Not allocated yet" text="Allocate this gift to shops to start distribution." />} />
        </div>
      </section>
    </>
  );
}
