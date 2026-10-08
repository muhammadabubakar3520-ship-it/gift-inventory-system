/* Gift inventory: shop inventory list, allocate gifts, adjustments / movements (from pages-inventory.js). */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import DataTable from '../../components/DataTable';
import BusyButton from '../../components/BusyButton';
import { StockCell, EmptyState, PageHead, SearchBox, LoadingBlock, ErrorBlock } from '../../components/ui';
import { Modal, openModal } from '../../components/Modal';
import { toast, toastError } from '../../components/Toasts';
import { cityOpts, marketOpts, promoterOpts, giftOpts, opts } from '../../components/admin/options';
import { openAdjustDialog, ShopPicker } from '../../components/admin/inventory-widgets';
import { movementTag } from '../../components/admin/shop-widgets';
import usePaged, { PagedView } from '../../hooks/usePaged';
import { api, download } from '../../services/api';
import { fmt } from '../../utils/format';
import { pendingAllocation } from '../../utils/admin';
import { usePageMeta } from '../../context/PageMetaContext';
import { useLookups } from '../../context/LookupsContext';
import { useHoldLive, useSync } from '../../context/SyncContext';

/* ------------------------------ Shop inventory ------------------------------ */
export function InventoryList() {
  const [sp] = useSearchParams();
  return <InventoryListPage key={sp.toString()} query={Object.fromEntries(sp)} />;
}

function InventoryListPage({ query }) {
  usePageMeta('Gift Inventory', 'Gifts');
  const navigate = useNavigate();
  const { lk } = useLookups();
  const list = usePaged({
    initial: { search: query.search || '', city_id: '', market_id: '', promoter_id: '', gift_id: query.gift || '', stock: '', sort: 'shop_id', dir: 'asc' },
    fetch: (st) => api('/inventory', { query: st }),
  });
  const st = list.state;
  const d = list.data;
  const t = d && d.totals;

  const adjust = (r) => openAdjustDialog({
    shop: { id: r.shop_pk, shop_id: r.shop_id, shop_name: r.shop_name },
    inventory: [{ gift_pk: r.gift_pk, gift_name: r.gift_name, allocated: r.allocated, distributed: r.distributed, pending: r.pending, remaining: r.remaining, available: r.available }],
    giftPk: r.gift_pk,
  }, () => list.reload());

  const cols = [
    { label: 'Shop ID', sort: 'shop_id', render: (r) => <Link className="mono" to={`/admin/shops/${r.shop_id}`}><b>{r.shop_id}</b></Link> },
    { label: 'Shop', render: (r) => <><div className="cell-main">{r.shop_name}{r.shop_status !== 'active' ? <> <span className="chip inactive">inactive</span></> : null}</div><div className="cell-sub">{r.market_name}, {r.city_name}</div></> },
    { label: 'Promoter', render: (r) => r.promoter_name || <span className="muted">—</span> },
    { label: 'Gift', sort: 'gift', render: (r) => <span className="cell-main">{r.gift_name}</span> },
    { label: 'Allocated', num: true, key: 'allocated', sort: 'allocated' },
    { label: 'Given', num: true, key: 'distributed', sort: 'distributed' },
    { label: 'Remaining', num: true, sort: 'remaining', render: (r) => <StockCell remaining={r.remaining} allocated={r.allocated} /> },
    { label: '', cls: 'actions', render: (r) => <><button className="btn sm" onClick={() => adjust(r)}>Adjust</button> <button className="btn sm" onClick={() => navigate(`/admin/inventory/allocate?shop=${r.shop_pk}&gift=${r.gift_pk}`)}>+ Allocate</button></> },
  ];

  return (
    <>
      <PageHead title="Gift Inventory" desc="Shop-wise gift stock. Remaining = Allocated − Given. Gifts are deducted as soon as a promoter submits a sale. Stock never goes below zero." actions={<>
        <BusyButton className="btn" id="iExport" onClick={() => download('/inventory/export.csv', list.state).catch(toastError)}><Icon name="download" />Export</BusyButton>
        <Link className="btn" to="/admin/import/inventory"><Icon name="upload" />Upload inventory (Excel)</Link>
        <Link className="btn" to="/admin/inventory/adjustments"><Icon name="adjust" />Adjustments</Link>
        <Link className="btn primary" to="/admin/inventory/allocate"><Icon name="plus" />Allocate gifts</Link>
      </>} />
      <div className="kpis" id="iTotals" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 16 }}>
        {t ? <>
          <div className="kpi"><div className="k-label">Allocated (filtered)</div><div className="k-value">{fmt.n(t.allocated)}</div><div className="k-sub">{fmt.n(d.total)} shop-gift lines</div></div>
          <div className="kpi"><div className="k-label">Given</div><div className="k-value">{fmt.n(t.distributed)}</div><div className="k-sub">{t.allocated ? Math.round(t.distributed / t.allocated * 100) : 0}% used</div></div>
          <div className="kpi"><div className="k-label">Remaining</div><div className="k-value">{fmt.n(t.allocated - t.distributed)}</div><div className="k-sub">In shops now</div></div>
        </> : null}
      </div>
      <section className="panel">
        <div className="filters" id="iFilters">
          <SearchBox value={st.search} onChange={(v) => list.set({ search: v })} placeholder="Search Shop ID or name" />
          <select className="select" id="iCity" value={st.city_id} onChange={(e) => list.set({ city_id: e.target.value, market_id: '' })}>{cityOpts(lk)}</select>
          <select className="select" id="iMarket" value={st.market_id} onChange={(e) => list.set({ market_id: e.target.value })}>{marketOpts(lk, st.city_id)}</select>
          <select className="select" value={st.promoter_id} onChange={(e) => list.set({ promoter_id: e.target.value })}>{promoterOpts(lk)}</select>
          <select className="select" value={st.gift_id} onChange={(e) => list.set({ gift_id: e.target.value })}>{giftOpts(lk)}</select>
          <select className="select" value={st.stock} onChange={(e) => list.set({ stock: e.target.value })}><option value="">All stock levels</option><option value="in">In stock</option><option value="low">Low (≤ 20% left)</option><option value="out">Out of stock</option></select>
        </div>
        <div id="iList">
          <PagedView list={list}>{(data, s) => (
            <DataTable cols={cols} rows={data.rows} sort={s.sort} dir={s.dir} onSort={list.sortBy}
              empty={<EmptyState title="No inventory found" text="Allocate gifts to shops to see stock here." action={<Link className="btn primary" to="/admin/inventory/allocate">Allocate gifts</Link>} />} />
          )}</PagedView>
        </div>
      </section>
    </>
  );
}

