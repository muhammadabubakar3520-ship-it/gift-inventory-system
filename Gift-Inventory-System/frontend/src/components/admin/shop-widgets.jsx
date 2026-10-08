/* Shop helpers shared by several pages (from pages-shops.js: Admin.movementTag, Admin.promptText). */
import { useState } from 'react';
import { Modal, openModal } from '../Modal';

/** Stock movement type as a chip (allocation / adjustment in / adjustment out). */
export function movementTag(t) {
  return ({
    allocation: <span className="chip info">Allocation</span>,
    adjustment_in: <span className="chip approved">Adjust +</span>,
    adjustment_out: <span className="chip rejected">Adjust −</span>,
  }[t] || t);
}

function PromptTextModal({ title, label, onClose, onDone }) {
  const [v, setV] = useState('');
  const go = () => { const x = v.trim(); if (!x) return; onDone(x); };
  return (
    <Modal title={title} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" id="ptOk" onClick={go}>Add</button></>}>
      <div className="field"><label>{label}</label><input className="input" id="ptVal" maxLength={80} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go(); }} /></div>
    </Modal>
  );
}

/** Ask for a short name (e.g. a new city). Resolves the trimmed text, or null when cancelled. */
export function promptText(title, label) {
  return new Promise((resolve) => {
    let finished = false;
    let close = null;
    const cancel = () => { if (close) close(); if (!finished) { finished = true; resolve(null); } };
    const done = (v) => { finished = true; if (close) close(); resolve(v); };
    close = openModal(() => <PromptTextModal title={title} label={label} onClose={cancel} onDone={done} />);
  });
}
