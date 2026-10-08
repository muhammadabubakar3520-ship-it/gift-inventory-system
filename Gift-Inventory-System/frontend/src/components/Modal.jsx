/* =====================================================================
   Modals.
     <Modal title="Edit gift" size="wide" onClose={close} footer={<>…</>}>body</Modal>
   Open one from anywhere (event handlers, other pages):
     openModal((close) => <GiftFormModal gift={g} onClose={close} />)   → returns close()
   Promise-based confirm (optional reason input):
     const ok = await confirmDialog({ title, message, confirmText, danger, reason, reasonLabel })
   ===================================================================== */
import { useEffect, useRef, useState } from 'react';
import BusyButton from './BusyButton';

let api = null;
let seq = 0;
const pending = [];

export function openModal(render) {
  const id = ++seq;
  const close = () => api && api.remove(id);
  const entry = { id, render, close };
  if (api) api.add(entry); else pending.push(entry);
  return close;
}

/** Renders the modals opened with openModal(). Put it once inside the router and providers. */
export function ModalHost() {
  const [list, setList] = useState([]);
  useEffect(() => {
    api = { add: (e) => setList((l) => [...l, e]), remove: (id) => setList((l) => l.filter((x) => x.id !== id)) };
    while (pending.length) api.add(pending.shift());
    return () => { api = null; };
  }, []);
  return list.map((e) => <ModalSlot key={e.id} entry={e} />);
}
function ModalSlot({ entry }) { return entry.render(entry.close); }

let openCount = 0;
export function Modal({ title, size = '', onClose, footer, children, dismissible = true, className = '', ariaLabel }) {
  const backRef = useRef(null);
  const boxRef = useRef(null);
  useEffect(() => {
    openCount++;
    document.body.style.overflow = 'hidden';
    const first = boxRef.current && boxRef.current.querySelector('.modal-b input:not([type=hidden]):not([disabled]):not([type=checkbox]), .modal-b select, .modal-b textarea');
    const t = setTimeout(() => { if (first) first.focus(); }, 30);
    return () => { clearTimeout(t); openCount--; if (!openCount) document.body.style.overflow = ''; };
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || !dismissible) return;
      const all = document.querySelectorAll('.modal-backdrop');
      if (all[all.length - 1] === backRef.current) onClose && onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dismissible, onClose]);
  return (
    <div className="modal-backdrop" ref={backRef} onMouseDown={(e) => { if (e.target === backRef.current && dismissible) onClose && onClose(); }}>
      <div className={`modal ${size} ${className}`} role="dialog" aria-modal="true" aria-label={ariaLabel || (typeof title === 'string' ? title : undefined)} ref={boxRef}>
        <div className="modal-h"><h2>{title}</h2>{dismissible && <button className="x-btn" aria-label="Close" onClick={onClose}>×</button>}</div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

function ConfirmModal({ opts, done }) {
  const { title = 'Are you sure?', message = '', confirmText = 'Confirm', danger = false, reason = false, reasonLabel = 'Reason', reasonPlaceholder = '' } = opts;
  const [text, setText] = useState('');
  const [err, setErr] = useState(false);
  const ok = useRef(null);
  useEffect(() => { if (!reason) setTimeout(() => ok.current && ok.current.focus(), 30); }, [reason]);
  const confirm = () => {
    if (reason) { const v = text.trim(); if (!v) { setErr(true); return; } done(v); } else done(true);
  };
  return (
    <Modal title={title} onClose={() => done(false)}
      footer={<><button className="btn" onClick={() => done(false)}>Cancel</button><button ref={ok} className={`btn ${danger ? 'danger' : 'primary'}`} onClick={confirm}>{confirmText}</button></>}>
      <div className="stack">
        <div>{message}</div>
        {reason && (
          <div className="field"><label>{reasonLabel} <span className="req">*</span></label>
            <textarea className="input" maxLength={300} placeholder={reasonPlaceholder} value={text} onChange={(e) => setText(e.target.value)} />
            {err && <div className="err">Please enter a reason.</div>}
          </div>
        )}
      </div>
    </Modal>
  );
}

export function confirmDialog(opts) {
  return new Promise((resolve) => {
    let closeFn = null;
    const done = (v) => { if (closeFn) closeFn(); resolve(v); };
    closeFn = openModal(() => <ConfirmModal opts={opts} done={done} />);
  });
}

/** Ask for one line of text. Resolves the text or null. */
export function promptDialog({ title, label, value = '', placeholder = '', confirmText = 'Save', maxLength = 200, hint }) {
  return new Promise((resolve) => {
    let closeFn = null;
    const done = (v) => { if (closeFn) closeFn(); resolve(v); };
    function Prompt() {
      const [v, setV] = useState(value);
      return (
        <Modal title={title} onClose={() => done(null)}
          footer={<><button className="btn" onClick={() => done(null)}>Cancel</button><BusyButton className="btn primary" onClick={async () => done(v.trim())}>{confirmText}</BusyButton></>}>
          <div className="field"><label>{label}</label>
            <input className="input" value={v} maxLength={maxLength} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') done(v.trim()); }} />
            {hint && <div className="hint">{hint}</div>}
          </div>
        </Modal>
      );
    }
    closeFn = openModal(() => <Prompt />);
  });
}