/* ------------------------------ Allocate ------------------------------ */
/** Add (or merge into an existing shop × gift line) — returns a new lines array. */
function mergeLines(prev, items, seq) {
  const out = prev.map((l) => ({ ...l }));
  for (const { shop, giftId, qty } of items) {
    const existing = out.find((l) => l.shop.id === shop.id && String(l.gift_id) === String(giftId));
    if (existing) existing.quantity += qty;
    else out.push({ key: ++seq.current, shop, gift_id: Number(giftId), quantity: qty });
  }
  return out;
}

/** Quantity cell: applied on the input's native "change" event (blur / Enter / arrows), like the original. */
function LineQty({ line, onCommit }) {
  const ref = useRef(null);
  const cb = useRef(onCommit);
  cb.current = onCommit;
  useEffect(() => {
    const el = ref.current;
    const h = () => cb.current(el);
    el.addEventListener('change', h);
    return () => el.removeEventListener('change', h);
  }, []);
  useEffect(() => { if (ref.current) ref.current.value = line.quantity; }, [line.quantity]);
  return <input ref={ref} className="input sm" type="number" min="1" step="1" defaultValue={line.quantity} data-q={line.key} style={{ textAlign: 'right' }} />;
}

export function Allocate() {
  const [sp] = useSearchParams();
  return <AllocatePage key={sp.toString()} query={Object.fromEntries(sp)} />;
}

