/* Mobile Models: models linked to brands (from pages-models.js). */
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import DataTable from '../../components/DataTable';
import { Chip, EmptyState, PageHead, SearchBox } from '../../components/ui';
import { confirmDialog } from '../../components/Modal';
import { toast, toastError } from '../../components/Toasts';
import { openModelForm } from '../../components/admin/ModelForm';
import { brandOpts } from '../../components/admin/options';
import usePaged, { PagedView } from '../../hooks/usePaged';
import { api } from '../../services/api';
import { usePageMeta } from '../../context/PageMetaContext';
import { useLookups } from '../../context/LookupsContext';

/** A new ?brand= in the URL starts the page again (as the original re-ran the route). */
export default function Models() {
  const [sp] = useSearchParams();
  const brand = sp.get('brand') || '';
  return <ModelsPage key={brand} brand={brand} />;
}

function ModelsPage({ brand }) {
  usePageMeta('Models', 'Mobile Models');
  const { lk, loadLookups } = useLookups();
  const list = usePaged({ initial: { search: '', brand_id: brand, status: '' }, fetch: async (st) => ({ rows: await api('/models', { query: st }) }) });

  const toggle = async (m) => {
    const to = m.status === 'active' ? 'inactive' : 'active';
    if (to === 'inactive' && !(await confirmDialog({ title: `Deactivate ${m.model_name}?`, message: 'Promoters will no longer be able to select this model. Past sales keep it.', confirmText: 'Deactivate', danger: true }))) return;
    try { await api(`/models/${m.id}/status`, { method: 'PATCH', body: { status: to } }); toast('Model updated', 'ok'); await loadLookups(); list.reload(); } catch (e) { toastError(e); }
  };

  const cols = [
    { label: 'Brand', render: (m) => (m.brand_name ? <><b>{m.brand_name}</b> <span className="muted mono small">{m.brand_code}</span></> : <span className="chip pending">No brand</span>) },
    { label: 'Model ID', render: (m) => <span className="mono">{m.item_code}</span> },
    { label: 'Model name', render: (m) => <span className="cell-main">{m.model_name}</span> },
    { label: 'Units sold', num: true, key: 'units_sold' },
    { label: 'Gifts given', num: true, key: 'gifts_given' },
    { label: 'Transactions', num: true, key: 'transactions' },
    { label: 'Status', render: (m) => <Chip status={m.status} /> },
    { label: '', cls: 'actions', render: (m) => <>
      <button className="btn sm" onClick={() => toggle(m)}>{m.status === 'active' ? 'Deactivate' : 'Activate'}</button>{' '}
      <button className="btn sm ghost" title="Edit" onClick={() => openModelForm(m, list.reload)}><Icon name="edit" /></button>
    </> },
  ];
  const bid = list.state.brand_id;

  return (
    <>
      <PageHead title="Mobile Models" desc="Each model belongs to a brand. Promoters choose Brand → Model when they record a sale." actions={<>
        <Link className="btn" to="/admin/import/models"><Icon name="upload" />Upload models (Excel)</Link><button className="btn primary" id="mdAdd" onClick={() => openModelForm(null, list.reload, bid && bid !== 'none' ? bid : '')}><Icon name="plus" />Add model</button>
      </>} />
      <section className="panel">
        <div className="filters" id="mdF">
          <SearchBox value={list.state.search} onChange={(v) => list.set({ search: v })} placeholder="Search model name or Model ID" />
          <select className="select" value={bid} onChange={(e) => list.set({ brand_id: e.target.value })}>{brandOpts(lk)}<option value="none">No brand</option></select>
          <select className="select" value={list.state.status} onChange={(e) => list.set({ status: e.target.value })}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
        </div>
        <div id="mdList">
          <PagedView list={list}>{(d) => (
            <>
              {d.rows.some((m) => !m.brand_id) && <div className="callout warn" style={{ margin: '12px 16px 0' }}>{d.rows.filter((m) => !m.brand_id).length} model(s) have no brand. Promoters cannot select them until you set the brand.</div>}
              <DataTable rows={d.rows} cols={cols}
                empty={<EmptyState title="No mobile models" text="Add models or upload them from Excel." action={<button className="btn primary" onClick={() => openModelForm(null, list.reload)}><Icon name="plus" />Add model</button>} />} />
            </>
          )}</PagedView>
        </div>
      </section>
    </>
  );
}
