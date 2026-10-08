/* Shop picker (typeahead) and inventory adjustment dialog (from pages-inventory.js: Admin.shopPicker, Admin.adjustDialog). */
import { useEffect, useRef, useState } from 'react';
import { Modal, openModal, confirmDialog } from '../Modal';
import BusyButton from '../BusyButton';
import { toast, toastError } from '../Toasts';
import { api } from '../../services/api';
import { fmt } from '../../utils/format';
import { useLookups } from '../../context/LookupsContext';
import { opts } from './options';

/**
 * Typeahead for active shops. <ShopPicker onPick={(shop) => …} placeholder value id />
 * `value` sets the text shown in the input (e.g. a preselected shop).
 */
export function ShopPicker({ onPick, placeholder = 'Search Shop ID or name', value, id, inputRef }) {
  const [text, setText] = useState(value || '');
  const [rows, setRows] = useState([]);
  const [idx, setIdx] = useState(-1);
  const [open, setOpen] = useState(false);
  const textRef = useRef(text);
  const timer = useRef(null);
  const blurT = useRef(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  useEffect(() => { if (value !== undefined) { setText(value || ''); textRef.current = value || ''; } }, [value]);
  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(blurT.current); }, []);

  const search = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const r = (await api('/shops', { query: { search: textRef.current.trim(), pageSize: 8, status: 'active' }, quiet: true })).rows;
        setRows(r); setIdx(-1); setOpen(true);
      } catch (e) { toastError(e); }
    }, 220);
  };
  const pick = (s) => {
    const t = `${s.shop_id} · ${s.shop_name}`;
    setText(t); textRef.current = t; setOpen(false);
    onPickRef.current && onPickRef.current(s);
  };
  const onKeyDown = (e) => {
    if (!open) return;
    if (e.key === 'ArrowDown') { setIdx((i) => Math.min(rows.length - 1, i + 1)); e.preventDefault(); }
    if (e.key === 'ArrowUp') { setIdx((i) => Math.max(0, i - 1)); e.preventDefault(); }
    if (e.key === 'Enter' && rows[idx]) { pick(rows[idx]); e.preventDefault(); }
  };
  return (
    <div className="picker" id={id}>
      <input className="input" ref={inputRef} placeholder={placeholder} value={text} autoComplete="off"
        onChange={(e) => { setText(e.target.value); textRef.current = e.target.value; search(); }}
        onFocus={() => { if (!textRef.current) search(); else if (rows.length) setOpen(true); }}
        onBlur={() => { clearTimeout(blurT.current); blurT.current = setTimeout(() => setOpen(false), 120); }}
        onKeyDown={onKeyDown} />
      <div className={`picker-list ${open ? '' : 'hidden'}`}>
        {rows.length ? rows.map((s, i) => (
          <button type="button" key={s.id} className={i === idx ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); pick(s); }}>
            <b className="mono">{s.shop_id}</b> · {s.shop_name}<div className="muted small">{s.market_name}, {s.city_name}{s.status !== 'active' ? ' · inactive' : ''}</div>
          </button>
        )) : <div className="empty-pick">No matching shops</div>}
      </div>
    </div>
  );
}

const REASONS = ['Damaged', 'Lost / missing', 'Returned to warehouse', 'Stock count correction', 'Transferred to another shop', 'Additional stock'];

