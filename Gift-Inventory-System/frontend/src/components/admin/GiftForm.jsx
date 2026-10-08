/* Add / edit gift form and "Receive stock" dialog (from pages-gifts.js: Admin.giftForm, receiveStock). */
import { useState } from 'react';
import { Modal, openModal } from '../Modal';
import BusyButton from '../BusyButton';
import { toast, toastError } from '../Toasts';
import { api, forgetImage } from '../../services/api';
import { fmt } from '../../utils/format';
import { useLookups } from '../../context/LookupsContext';

function GiftFormModal({ gift, onClose, onSaved }) {
  const { lk, loadLookups } = useLookups();
  const g0 = gift || { unit: 'pcs', status: 'active', total_quantity: 0 };
  const [f, setF] = useState({
    gift_name: g0.gift_name || '', category: g0.category || '', description: g0.description || '',
    unit: g0.unit || 'pcs', total_quantity: String(g0.total_quantity ?? 0), status: g0.status || 'active',
  });
  const [file, setFile] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const cats = [...new Set(lk.gifts.map((x) => x.category).filter(Boolean))];

  const save = async () => {
    if (!f.gift_name.trim()) return toast('Gift name is required', 'warn');
    if (f.total_quantity === '' || Number(f.total_quantity) < 0) return toast('Enter the total available quantity', 'warn');
    try {
      let saved = await api(gift ? `/gifts/${gift.id}` : '/gifts', { method: gift ? 'PUT' : 'POST', body: { ...f, ...(gift ? { expected_updated_at: gift.updated_at } : {}) } });
      if (file) {
        const fd = new FormData(); fd.append('image', file);
        saved = await api(`/gifts/${saved.id}/image`, { method: 'POST', form: fd });
        forgetImage(`/files/gifts/${saved.gift_id}/image`);
      }
      toast(gift ? 'Gift updated' : `Gift ${saved.gift_id} created`, 'ok');
      await loadLookups();
      onClose();
      if (onSaved) onSaved(saved);
    } catch (ex) { toastError(ex); }
    return undefined;
  };

  return (
    <Modal title={gift ? `Edit gift · ${gift.gift_id}` : 'Add gift'} size="wide" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><BusyButton className="btn primary" id="gSave" busyText="Saving…" onClick={save}>{gift ? 'Save changes' : 'Create gift'}</BusyButton></>}>
      <div className="form-grid" id="giftForm">
        {!gift && <div className="field full"><div className="callout">A unique Gift ID (e.g. GFT-001) is generated automatically.</div></div>}
        <div className="field"><label>Gift name <span className="req">*</span></label><input className="input" name="gift_name" value={f.gift_name} onChange={set('gift_name')} maxLength={100} placeholder="e.g. T-Shirt" /></div>
        <div className="field"><label>Category</label><input className="input" name="category" value={f.category} onChange={set('category')} maxLength={60} list="giftCats" placeholder="e.g. Apparel" />
          <datalist id="giftCats">{cats.map((c) => <option key={c} value={c} />)}</datalist></div>
        <div className="field full"><label>Description</label><textarea className="input" name="description" value={f.description} onChange={set('description')} maxLength={500} /></div>
        <div className="field"><label>Unit</label><input className="input" name="unit" value={f.unit} onChange={set('unit')} maxLength={20} placeholder="pcs, box, pack" /></div>
        <div className="field"><label>Total available quantity <span className="req">*</span></label><input className="input" name="total_quantity" type="number" min={gift ? gift.allocated : 0} step="1" value={f.total_quantity} onChange={set('total_quantity')} />
          <div className="hint">{gift ? <>Total warehouse stock. Cannot be lower than the {fmt.n(gift.allocated)} already allocated to shops.</> : 'Total stock available for allocation to shops.'}</div></div>
        <div className="field"><label>Status</label><select className="select" name="status" value={f.status} onChange={set('status')}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
        <div className="field"><label>Image (optional)</label><input type="file" accept="image/jpeg,image/png,image/webp" id="gImg" className="input" style={{ paddingTop: 6 }} onChange={(e) => setFile(e.target.files[0] || null)} />
          <div className="hint">JPG, PNG or WEBP, up to 6 MB.</div></div>
      </div>
    </Modal>
  );
}

/** Admin.giftForm(gift, onSaved): gift = null for a new gift. */
export function openGiftForm(gift, onSaved) {
  return openModal((close) => <GiftFormModal gift={gift} onClose={close} onSaved={onSaved} />);
}

function ReceiveStockModal({ gift: g, onClose, onDone }) {
  const { loadLookups } = useLookups();
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const save = async () => {
    if (!(Number(quantity) > 0)) return toast('Enter a quantity greater than 0', 'warn');
    try {
      await api(`/gifts/${g.id}/stock`, { method: 'POST', body: { quantity, note } });
      toast(`${fmt.n(quantity)} added to ${g.gift_name}`, 'ok');
      await loadLookups(); onClose(); onDone && onDone();
    } catch (ex) { toastError(ex); }
    return undefined;
  };
  return (
    <Modal title={`Receive stock · ${g.gift_name}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><BusyButton className="btn primary" id="rsSave" onClick={save}>Add to stock</BusyButton></>}>
      <div className="stack" id="rsForm"><div className="kv-inline"><span>Current total: <b>{fmt.n(g.total_quantity)}</b></span><span>In warehouse: <b>{fmt.n(g.unallocated)}</b></span></div>
        <div className="field"><label>Quantity received <span className="req">*</span></label><input className="input" type="number" min="1" step="1" name="quantity" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
        <div className="field"><label>Note</label><input className="input" name="note" maxLength={200} placeholder="e.g. PO-2291 delivery" value={note} onChange={(e) => setNote(e.target.value)} /></div></div>
    </Modal>
  );
}
export function openReceiveStock(gift, onDone) {
  return openModal((close) => <ReceiveStockModal gift={gift} onClose={close} onDone={onDone} />);
}
