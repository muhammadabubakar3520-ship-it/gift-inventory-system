/* Add / edit mobile model form (from pages-models.js: modelForm / Admin.modelForm). */
import { useEffect, useRef, useState } from 'react';
import { Modal, openModal } from '../Modal';
import BusyButton from '../BusyButton';
import { toast, toastError } from '../Toasts';
import { api } from '../../services/api';
import { useLookups } from '../../context/LookupsContext';
import { brandOpts } from './options';

function ModelFormModal({ model: m, brandId, onClose, onSaved }) {
  const { lk, loadLookups } = useLookups();
  const v = m || { status: 'active', brand_id: brandId || '' };
  const [f, setF] = useState({ brand_id: v.brand_id == null ? '' : String(v.brand_id), model_name: v.model_name || '', item_code: v.item_code || '', status: v.status || 'active' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = async () => {
    const b = { ...f };
    if (!b.brand_id) return toast('Select the brand', 'warn');
    if (!b.model_name.trim() || !b.item_code.trim()) return toast('Model name and Model ID are required', 'warn');
    try {
      await api(m ? `/models/${m.id}` : '/models', { method: m ? 'PUT' : 'POST', body: { ...b, ...(m ? { expected_updated_at: m.updated_at } : {}) } });
      toast(m ? 'Model updated' : 'Model added', 'ok');
      await loadLookups();
      onClose(); if (onSaved) onSaved();
    } catch (ex) { toastError(ex); }
    return undefined;
  };

  return (
    <Modal title={m ? `Edit model · ${m.model_name}` : 'Add mobile model'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><BusyButton className="btn primary" id="mdSave" busyText="Saving…" onClick={save}>{m ? 'Save changes' : 'Add model'}</BusyButton></>}>
      <div className="stack" id="mdForm">
        <div className="field"><label>Brand <span className="req">*</span></label><select className="select" name="brand_id" value={f.brand_id} onChange={set('brand_id')}>{brandOpts(lk, 'Select brand', true, v.brand_id)}</select></div>
        <div className="field"><label>Model name <span className="req">*</span></label><input className="input" name="model_name" value={f.model_name} onChange={set('model_name')} maxLength={80} placeholder="e.g. Galaxy A15" /></div>
        <div className="field"><label>Model ID <span className="req">*</span></label><input className="input mono" name="item_code" value={f.item_code} onChange={set('item_code')} maxLength={60} placeholder="e.g. MOD001 or X6878 256+8" />
          <div className="hint">Unique model / item code. Include the memory variant if you track it (256+8).</div></div>
        <div className="field"><label>Status</label><select className="select" name="status" value={f.status} onChange={set('status')}><option value="active">Active — promoters can select it</option><option value="inactive">Inactive — hidden from promoters</option></select></div>
      </div>
    </Modal>
  );
}

/* Without brands there is nothing to pick: say so instead of opening the form (like the original). */
function ModelFormGate({ close, ...props }) {
  const { lk } = useLookups();
  const none = !lk.brands.length;
  const warned = useRef(false);
  useEffect(() => {
    if (none && !warned.current) { warned.current = true; toast('Add a brand first (Mobile Models → Brands)', 'warn'); close(); }
  }, [none, close]);
  return none ? null : <ModelFormModal {...props} onClose={close} />;
}

/** Admin.modelForm(m, onSaved, brandId): m = null for a new model; brandId preselects the brand. */
export function openModelForm(m, onSaved, brandId) {
  return openModal((close) => <ModelFormGate close={close} model={m} onSaved={onSaved} brandId={brandId} />);
}
