/* Toast messages. Call toast('Saved', 'ok') from anywhere; <ToastHost/> shows them. */
import { useEffect, useState } from 'react';

let push = null;
const queue = [];
let seq = 0;

/** type: 'info' | 'ok' | 'warn' | 'bad' */
export function toast(msg, type = 'info', ms = 4200) {
  const t = { id: ++seq, msg: String(msg), type, ms };
  if (push) push(t); else queue.push(t);
}
/** Show an error (except "signed out", which is handled by the sign-in flow). */
export const toastError = (e) => { if (e && e.status !== 401 && !e.shown) toast(e.message || String(e), 'bad', 6000); };

export function ToastHost() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    push = (t) => {
      setItems((x) => [...x, t]);
      setTimeout(() => setItems((x) => x.filter((y) => y.id !== t.id)), t.ms);
    };
    while (queue.length) push(queue.shift());
    return () => { push = null; };
  }, []);
  if (!items.length) return null;
  return (
    <div className="toasts" role="status">
      {items.map((t) => (
        <div key={t.id} className={'toast ' + t.type}>
          <span className="bar" /><span>{t.msg}</span>
          <button className="t-close" aria-label="Close" onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))}>×</button>
        </div>
      ))}
    </div>
  );
}
