/* Shops: shop list, shop profile and QR label sheet (from pages-shops.js). */
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import DataTable from '../../components/DataTable';
import BusyButton from '../../components/BusyButton';
import { Chip, StockCell, EmptyState, PageHead, SearchBox, LoadingBlock, ErrorBlock, ratio } from '../../components/ui';
import { Modal, openModal, confirmDialog } from '../../components/Modal';
import { toast, toastError } from '../../components/Toasts';
import { openShopForm } from '../../components/admin/ShopForm';
import { movementTag } from '../../components/admin/shop-widgets';
import { dosChip, dosNum } from '../../components/admin/dos-widgets';
import { openTransaction } from '../../components/admin/Transactions';
import { openAdjustDialog } from '../../components/admin/inventory-widgets';
import { cityOpts, marketOpts, promoterOpts } from '../../components/admin/options';
import usePaged, { PagedView } from '../../hooks/usePaged';
import useApi from '../../hooks/useApi';
import { api, download } from '../../services/api';
import { fmt } from '../../utils/format';
import { usePageMeta } from '../../context/PageMetaContext';
import { useLookups } from '../../context/LookupsContext';
import { useHoldLive } from '../../context/SyncContext';

/* ------------------------------ Shop list ------------------------------ */
export function ShopList({ openNew = false }) {
  usePageMeta(openNew ? 'Add Shop' : 'All Shops', 'Shops');
  const navigate = useNavigate();
  const [query] = useSearchParams();
  const { lk, loadLookups } = useLookups();
  const [selected, setSelected] = useState(() => new Set());
  const [bulkPromoter, setBulkPromoter] = useState('');
  const [delBusy, setDelBusy] = useState(false);
  const list = usePaged({
    initial: { search: query.get('search') || '', city_id: query.get('city_id') || '', market_id: '', promoter_id: query.get('promoter_id') || '', status: '', sort: 'shop_id', dir: 'asc' },
    fetch: (st) => api('/shops', { query: st }),
  });
  // open the form once per visit of /shops/new (the ref keeps StrictMode's second effect run from opening a second form)
  const opened = useRef(false);
  useEffect(() => {
    if (!openNew) { opened.current = false; return; }
    if (opened.current) return;
    opened.current = true;
    openShopForm(null, (s) => navigate('/admin/shops/' + s.shop_id));
  }, [openNew]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSelect = (n) => { setSelected(n); setBulkPromoter(''); };
  const n = selected.size;

  const cols = [
    { label: 'Shop ID', sort: 'shop_id', render: (r) => <Link className="mono" to={`/admin/shops/${r.shop_id}`}><b>{r.shop_id}</b></Link> },
    { label: 'Shop', sort: 'shop_name', render: (r) => <><div className="cell-main">{r.shop_name}</div>{r.address ? <div className="cell-sub">{r.address}</div> : null}</> },
    { label: 'City / Market', sort: 'city', render: (r) => <><div>{r.city_name}</div><div className="cell-sub">{r.market_name}</div></> },
    { label: 'Promoter', render: (r) => r.promoter_name || <span className="muted">Not assigned</span> },
    { label: 'Allocated', num: true, key: 'allocated' },
    { label: 'Gifts given', num: true, key: 'distributed', sort: 'distributed' },
    { label: 'Remaining', num: true, sort: 'remaining', render: (r) => <StockCell remaining={r.remaining} allocated={r.allocated} /> },
    { label: 'Status', render: (r) => <Chip status={r.status} /> },
    { label: 'Added', render: (r) => <span className="muted nowrap">{fmt.date(r.created_at)}</span> },
    { label: '', cls: 'actions', render: (r) => <button className="btn sm ghost" title="Edit" onClick={() => openShopForm(r, () => list.reload())}><Icon name="edit" /></button> },
  ];

  const bulkAssign = async () => {
    const v = bulkPromoter;
    if (!v) return toast('Choose a promoter', 'warn');
    try {
      await api('/shops/bulk-assign', { method: 'POST', body: { ids: [...selected], promoter_id: v === 'none' ? null : v } });
      toast(`${n} shop(s) updated`, 'ok');
      onSelect(new Set());
      loadLookups();
      list.reload();
    } catch (ex) { toastError(ex); }
    return undefined;
  };

  const deleteShops = async () => {
    const ids = [...selected];
    if (!ids.length) return toast('Tick the shops you want to delete in the list first.', 'warn');
    let p;
    try { p = await api('/shops/delete-preview', { method: 'POST', body: { ids } }); } catch (ex) { return toastError(ex); }
    if (p.blocked.length) {
      return openModal((close) => (
        <Modal title="Cannot delete yet" onClose={close} footer={<button className="btn" onClick={close}>Close</button>}>
          <div className="stack"><div className="callout bad">{p.blocked.length} of the selected shop(s) still have <b>open submissions</b> from before. They cannot be deleted yet.</div>
            <div className="table-wrap panel"><table className="tbl compact"><thead><tr><th>Shop</th><th className="num">Pending</th></tr></thead>
              <tbody>{p.blocked.map((b) => <tr key={b.shop_id}><td><b className="mono">{b.shop_id}</b> {b.shop_name}</td><td className="num">{fmt.n(b.pending)}</td></tr>)}</tbody></table></div></div>
        </Modal>
      ));
    }
    const ok = await confirmDialog({
      title: `Delete ${p.shops} shop(s) permanently?`,
      message: <div className="stack"><div>This cannot be undone.</div><ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
        <li><b>{fmt.n(p.return_to_warehouse)}</b> unsold gifts go back to the warehouse.</li>
        <li><b>{fmt.n(p.distributed)}</b> gifts already given out are removed from gift stock totals.</li>
        <li><b>{fmt.n(p.transactions)}</b> transactions and their photos are deleted.</li></ul>
        <div className="muted small">Tip: use <b>Deactivate</b> instead if you may need this shop&apos;s history later.</div></div>,
      confirmText: `Delete ${p.shops} shop(s)`, danger: true,
    });
    if (!ok) return undefined;
    setDelBusy(true);
    try {
      const r = await api('/shops/delete', { method: 'POST', body: { ids } });
      toast(`${r.deleted} shop(s) deleted · ${fmt.n(r.returned_to_warehouse)} gifts returned to warehouse`, 'ok', 6000);
      onSelect(new Set());
      await loadLookups();
      list.reload();
    } catch (ex) { toastError(ex); } finally { setDelBusy(false); }
    return undefined;
  };

  const st = list.state;
  return (
    <>
      <PageHead title="Shops" desc="All retail shops with their unique Shop ID, location, promoter and stock position." actions={<>
        <button className="btn danger-outline" id="btnDelete" title="Tick shops in the list, then click to delete them" disabled={delBusy} onClick={deleteShops}>
          {delBusy ? <span className="spinner" /> : <><Icon name="trash" /><span>{n ? `Delete shops (${n})` : 'Delete shops'}</span></>}</button>
        <Link className="btn" to="/admin/import/shops"><Icon name="upload" />Import Excel</Link>
        <BusyButton className="btn" id="btnExport" onClick={() => download('/shops/export.csv', list.state).catch(toastError)}><Icon name="download" />Export</BusyButton>
        <button className="btn primary" id="btnAdd" onClick={() => openShopForm(null, () => list.reload())}><Icon name="plus" />Add shop</button>
      </>} />
      <section className="panel">
        <div className="filters" id="filters">
          <SearchBox value={st.search} onChange={(v) => list.set({ search: v })} placeholder="Search Shop ID or shop name" />
          <select className="select" id="fCity" value={st.city_id} onChange={(e) => list.set({ city_id: e.target.value, market_id: '' })}>{cityOpts(lk)}</select>
          <select className="select" id="fMarket" value={st.market_id} onChange={(e) => list.set({ market_id: e.target.value })}>{marketOpts(lk, st.city_id)}</select>
          <select className="select" value={st.promoter_id} onChange={(e) => list.set({ promoter_id: e.target.value })}>{promoterOpts(lk)}<option value="none">Not assigned</option></select>
          <select className="select" value={st.status} onChange={(e) => list.set({ status: e.target.value })}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
        </div>
        <div id="bulk">
          {n > 0 && (
            <div className="bulkbar"><b>{n} selected</b>
              <select className="select sm" id="bulkPromoter" style={{ width: 'auto' }} value={bulkPromoter} onChange={(e) => setBulkPromoter(e.target.value)}>{promoterOpts(lk, 'Assign promoter…', true, '')}<option value="none">Remove promoter</option></select>
              <BusyButton className="btn sm" id="bulkAssign" onClick={bulkAssign}>Apply</BusyButton>
              <button className="btn sm" id="bulkQr" onClick={() => navigate('/admin/shops/qr?ids=' + [...selected].join(','))}><Icon name="qr" />Print QR labels</button>
              <span className="spacer" /><button className="link-btn" id="bulkClear" onClick={() => { onSelect(new Set()); list.reload(); }}>Clear selection</button></div>
          )}
        </div>
        <div id="list">
          <PagedView list={list}>{(d, s) => (
            <DataTable cols={cols} rows={d.rows} sort={s.sort} dir={s.dir} onSort={list.sortBy} selectable selected={selected} onSelect={onSelect}
              onRow={(r) => navigate('/admin/shops/' + r.shop_id)}
              empty={<EmptyState title="No shops found" text="Add your first shop or change the filters." action={<button className="btn primary" onClick={() => openShopForm(null, () => list.reload())}><Icon name="plus" />Add shop</button>} />} />
          )}</PagedView>
        </div>
      </section>
    </>
  );
}

/* ------------------------------ Shop profile ------------------------------ */
export function ShopDetail() {
  usePageMeta('Shop Profile', 'Shops');
  const { id } = useParams();
  const navigate = useNavigate();
  const [reBusy, setReBusy] = useState(false);
  const { data, error, reload, setData } = useApi(async () => {
    const d = await api('/shops/' + encodeURIComponent(id));
    const dosRows = await api('/inventory/dos', { query: { shop: d.shop.id, days: 30, pageSize: 200 } }).then((x) => x.rows).catch(() => []);
    return { d, dosRows };
  }, [id]);
  if (error && !data) return <ErrorBlock message={error.message} onRetry={reload} />;
  if (!data) return <LoadingBlock />;
  const { d, dosRows } = data;
  const s = d.shop;
  const dosOf = (giftPk) => dosRows.find((x) => x.gift_pk === giftPk);
  const pct = s.allocated ? Math.round((s.distributed / s.allocated) * 100) : 0;

  const allocate = () => navigate(`/admin/inventory/allocate?shop=${s.id}`);
  const edit = () => openShopForm(s, (saved) => (saved && saved.shop_id !== s.shop_id ? navigate('/admin/shops/' + encodeURIComponent(saved.shop_id)) : reload()));
  const downloadQr = () => download(`/shops/${s.id}/qr.png`).then(() => api('/shops/qr/log', { method: 'POST', body: { ids: [s.id], action: 'download' }, quiet: true })).catch(toastError);
  const regenerate = async () => {
    const ok = await confirmDialog({ title: `Regenerate QR for ${s.shop_id}?`, message: 'A fresh QR image is created and logged. The QR still contains only the Shop ID, so labels you already printed keep working.', confirmText: 'Regenerate' });
    if (!ok) return;
    setReBusy(true);
    try {
      const r = await api(`/shops/${s.id}/qr/regenerate`, { method: 'POST' });
      setData((x) => (x ? { ...x, d: { ...x.d, qr: r.qr } } : x));
      toast(`QR regenerated for ${s.shop_id}`, 'ok');
    } catch (ex) { toastError(ex); } finally { setReBusy(false); }
  };
  const toggle = async () => {
    const to = s.status === 'active' ? 'inactive' : 'active';
    const ok = await confirmDialog({
      title: to === 'inactive' ? 'Deactivate shop?' : 'Activate shop?',
      message: to === 'inactive' ? <>Promoters will not be able to submit sales for <b>{s.shop_name}</b> while it is inactive. Stock and history are kept.</> : <>Promoters will be able to submit sales for <b>{s.shop_name}</b> again.</>,
      confirmText: to === 'inactive' ? 'Deactivate' : 'Activate', danger: to === 'inactive',
    });
    if (!ok) return;
    try { await api(`/shops/${s.id}/status`, { method: 'PATCH', body: { status: to } }); toast(`Shop ${to === 'active' ? 'activated' : 'deactivated'}`, 'ok'); reload(); } catch (e) { toastError(e); }
  };

  return (
    <>
      <PageHead title={s.shop_name} desc={<><span className="mono">{s.shop_id}</span> · {s.city_name} · {s.market_name}</>} actions={<>
        <Link className="btn" to="/admin/shops"><Icon name="back" />All shops</Link>
        <button className="btn" id="pToggle" onClick={toggle}>{s.status === 'active' ? 'Deactivate' : 'Activate'}</button>
        <button className="btn" id="pEdit" onClick={edit}><Icon name="edit" />Edit</button>
        <button className="btn primary" id="pAlloc" onClick={allocate}><Icon name="plus" />Allocate gifts</button>
      </>} />
      <div className="grid g-main-side">
        <section className="panel">
          <div className="panel-b profile-head">
            <dl className="dl" style={{ flex: 1 }}>
              <dt>Shop ID</dt><dd className="mono">{s.shop_id}</dd>
              <dt>Shop name</dt><dd>{s.shop_name}</dd>
              <dt>City</dt><dd>{s.city_name}</dd>
              <dt>Market</dt><dd>{s.market_name}</dd>
              <dt>Address</dt><dd>{s.address || '—'}</dd>
              <dt>Promoter</dt><dd>{s.promoter_name ? <>{s.promoter_name} <span className="muted mono">{s.promoter_code}</span></> : <span className="muted">Not assigned</span>}</dd>
              <dt>Status</dt><dd><Chip status={s.status} /></dd>
              <dt>Date added</dt><dd>{fmt.date(s.created_at)}</dd>
            </dl>
            <div className="qr-box"><img src={d.qr} alt={`QR code for ${s.shop_id}`} id="pQrImg" /><div className="mono small" style={{ margin: '4px 0 2px' }}><b>{s.shop_id}</b></div>
              <div className="muted small" style={{ marginBottom: 8 }}>Generated {fmt.date(s.qr_generated_at || s.created_at)}</div>
              <BusyButton className="btn sm block" id="pQr" onClick={downloadQr}><Icon name="download" />Download QR</BusyButton>
              <Link className="btn sm block" style={{ marginTop: 6 }} to={`/admin/shops/qr?ids=${s.id}`}><Icon name="print" />Print label</Link>
              <button className="btn sm block ghost" style={{ marginTop: 6 }} id="pQrRe" disabled={reBusy} onClick={regenerate}>{reBusy ? <span className="spinner" /> : <><Icon name="refresh" />Regenerate</>}</button></div>
          </div>
          <div className="stat-row" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
            <div><div className="v">{fmt.n(s.allocated)}</div><div className="l">Allocated</div></div>
            <div><div className="v">{fmt.n(s.distributed)}</div><div className="l">Gifts given ({pct}%)</div></div>
            <div><div className="v">{fmt.n(s.remaining)}</div><div className="l">Remaining</div></div>
          </div>
        </section>
        <section className="panel"><div className="panel-h"><h2>Recent transactions</h2><Link className="btn sm" style={{ marginLeft: 'auto' }} to={`/admin/reports/gifts?shop=${s.id}`}>View all</Link></div>
          {d.transactions.length ? (
            <div className="table-wrap"><table className="tbl compact"><tbody>{d.transactions.slice(0, 10).map((t) => (
              <tr key={t.transaction_id} className="clickable" onClick={() => openTransaction(t.transaction_id, reload)}><td><div className="cell-main mono">{t.transaction_id}</div><div className="cell-sub">{t.brand_name ? `${t.brand_name} ${t.model_name} × ${t.mobile_qty ?? '—'} · ` : ''}{t.gift_name} × {t.quantity} · {fmt.dt(t.created_at)}</div></td>
                <td className="num"><b>{t.mobile_qty === null ? '—' : fmt.n(t.mobile_qty)}</b></td><td><Chip status={t.status} /></td></tr>
            ))}</tbody></table></div>
          ) : <EmptyState title="No transactions yet" text="Sales recorded by the promoter will appear here." />}
        </section>
      </div>

      <section className="panel" style={{ marginTop: 16 }}><div className="panel-h"><h2>Mobile sales at this shop</h2><span className="sub">All time · {fmt.n(d.sales.summary.units)} units · {fmt.n(d.sales.summary.gifts)} gifts · ratio {ratio(d.sales.summary.ratio)}</span>
        <Link className="btn sm" style={{ marginLeft: 'auto' }} to={`/admin/sales?shop=${s.id}`}>All sales</Link></div>
        {d.sales.brands.length ? (
          <div className="table-wrap"><table className="tbl compact"><thead><tr><th>Brand</th><th>Model</th><th className="num">Units sold</th><th className="num">Gifts given</th><th className="num">Ratio</th></tr></thead>
            <tbody>{d.sales.brands.map((b, bi) => b.models.map((m, i) => (
              <tr key={`${bi}-${i}`}><td>{i === 0 ? <b>{b.brand_name}</b> : ''}</td><td>{m.model_name} <span className="muted mono small">{m.item_code || ''}</span></td><td className="num"><b>{fmt.n(m.units)}</b></td><td className="num">{fmt.n(m.gifts)}</td><td className="num">{ratio(m.ratio)}</td></tr>
            )))}</tbody>
            <tfoot><tr><td>Total</td><td /><td className="num">{fmt.n(d.sales.summary.units)}</td><td className="num">{fmt.n(d.sales.summary.gifts)}</td><td className="num">{ratio(d.sales.summary.ratio)}</td></tr></tfoot></table></div>
        ) : <EmptyState title="No mobile sales yet" text="" />}
      </section>

      <section className="panel" style={{ marginTop: 16 }}><div className="panel-h"><h2>Gift inventory</h2><span className="sub">Remaining = Allocated − Given · DOS = Remaining ÷ avg given per day (last 30 days)</span>
        <button className="btn sm" style={{ marginLeft: 'auto' }} id="pAdj" onClick={() => openAdjustDialog({ shop: s, inventory: d.inventory }, reload)}><Icon name="adjust" />Adjust stock</button></div>
        {d.inventory.length ? (
          <div className="table-wrap"><table className="tbl"><thead><tr><th>Gift</th><th className="num">Allocated</th><th className="num">Given</th><th className="num">Remaining</th><th className="num">Sold 30d</th><th className="num">DOS</th><th>DOS status</th><th>Used</th><th>Last update</th></tr></thead>
            <tbody>{d.inventory.map((i, k) => {
              const x = dosOf(i.gift_pk);
              return (
                <tr key={i.id ?? k}><td><span className="cell-main">{i.gift_name}</span> <span className="muted mono">{i.gift_id}</span>{i.gift_status !== 'active' ? <> <span className="chip inactive">inactive</span></> : null}</td>
                  <td className="num">{fmt.n(i.allocated)}</td><td className="num">{fmt.n(i.distributed)}</td>
                  <td className="num"><StockCell remaining={i.remaining} allocated={i.allocated} /></td>
                  {x ? <><td className="num">{fmt.n(x.sold)}</td><td className="num">{dosNum(x)}</td><td>{dosChip(x)}</td></> : <><td className="num muted">—</td><td className="num muted">—</td><td className="muted small">Inactive</td></>}
                  <td><span className="meter"><i style={{ width: `${i.allocated ? Math.round((i.distributed / i.allocated) * 100) : 0}%` }} /></span></td>
                  <td className="muted nowrap">{fmt.dt(i.updated_at)}</td></tr>
              );
            })}</tbody>
            <tfoot><tr><td>Total</td><td className="num">{fmt.n(s.allocated)}</td><td className="num">{fmt.n(s.distributed)}</td><td className="num">{fmt.n(s.pending)}</td><td className="num">{fmt.n(s.remaining)}</td><td className="num">{fmt.n(s.allocated - s.distributed - s.pending)}</td><td className="num">{fmt.n(dosRows.reduce((a, r) => a + r.sold, 0))}</td><td /><td /><td /><td /></tr></tfoot>
          </table></div>
        ) : <EmptyState title="No gifts allocated" text="Allocate gifts so the promoter can distribute them at this shop." action={<button className="btn primary" id="pAlloc2" onClick={allocate}><Icon name="plus" />Allocate gifts</button>} />}
      </section>

      <section className="panel" style={{ marginTop: 16 }}><div className="panel-h"><h2>Stock movements</h2><span className="sub">Allocations and adjustments (audit trail)</span></div>
        {d.movements.length ? (
          <div className="table-wrap"><table className="tbl compact"><thead><tr><th>Date</th><th>Type</th><th>Gift</th><th className="num">Qty</th><th className="num">Before → After</th><th>Reason</th><th>By</th></tr></thead>
            <tbody>{d.movements.map((mv, k) => (
              <tr key={mv.id ?? k}><td className="nowrap">{fmt.dt(mv.created_at)}</td><td>{movementTag(mv.type)}</td><td>{mv.gift_name}</td>
                <td className="num">{mv.type === 'adjustment_out' ? '−' : '+'}{fmt.n(mv.quantity)}</td><td className="num">{fmt.n(mv.before_qty)} → {fmt.n(mv.after_qty)}</td><td>{mv.reason || '—'}</td><td>{mv.user_name || '—'}</td></tr>
            ))}</tbody></table></div>
        ) : <EmptyState title="No movements" text="" />}
      </section>
    </>
  );
}

/* ------------------------------ QR sheet ------------------------------ */
export function ShopQrSheet() {
  usePageMeta('Shop QR Codes', 'Shops');
  useHoldLive();
  const loc = useLocation();
  // a new query (e.g. "Show all") starts the page again, like the original route dispatch
  return <QrSheet key={loc.search} />;
}

function QrSheet() {
  const [query] = useSearchParams();
  const { lk } = useLookups();
  const [state, setState] = useState(() => ({ city_id: query.get('city_id') || '', market_id: '', promoter_id: '', status: 'active', ids: query.get('ids') || '' }));
  const [unselected, setUnselected] = useState(() => new Set());
  const [allOn, setAllOn] = useState(true);
  const stateKey = JSON.stringify(state);
  const { data: rows, error, reload, setData } = useApi(() => api('/shops/qr-sheet', { query: state }), [stateKey]);
  useEffect(() => { setUnselected(new Set()); }, [stateKey]);

  const setK = (patch) => setState((x) => ({ ...x, ...patch }));
  const toggleOne = (id, on) => setUnselected((u) => { const n = new Set(u); if (on) n.delete(id); else n.add(id); return n; });
  const toggleAll = (on) => { setAllOn(on); setUnselected(on ? new Set() : new Set((rows || []).map((r) => r.id))); };

  const downloadOne = (id) => download(`/shops/${id}/qr.png`).then(() => api('/shops/qr/log', { method: 'POST', body: { ids: [Number(id)], action: 'download' }, quiet: true })).catch(toastError);
  const regenerateOne = async (id) => {
    try {
      const r = await api(`/shops/${id}/qr/regenerate`, { method: 'POST' });
      setData((list) => (list ? list.map((x) => (x.id === id ? { ...x, qr: r.qr } : x)) : list));
      toast(`QR regenerated for ${r.shop_id}`, 'ok');
    } catch (ex) { toastError(ex); }
  };
  const print = () => {
    const ids = (rows || []).filter((r) => !unselected.has(r.id)).map((r) => Number(r.id));
    if (!ids.length) return toast('Select at least one label', 'warn');
    api('/shops/qr/log', { method: 'POST', body: { ids, action: 'print' }, quiet: true }).catch(() => {});
    window.print();
    return undefined;
  };

  let grid;
  if (error && rows === undefined) grid = <ErrorBlock message={error.message} onRetry={reload} />;
  else if (rows === undefined) grid = <LoadingBlock text="Generating QR codes…" />;
  else if (!rows.length) grid = <EmptyState title="No shops" text="No shops match these filters." />;
  else {
    grid = (
      <div className="qr-sheet">{rows.map((r) => (
        <div key={r.id} className={`qr-label${unselected.has(r.id) ? ' unselected' : ''}`} data-id={r.id}>
          <input type="checkbox" checked={!unselected.has(r.id)} onChange={(e) => toggleOne(r.id, e.target.checked)} aria-label={`Include ${r.shop_id}`} />
          <div className="hdr">Scan to record sale</div>
          <img src={r.qr} alt={`QR ${r.shop_id}`} />
          <div className="code">{r.shop_id}</div><div className="name">{r.shop_name}</div><div className="loc">{r.market_name}, {r.city_name}</div>
          <div className="row no-print" style={{ justifyContent: 'center', gap: 4, marginTop: 8 }}>
            <BusyButton className="btn sm" onClick={() => downloadOne(r.id)}><Icon name="download" />PNG</BusyButton>
            <BusyButton className="btn sm ghost" title="Regenerate" onClick={() => regenerateOne(r.id)}><Icon name="refresh" /></BusyButton>
          </div>
        </div>
      ))}</div>
    );
  }

  return (
    <>
      <PageHead title="Shop QR Codes" desc="Generate, download, print or regenerate QR labels. Each QR code contains only the Shop ID — no other information."
        actions={<button className="btn primary" id="qrPrint" onClick={print}><Icon name="print" />Print selected</button>} />
      <section className="panel">
        <div className="filters no-print" id="qrFilters">
          {state.ids ? <><span className="tag">Showing selected shops</span><Link className="link-btn" to="/admin/shops/qr">Show all</Link></> : <>
            <select className="select" id="qCity" value={state.city_id} onChange={(e) => setK({ city_id: e.target.value, market_id: '' })}>{cityOpts(lk)}</select>
            <select className="select" id="qMarket" value={state.market_id} onChange={(e) => setK({ market_id: e.target.value })}>{marketOpts(lk, state.city_id)}</select>
            <select className="select" value={state.promoter_id} onChange={(e) => setK({ promoter_id: e.target.value })}>{promoterOpts(lk)}</select>
            <select className="select" value={state.status} onChange={(e) => setK({ status: e.target.value })}><option value="active">Active shops</option><option value="">All shops</option><option value="inactive">Inactive shops</option></select>
          </>}
          <span className="spacer" /><label className="row small"><input type="checkbox" id="qAll" checked={allOn} onChange={(e) => toggleAll(e.target.checked)} /> Select all</label>
        </div>
        <div id="qrGrid">{grid}</div>
      </section>
    </>
  );
}
