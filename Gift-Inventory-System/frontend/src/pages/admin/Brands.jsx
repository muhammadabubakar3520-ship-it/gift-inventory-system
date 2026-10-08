/* Mobile Models → Brands (from pages-brands.js). */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon';
import DataTable from '../../components/DataTable';
import { Chip, EmptyState, PageHead, SearchBox } from '../../components/ui';
import { Modal, openModal, confirmDialog } from '../../components/Modal';
import BusyButton from '../../components/BusyButton';
import { toast, toastError } from '../../components/Toasts';
import usePaged, { PagedView } from '../../hooks/usePaged';
import { api } from '../../services/api';
import { usePageMeta } from '../../context/PageMetaContext';
import { useLookups } from '../../context/LookupsContext';

function BrandFormModal({ brand: b, onClose, onSaved }) {
  const { loadLookups } = useLookups();
  const v = b || { status: 'active' };
  const [f, setF] = useState({ brand_name: v.brand_name || '', brand_code: v.brand_code || '', status: v.status || 'active' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    if (!f.brand_name.trim()) return toast('Brand name is required', 'warn');
    try {
      const saved = await api(b ? `/brands/${b.id}` : '/brands', { method: b ? 'PUT' : 'POST', body: { ...f, ...(b ? { expected_updated_at: b.updated_at } : {}) } });
      toast(b ? 'Brand updated' : `${saved.brand_code} added`, 'ok');
      await loadLookups();
      onClose(); if (onSaved) onSaved();
    } catch (ex) { toastError(ex); }
    return undefined;
  };
  return (
    <Modal title={b ? `Edit brand · ${b.brand_name}` : 'Add mobile brand'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><BusyButton className="btn primary" id="brSave" busyText="Saving…" onClick={save}>{b ? 'Save changes' : 'Add brand'}</BusyButton></>}>
      <div className="stack" id="brForm">
        <div className="field"><label>Brand name <span className="req">*</span></label><input className="input" name="brand_name" value={f.brand_name} onChange={set('brand_name')} maxLength={60} placeholder="e.g. Samsung" /></div>
        <div className="field"><label>Brand ID</label><input className="input mono" name="brand_code" value={f.brand_code} onChange={set('brand_code')} maxLength={20} placeholder="Leave blank to create one (BR002…)" /></div>
        <div className="field"><label>Status</label><select className="select" name="status" value={f.status} onChange={set('status')}><option value="active">Active — promoters can select it</option><option value="inactive">Inactive — hidden from promoters</option></select></div>
      </div>
    </Modal>
  );
}
const brandForm = (b, onSaved) => openModal((close) => <BrandFormModal brand={b} onClose={close} onSaved={onSaved} />);

export default function Brands() {
  usePageMeta('Brands', 'Mobile Models');
  const navigate = useNavigate();
  const { loadLookups } = useLookups();
  const list = usePaged({ initial: { search: '', status: '' }, fetch: async (st) => ({ rows: await api('/brands', { query: st }) }) });

  const toggle = async (x) => {
    const to = x.status === 'active' ? 'inactive' : 'active';
    if (to === 'inactive' && !(await confirmDialog({ title: `Deactivate ${x.brand_name}?`, message: 'Promoters will not see this brand or its models. Past sales are kept.', confirmText: 'Deactivate', danger: true }))) return;
    try { await api(`/brands/${x.id}/status`, { method: 'PATCH', body: { status: to } }); toast('Brand updated', 'ok'); await loadLookups(); list.reload(); } catch (e) { toastError(e); }
  };

  const cols = [
    { label: 'Brand ID', render: (b) => <b className="mono">{b.brand_code}</b> },
    { label: 'Brand', render: (b) => <span className="cell-main">{b.brand_name}</span> },
    { label: 'Models', num: true, render: (b) => <>{b.active_models}{b.model_count !== b.active_models ? <span className="muted"> / {b.model_count}</span> : null}</> },
    { label: 'Units sold', num: true, key: 'units_sold' },
    { label: 'Gifts given', num: true, key: 'gifts_given' },
    { label: 'Status', render: (b) => <Chip status={b.status} /> },
    { label: '', cls: 'actions', render: (b) => <>
      <button className="btn sm" onClick={() => navigate('/admin/models?brand=' + b.id)}>Models</button>{' '}
      <button className="btn sm" onClick={() => toggle(b)}>{b.status === 'active' ? 'Deactivate' : 'Activate'}</button>{' '}
      <button className="btn sm ghost" title="Edit" onClick={() => brandForm(b, list.reload)}><Icon name="edit" /></button>
    </> },
  ];

  return (
    <>
      <PageHead title="Mobile Brands" desc="Brands promoters can choose when recording a mobile sale (Samsung, Vivo, Oppo, Infinix…)." actions={<>
        <Link className="btn" to="/admin/import/brands"><Icon name="upload" />Upload brands (Excel)</Link><button className="btn primary" id="brAdd" onClick={() => brandForm(null, list.reload)}><Icon name="plus" />Add brand</button>
      </>} />
      <section className="panel">
        <div className="filters" id="brF">
          <SearchBox value={list.state.search} onChange={(v) => list.set({ search: v })} placeholder="Search brand" />
          <select className="select" value={list.state.status} onChange={(e) => list.set({ status: e.target.value })}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
        </div>
        <div id="brList">
          <PagedView list={list}>{(d) => (
            <DataTable rows={d.rows} cols={cols} onRow={(b) => navigate('/admin/models?brand=' + b.id)}
              empty={<EmptyState title="No brands yet" text="Add the mobile brands your promoters sell." action={<button className="btn primary" onClick={() => brandForm(null, list.reload)}><Icon name="plus" />Add brand</button>} />} />
          )}</PagedView>
        </div>
      </section>
    </>
  );
}