/** ctx: { shop?: {id, shop_id, shop_name}, inventory?: [...], giftPk? } */
function AdjustModal({ ctx, onClose, onDone }) {
  const { lk, lkRef, loadLookups } = useLookups();
  const [shop, setShop] = useState(ctx.shop || null);
  const [inventory, setInventory] = useState(ctx.inventory || null);
  const [dir, setDir] = useState(-1);
  const [qty, setQty] = useState('');
  const [reasonSel, setReasonSel] = useState(REASONS[0]);
  const [other, setOther] = useState('');
  // gift <select>: options are rebuilt (and the selection reset) like the original fillGifts()
  const build = (inv, d, sh) => {
    const o = (inv || []).map((i) => ({ id: i.gift_pk, label: `${i.gift_name} — allocated ${fmt.n(i.allocated)}, available ${fmt.n(i.available)}` }));
    const extra = d > 0 ? lkRef.current.gifts.filter((g) => g.status === 'active' && !o.some((x) => x.id === g.id)).map((g) => ({ id: g.id, label: `${g.gift_name} — not yet allocated` })) : [];
    const list = [...o, ...extra];
    const sel = ctx.giftPk !== undefined && ctx.giftPk !== null && list.some((x) => String(x.id) === String(ctx.giftPk)) ? String(ctx.giftPk) : '';
    return { list, placeholder: sh ? 'Select gift' : 'Pick a shop first', sel };
  };
  const [fill, setFill] = useState(() => build(ctx.inventory || null, -1, ctx.shop || null));
  const [gift, setGift] = useState(fill.sel);
  const refill = (inv, d, sh) => { const f = build(inv, d, sh); setFill(f); setGift(f.sel); };

  // keep the latest direction for the async handlers (the original fillGifts() reads the current direction)
  const dirRef = useRef(dir);
  dirRef.current = dir;
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const inv0 = ctx.inventory;
    if (ctx.shop && (!inv0 || (inv0.length === 1 && ctx.giftPk))) {
      api('/shops/' + ctx.shop.id, { quiet: true }).then((d) => { setInventory(d.inventory); refill(d.inventory, dirRef.current, ctx.shop); }).catch(toastError);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onPick = async (s) => {
    setShop(s);
    try {
      const inv = (await api('/shops/' + s.id)).inventory;
      setInventory(inv); refill(inv, dirRef.current, s);
    } catch (e) { toastError(e); }
  };
  const setDirection = (d) => { setDir(d); refill(inventory, d, shop); };

  const i = (inventory || []).find((x) => String(x.gift_pk) === gift);
  const g = lk.gifts.find((x) => String(x.id) === gift);

  const save = async () => {
    const q = parseInt(qty, 10);
    let reason = reasonSel;
    if (reason === '__other') reason = other.trim();
    if (!shop) return toast('Pick a shop', 'warn');
    if (!gift) return toast('Select a gift', 'warn');
    if (!(q > 0)) return toast('Enter a quantity of at least 1', 'warn');
    if (!reason) return toast('Enter a reason', 'warn');
    const opt = fill.list.find((x) => String(x.id) === gift);
    const gname = (opt ? opt.label : '').split(' — ')[0];
    const ok = await confirmDialog({
      title: 'Confirm adjustment',
      message: <>{dir > 0 ? 'Add' : 'Remove'} <b>{q}</b> × {gname} {dir > 0 ? 'to' : 'from'} <b>{shop.shop_name}</b>?<br /><span className="muted">Reason: {reason}</span></>,
      confirmText: 'Save adjustment', danger: dir < 0,
    });
    if (!ok) return undefined;
    try {
      const r = await api('/inventory/adjust', { method: 'POST', body: { shop_id: shop.id, gift_id: gift, delta: dir * q, reason } });
      toast(`Adjusted: allocated ${fmt.n(r.before)} → ${fmt.n(r.after)}`, 'ok');
      await loadLookups();
      onClose(); onDone && onDone();
    } catch (ex) { toastError(ex); }
    return undefined;
  };

  return (
    <Modal title="Inventory adjustment" size="wide" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><BusyButton className="btn primary" id="adSave" busyText="Saving…" onClick={save}>Save adjustment</BusyButton></>}>
      <div className="stack">
        <div className="callout warn">Adjustments change a shop's allocated quantity and are permanently recorded with your name and reason.</div>
        <div className="form-grid">
          <div className="field full"><label>Shop <span className="req">*</span></label>
            {ctx.shop
              ? <div id="adShop"><div className="input" style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-2)' }}><b className="mono">{ctx.shop.shop_id}</b>&nbsp;· {ctx.shop.shop_name}</div></div>
              : <ShopPicker id="adShop" onPick={onPick} />}
          </div>
          <div className="field"><label>Gift <span className="req">*</span></label>
            <select className="select" id="adGift" value={gift} onChange={(e) => setGift(e.target.value)}>{opts(fill.list, { label: (x) => x.label, placeholder: fill.placeholder })}</select></div>
          <div className="field"><label>Direction</label><div className="seg" id="adDir">
            <button type="button" data-d="-1" className={dir === -1 ? 'on' : ''} onClick={() => setDirection(-1)}>Remove (−)</button>
            <button type="button" data-d="1" className={dir === 1 ? 'on' : ''} onClick={() => setDirection(1)}>Add (+)</button></div></div>
          <div className="field"><label>Quantity <span className="req">*</span></label><input className="input" type="number" min="1" step="1" id="adQty" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
          <div className="field"><label>Reason <span className="req">*</span></label>
            <select className="select" id="adReason" value={reasonSel} onChange={(e) => setReasonSel(e.target.value)}>{REASONS.map((r) => <option key={r}>{r}</option>)}<option value="__other">Other…</option></select></div>
          <div className={`field full ${reasonSel === '__other' ? '' : 'hidden'}`} id="adOtherWrap"><label>Describe the reason <span className="req">*</span></label>
            <input className="input" id="adOther" maxLength={200} value={other} onChange={(e) => setOther(e.target.value)} /></div>
        </div>
        <div id="adInfo">{g ? (
          <div className="kv-inline">
            {i ? <><span>Allocated <b>{fmt.n(i.allocated)}</b></span><span>Given <b>{fmt.n(i.distributed)}</b></span><span>Max removable <b>{fmt.n(i.allocated - i.distributed - i.pending)}</b></span></> : null}
            <span>Warehouse available <b>{fmt.n(g.unallocated)}</b></span></div>
        ) : null}</div>
      </div>
    </Modal>
  );
}

/** Admin.adjustDialog(ctx, onDone) */
export function openAdjustDialog(ctx, onDone) {
  return openModal((close) => <AdjustModal ctx={ctx || {}} onClose={close} onDone={onDone} />);
}