function AllocatePage({ query }) {
  usePageMeta('Allocate Gifts', 'Gifts');
  useHoldLive();
  const { lk, loadLookups } = useLookups();
  const { reloadPage } = useSync();
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState(null);
  const [lines, setLines] = useState([]); // { key, shop: {id, shop_id, shop_name, ...}, gift_id, quantity }
  const seq = useRef(0);
  const [pickedShop, setPickedShop] = useState(null);
  const [pickerText, setPickerText] = useState(undefined);
  const [giftSel, setGiftSel] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const qtyRef = useRef(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      let l;
      try { l = await loadLookups(); } catch (e) { setErr(e); toastError(e); return; }
      const active = l.gifts.filter((g) => g.status === 'active');
      setGiftSel(query.gift && active.some((g) => String(g.id) === String(query.gift)) ? String(query.gift) : '');
      const pend = pendingAllocation.lines;
      if (pend && pend.length) {
        setLines((prev) => mergeLines(prev, pend.map((x) => ({ shop: x.shop, giftId: x.gift_id, qty: x.quantity })), seq));
        setNote(pendingAllocation.note || '');
        toast(`${pend.length} refill line(s) added from Gift DOS. Check quantities, then save.`, 'ok', 6000);
        pendingAllocation.lines = null; pendingAllocation.note = null;
      }
      setReady(true);
      if (query.shop) {
        try {
          const { shop } = await api('/shops/' + query.shop);
          setPickedShop(shop);
          setPickerText(`${shop.shop_id} · ${shop.shop_name}`);
        } catch (_) { /* ignore */ }
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <ErrorBlock message={err.message} onRetry={reloadPage} />;
  if (!ready) return <LoadingBlock />;

  const gifts = lk.gifts.filter((g) => g.status === 'active');
  const giftById = (id) => lk.gifts.find((g) => String(g.id) === String(id));
  const addLines = (items) => setLines((prev) => mergeLines(prev, items, seq));

  const add = () => {
    const gid = giftSel;
    const q = parseInt(qty, 10);
    if (!pickedShop) return toast('Pick a shop', 'warn');
    if (pickedShop.status && pickedShop.status !== 'active') return toast('This shop is inactive', 'warn');
    if (!gid) return toast('Select a gift', 'warn');
    if (!(q > 0)) return toast('Enter a quantity of at least 1', 'warn');
    addLines([{ shop: pickedShop, giftId: gid, qty: q }]);
    setQty('');
    return undefined;
  };
  const commitQty = (l) => (inp) => {
    const v = parseInt(inp.value, 10);
    if (!(v > 0)) { inp.value = l.quantity; return toast('Quantity must be at least 1', 'warn'); }
    setLines((prev) => prev.map((x) => (x.key === l.key ? { ...x, quantity: v } : x)));
    return undefined;
  };
  const save = async () => {
    if (!lines.length) return toast('Add at least one line', 'warn');
    try {
      const r = await api('/inventory/allocate', { method: 'POST', body: { reason: note, lines: lines.map((l) => ({ shop_id: l.shop.id, gift_id: l.gift_id, quantity: l.quantity })) } });
      toast(`Allocated ${fmt.n(r.quantity)} units across ${r.lines} line(s)`, 'ok', 6000);
      setLines([]);
      await loadLookups();
      reloadPage();
    } catch (ex) { toastError(ex); }
    return undefined;
  };

  // warehouse check
  const per = {};
  for (const l of lines) per[l.gift_id] = (per[l.gift_id] || 0) + l.quantity;
  const over = Object.entries(per).some(([gid, q]) => { const g = giftById(gid); return g ? q > g.unallocated : false; });

  return (
    <>
      <PageHead title="Allocate Gifts" desc="Move gifts from the central warehouse to shops. All lines are saved together, or none if any line fails."
        actions={<Link className="btn" to="/admin/inventory"><Icon name="back" />Shop inventory</Link>} />
      <div className="grid g-main-side">
        <section className="panel">
          <div className="panel-h"><h2>Allocation lines</h2><span className="sub" id="aCount">{lines.length ? `${lines.length} line(s) · ${fmt.n(lines.reduce((a, l) => a + l.quantity, 0))} units` : ''}</span>
            <div style={{ marginLeft: 'auto' }} className="row">
              <button className="btn sm" id="aBulk" onClick={() => openModal((close) => <BulkModal gifts={gifts} onClose={close} onAdd={addLines} />)}><Icon name="list" />Add many shops</button>
              <button className="btn sm" id="aClear" onClick={() => setLines([])}>Clear</button></div></div>
          <div className="panel-b" style={{ borderBottom: '1px solid var(--line)' }}>
            <div className="row wrap" style={{ alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: 2, minWidth: 220 }}><label>Shop</label>
                <ShopPicker id="aShop" value={pickerText} onPick={(s) => { setPickedShop(s); if (qtyRef.current) qtyRef.current.focus(); }} /></div>
              <div className="field" style={{ flex: 1.2, minWidth: 160 }}><label>Gift</label>
                <select className="select" id="aGift" value={giftSel} onChange={(e) => setGiftSel(e.target.value)}>{opts(gifts, { label: (g) => `${g.gift_name} (${fmt.n(g.unallocated)} in warehouse)`, placeholder: 'Select gift' })}</select></div>
              <div className="field" style={{ width: 110 }}><label>Quantity</label>
                <input className="input" type="number" min="1" step="1" id="aQty" ref={qtyRef} value={qty} onChange={(e) => setQty(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} /></div>
              <button className="btn primary" id="aAdd" onClick={add}><Icon name="plus" />Add line</button>
            </div>
          </div>
          <div id="aLines">{lines.length ? (
            <div className="table-wrap alloc-lines"><table className="tbl compact"><thead><tr><th>Shop</th><th>Gift</th><th className="num" style={{ width: 120 }}>Quantity</th><th></th></tr></thead>
              <tbody>{lines.map((l) => (
                <tr key={l.key}><td><b className="mono">{l.shop.shop_id}</b> {l.shop.shop_name}<div className="cell-sub">{l.shop.market_name || ''}{l.shop.city_name ? ', ' + l.shop.city_name : ''}</div></td>
                  <td>{(giftById(l.gift_id) || {}).gift_name}</td>
                  <td className="num"><LineQty line={l} onCommit={commitQty(l)} /></td>
                  <td className="actions"><button className="btn sm ghost" data-rm={l.key} aria-label="Remove" onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}><Icon name="x" /></button></td></tr>
              ))}</tbody></table></div>
          ) : <EmptyState title="No lines yet" text={'Pick a shop, gift and quantity, then click "Add line". Use "Add many shops" to allocate one gift to a whole city or market.'} />}</div>
          <div className="panel-f"><input className="input" id="aNote" placeholder="Note (optional) e.g. October campaign allocation" maxLength={200} style={{ flex: 1 }} value={note} onChange={(e) => setNote(e.target.value)} />
            <BusyButton className="btn primary" id="aSave" busyText="Saving…" onClick={save}>Save allocation</BusyButton></div>
        </section>
        <section className="panel"><div className="panel-h"><h2>Warehouse check</h2><span className="sub">Unallocated stock after these lines</span></div>
          <div id="aStock">
            <div className="table-wrap"><table className="tbl compact"><thead><tr><th>Gift</th><th className="num">Warehouse</th><th className="num">This allocation</th><th className="num">After</th></tr></thead>
              <tbody>{gifts.map((g) => {
                const use = per[g.id] || 0; const after = g.unallocated - use;
                return (
                  <tr key={g.id}><td>{g.gift_name}</td><td className="num">{fmt.n(g.unallocated)}</td><td className="num">{use ? fmt.n(use) : '—'}</td>
                    <td className="num"><span className={`stock ${after < 0 ? 'out' : ''}`}>{fmt.n(after)}</span></td></tr>
                );
              })}</tbody></table></div>
            {over && <div className="panel-b"><div className="callout bad">Some lines exceed warehouse stock. Reduce quantities or receive more stock first.</div></div>}
          </div>
        </section>
      </div>
    </>
  );
}

function BulkModal({ gifts, onClose, onAdd }) {
  const { lk } = useLookups();
  const [city, setCity] = useState('');
  const [market, setMarket] = useState('');
  const [prom, setProm] = useState('');
  const [gift, setGift] = useState('');
  const [qty, setQty] = useState('');
  const [info, setInfo] = useState(null); // { total, qty }
  const matched = useRef([]);
  const cur = useRef({});
  cur.current = { city, market, prom, qty };
  const seq = useRef(0);
  const timer = useRef(null);

  const count = async () => {
    const my = ++seq.current;
    const c = cur.current;
    try {
      const d = await api('/shops', { query: { status: 'active', city_id: c.city, market_id: c.market, promoter_id: c.prom, pageSize: 200 }, quiet: true });
      if (my !== seq.current) return;
      matched.current = d.rows;
      setInfo({ total: d.total, qty: parseInt(cur.current.qty, 10) || 0 });
    } catch (e) { toastError(e); }
  };
  useEffect(() => { count(); }, [city, market, prom]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(timer.current), []);

  const go = () => {
    const q = parseInt(qty, 10);
    if (!gift) return toast('Select a gift', 'warn');
    if (!(q > 0)) return toast('Enter a quantity per shop', 'warn');
    if (!matched.current.length) return toast('No shops match', 'warn');
    const m = matched.current;
    onAdd(m.map((s) => ({ shop: s, giftId: gift, qty: q })));
    onClose();
    toast(`${m.length} line(s) added`, 'ok');
    return undefined;
  };

  return (
    <Modal title="Add many shops" size="wide" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" id="bkGo" onClick={go}>Add lines</button></>}>
      <div className="stack" id="bkForm">
        <div className="callout">Adds one line per matching active shop, all with the same gift and quantity.</div>
        <div className="form-grid">
          <div className="field"><label>City</label><select className="select" id="bkCity" value={city} onChange={(e) => { setCity(e.target.value); setMarket(''); }}>{cityOpts(lk, 'All cities')}</select></div>
          <div className="field"><label>Market</label><select className="select" id="bkMarket" value={market} onChange={(e) => setMarket(e.target.value)}>{marketOpts(lk, city, 'All markets')}</select></div>
          <div className="field"><label>Promoter</label><select className="select" id="bkProm" value={prom} onChange={(e) => setProm(e.target.value)}>{promoterOpts(lk, 'Any promoter')}</select></div>
          <div className="field"><label>Gift <span className="req">*</span></label><select className="select" id="bkGift" value={gift} onChange={(e) => setGift(e.target.value)}>{opts(gifts, { label: (g) => `${g.gift_name} (${fmt.n(g.unallocated)})`, placeholder: 'Select gift' })}</select></div>
          <div className="field"><label>Quantity per shop <span className="req">*</span></label><input className="input" type="number" min="1" id="bkQty" value={qty}
            onChange={(e) => { setQty(e.target.value); cur.current.qty = e.target.value; clearTimeout(timer.current); timer.current = setTimeout(count, 250); }} /></div>
        </div>
        <div id="bkInfo" className="muted small">{info ? <>
          <b>{fmt.n(info.total)}</b> active shop(s) match{info.total > 200 ? ' — only the first 200 will be added; narrow the filter' : ''}.{info.qty ? <> Total: <b>{fmt.n(Math.min(info.total, 200) * info.qty)}</b> units.</> : null}
        </> : null}</div>
      </div>
    </Modal>
  );
}

/* ------------------------------ Adjustments / movements ------------------------------ */
export function Adjustments() {
  usePageMeta('Inventory Adjustments', 'Gifts');
  const { lk } = useLookups();
  const list = usePaged({ initial: { search: '', type: 'adjustment', gift_id: '' }, fetch: (st) => api('/inventory/movements', { query: st }) });
  const st = list.state;
  const cols = [
    { label: 'Date / time', render: (m) => <span className="nowrap">{fmt.dt(m.created_at)}</span> },
    { label: 'Type', render: (m) => movementTag(m.type) },
    { label: 'Shop', render: (m) => <><Link className="mono" to={`/admin/shops/${m.shop_id}`}><b>{m.shop_id}</b></Link> {m.shop_name}</> },
    { label: 'Gift', key: 'gift_name' },
    { label: 'Qty', num: true, render: (m) => `${m.type === 'adjustment_out' ? '−' : '+'}${fmt.n(m.quantity)}` },
    { label: 'Allocated before → after', num: true, render: (m) => `${fmt.n(m.before_qty)} → ${fmt.n(m.after_qty)}` },
    { label: 'Reason', render: (m) => m.reason || <span className="muted">—</span> },
    { label: 'By', render: (m) => m.user_name || '—' },
  ];
  return (
    <>
      <PageHead title="Inventory Adjustments" desc="Manual stock corrections and full movement history (audit trail)." actions={<>
        <BusyButton className="btn" id="mExport" onClick={() => download('/inventory/movements/export.csv', list.state).catch(toastError)}><Icon name="download" />Export</BusyButton>
        <button className="btn primary" id="mNew" onClick={() => openAdjustDialog({}, () => list.reload())}><Icon name="adjust" />New adjustment</button>
      </>} />
      <section className="panel">
        <div className="filters" id="mFilters">
          <SearchBox value={st.search} onChange={(v) => list.set({ search: v })} placeholder="Search shop or reason" />
          <select className="select" value={st.type} onChange={(e) => list.set({ type: e.target.value })}><option value="adjustment">Adjustments only</option><option value="">All movements</option><option value="allocation">Allocations</option><option value="adjustment_in">Adjust + (added)</option><option value="adjustment_out">Adjust − (removed)</option></select>
          <select className="select" value={st.gift_id} onChange={(e) => list.set({ gift_id: e.target.value })}>{giftOpts(lk)}</select>
        </div>
        <div id="mList">
          <PagedView list={list}>{(d) => (
            <DataTable rows={d.rows} cols={cols} empty={<EmptyState title="No adjustments yet" text="Stock corrections you make will be listed here." />} />
          )}</PagedView>
        </div>
      </section>
    </>
  );
}
