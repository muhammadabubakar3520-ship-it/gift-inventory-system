/* Excel Import Center: Upload → Validate → Preview → Import (from pages-import.js). */
import { Fragment, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import BusyButton from '../../components/BusyButton';
import { EmptyState, PageHead, LoadingBlock } from '../../components/ui';
import { toast, toastError } from '../../components/Toasts';
import { api } from '../../services/api';
import { fmt } from '../../utils/format';
import Excel from '../../utils/excel';
import ImportRules from '../../utils/shared/import-rules';
import { usePageMeta } from '../../context/PageMetaContext';
import { useLookups } from '../../context/LookupsContext';
import { useHoldLive } from '../../context/SyncContext';

const ORDER = ['shops', 'brands', 'models', 'gifts', 'inventory', 'promoters'];
const LINKS = { shops: '/admin/shops', brands: '/admin/brands', models: '/admin/models', gifts: '/admin/gifts', inventory: '/admin/inventory', promoters: '/admin/promoters' };
const STEPS = ['Upload', 'Validate', 'Preview', 'Import'];

export default function ImportPage() {
  usePageMeta('Excel Import', 'Excel Import');
  useHoldLive();
  const params = useParams();
  const { lkRef, loadLookups, allShops } = useLookups();
  const type = ORDER.includes(params.type) ? params.type : 'shops';
  const T = ImportRules.TYPES[type];
  const [opts, setOpts] = useState({ mode: 'set', create_promoters: false });
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [result, setResult] = useState(null);
  const [filter, setFilter] = useState('all');
  const [step, setStep] = useState(0);
  const [sheet, setSheet] = useState(null);
  const [view, setView] = useState({ kind: 'upload', err: null }); // upload | loading | preview | done
  const [over, setOver] = useState(false);

  /* Step 1 — Upload */
  const drawUpload = (err) => { setStep(0); setView({ kind: 'upload', err: err || null }); };

  /* Step 2 — Validate */
  async function pick(f, sheetName) {
    setFile(f);
    let sh = sheetName || null;
    setSheet(sh);
    setStep(1);
    setView({ kind: 'loading', text: `Reading ${f.name}…` });
    try {
      const book = await Excel.readFile(f, sh);
      sh = book.sheetName; setSheet(sh);
      const p = ImportRules.toObjects(type, book.aoa);
      p.sheetNames = book.sheetNames;
      setParsed(p);
      if (p.missing.length) {
        return drawUpload(<><b>Some required columns are missing:</b> {p.missing.join(', ')}.<br />Columns found in &quot;{sh}&quot;: {p.header.filter(Boolean).join(', ') || 'none'}.<br />Download the template to see the expected headings.</>);
      }
      if (!p.rows.length) return drawUpload('The file has a header row but no data rows.');
      if (p.rows.length > 5000) return drawUpload(`The file has ${fmt.n(p.rows.length)} rows. Import at most 5,000 rows at a time — split the file.`);
      setView({ kind: 'loading', text: `Validating ${fmt.n(p.rows.length)} rows…` });
      const r = await api(`/import/${type}`, { method: 'POST', body: { rows: p.rows, options: opts } });
      setResult(r);
      setFilter(r.errors ? 'error' : 'all');
      setStep(2); setView({ kind: 'preview' });
    } catch (e) { drawUpload(e.message); }
    return undefined;
  }

  /* Step 4 — Import */
  async function doImport() {
    try {
      const r = await api(`/import/${type}`, { method: 'POST', body: { rows: parsed.rows, options: opts, commit: true } });
      setResult(r);
      setStep(4);
      await loadLookups();
      if (lkRef.current.shops) await allShops(true).catch(() => {}); // original: Admin.lk.shops = null
      setView({ kind: 'done' });
      toast(`${T.title} imported`, 'ok');
    } catch (e) { toastError(e); }
  }

  const steps = (
    <div className="imp-steps" id="iSteps">{STEPS.map((l, i) => (
      <div key={l} className={`is ${i < step ? 'done' : i === step ? 'on' : ''}`}><span>{i < step ? <Icon name="check" /> : i + 1}</span><div><b>Step {i + 1}</b><small>{l}</small></div></div>
    ))}</div>
  );

  let body = null;
  if (view.kind === 'loading') body = <LoadingBlock text={view.text} />;
  else if (view.kind === 'upload') {
    const err = view.err;
    body = (
      <div className="imp-grid">
        <div>
          <label className={`dropzone ${over ? 'over' : ''}`} id="iDrop"
            onDragEnter={(e) => { e.preventDefault(); setOver(true); }} onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); setOver(false); }}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) pick(f); }}>
            <Icon name="upload" /><b>Drop your {T.title} file here</b><span>or click to choose · .xlsx, .xls or .csv</span>
            <input type="file" id="iFile" accept={Excel.ACCEPT} hidden onChange={(e) => { if (e.target.files[0]) pick(e.target.files[0]); }} /></label>
          {err ? <div className="callout bad" style={{ marginTop: 12 }}>{err}</div> : null}
          {type === 'inventory' ? <div className="imp-opts"><b>How should the quantity be used?</b>
            <label className="radio-row"><input type="radio" name="mode" value="set" checked={opts.mode === 'set'} onChange={() => setOpts((o) => ({ ...o, mode: 'set' }))} /> <span><b>Set to this quantity</b><small>The shop's allocation becomes exactly the number in the file.</small></span></label>
            <label className="radio-row"><input type="radio" name="mode" value="add" checked={opts.mode === 'add'} onChange={() => setOpts((o) => ({ ...o, mode: 'add' }))} /> <span><b>Add to current allocation</b><small>The number in the file is added to what the shop already has.</small></span></label></div> : null}
          {type === 'shops' ? <div className="imp-opts"><label className="radio-row"><input type="checkbox" id="iCreateP" checked={opts.create_promoters} onChange={(e) => { const c = e.target.checked; setOpts((o) => ({ ...o, create_promoters: c })); }} /> <span><b>Create missing promoters</b><small>If a promoter in the file does not exist, create them (password {ImportRules.DEFAULT_PASSWORD}).</small></span></label></div> : null}
        </div>
        <div className="imp-help">
          <h3>{T.title} — columns</h3>
          <table className="tbl compact"><thead><tr><th>Column</th><th>Required</th></tr></thead>
            <tbody>{T.columns.map((c) => <tr key={c.key}><td><b>{c.label}</b></td><td>{c.required ? <span className="chip pending">Required</span> : <span className="muted">Optional</span>}</td></tr>)}</tbody></table>
          {type === 'inventory' ? <p className="small muted">Give either Gift ID or Gift Name.</p> : null}
          {type === 'models' ? <p className="small muted">Give either Brand ID or Brand Name. Example: <span className="mono">BR001 | Samsung | MOD001 | Galaxy A15 | Active</span></p> : null}
          <p className="small">{T.help}</p>
          <button className="btn sm" id="iTpl2" onClick={() => Excel.template(type).catch(toastError)}><Icon name="download" />Download template</button>
        </div>
      </div>
    );
  } else if (view.kind === 'preview') {
    /* Step 3 — Preview */
    const r = result;
    const rows = r.rows.filter((x) => filter === 'all' || (filter === 'ok' ? x.status !== 'error' : x.status === filter));
    const shown = rows.slice(0, 500);
    const keyCols = T.columns;
    const n = r.valid - (r.skipped || 0);
    body = (
      <>
        <div className="imp-file"><Icon name="sheet" /><div><b>{file.name}</b><span>{parsed.sheetNames.length > 1 ? <>Sheet <select className="select sm" id="iSheet" style={{ width: 'auto', display: 'inline-block', height: 26 }} value={sheet || ''} onChange={(e) => pick(file, e.target.value)}>{parsed.sheetNames.map((nm) => <option key={nm}>{nm}</option>)}</select> · </> : null}{(file.size / 1024).toFixed(0)} KB{parsed.unknown.length ? ` · ignored columns: ${parsed.unknown.join(', ')}` : ''}</span></div>
          <button className="btn sm" id="iAgain" onClick={() => drawUpload()}><Icon name="upload" />Choose another file</button></div>
        <div className="imp-stats">
          <div className="s total"><span>Total Rows</span><b>{fmt.n(r.total)}</b></div>
          <div className="s ok"><span>Valid</span><b>{fmt.n(r.valid)}</b></div>
          <div className="s warn"><span>Warnings</span><b>{fmt.n(r.warnings)}</b></div>
          <div className="s bad"><span>Errors</span><b>{fmt.n(r.errors)}</b></div>
          {type === 'inventory' ? <div className="s"><span>No change</span><b>{fmt.n(r.skipped)}</b></div> : null}
        </div>
        {r.newPromoters && r.newPromoters.length ? <div className="callout warn">{r.newPromoters.length} new promoter(s) will be created: {r.newPromoters.map((p) => p.name).join(', ')}.</div> : null}
        {r.newBrands && r.newBrands.length ? <div className="callout">New brand(s) will be created: {r.newBrands.map((b) => b.brand_name).join(', ')}.</div> : null}
        <div className="row" style={{ margin: '12px 0 8px', flexWrap: 'wrap', gap: 8 }}>
          <div className="seg" id="iFilter">{[['all', `All ${r.total}`], ['ok', `Valid ${r.valid}`], ['warn', `Warnings ${r.warnings}`], ['error', `Errors ${r.errors}`]].map(([k, l]) => (
            <button key={k} data-f={k} className={k === filter ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>
          ))}</div>
          <span className="spacer" />
          {r.errors || r.warnings ? <button className="btn sm" id="iErr" onClick={() => Excel.errorReport(result, file.name).catch(toastError)}><Icon name="download" />Download error report</button> : null}
        </div>
        <div className="table-wrap" style={{ maxHeight: '52vh' }}><table className="tbl compact imp-tbl">
          <thead><tr><th className="num">Row</th><th>Result</th>{keyCols.map((c) => <th key={c.key}>{c.label}</th>)}<th>Messages</th></tr></thead>
          <tbody>{shown.map((x, ri) => (
            <tr key={`${x.line}-${ri}`} className={`imp-${x.status}`}><td className="num mono">{x.line}</td>
              <td>{x.status === 'error' ? <span className="chip rejected">Error</span> : x.status === 'warn' ? <span className="chip pending">Warning</span> : <span className="chip approved">Valid</span>}
                {x.status !== 'error' ? <div className="cell-sub">{x.action === 'skip' ? 'no change' : x.action === 'update' ? 'update' : x.action === 'set' ? (x.data.delta > 0 ? `+${x.data.delta}` : x.data.delta) : 'new'}</div> : null}</td>
              {keyCols.map((c) => <td key={c.key}>{x.input[c.key] === undefined || x.input[c.key] === '' ? <span className="muted">—</span> : String(x.input[c.key])}</td>)}
              <td className="msgs">{x.messages.map((m, mi) => <div key={mi} className={`m-${m.level}`}>{m.text}</div>)}</td></tr>
          ))}</tbody></table></div>
        {rows.length > shown.length ? <p className="muted small">Showing the first 500 of {fmt.n(rows.length)} rows. The error report has all of them.</p> : null}
        {!rows.length ? <EmptyState title="Nothing to show" text="No rows match this filter." /> : null}
        <div className="imp-actions">
          {r.errors ? <div className="muted small">{fmt.n(r.errors)} row(s) with errors will be skipped. Fix them in the file and upload again, or import the valid rows now.</div> : <div className="muted small">All rows are valid.</div>}
          <span className="spacer" />
          <button className="btn" id="iCancel" onClick={() => drawUpload()}>Cancel</button>
          <BusyButton className="btn primary" id="iGo" busyText="Importing…" disabled={!(n > 0)} onClick={doImport}><Icon name="check" />Import {fmt.n(n)} valid row(s)</BusyButton>
        </div>
      </>
    );
  } else if (view.kind === 'done') {
    const r = result;
    const parts = [];
    if (r.created !== undefined) parts.push(<><b>{fmt.n(r.created)}</b> created</>);
    if (r.updated !== undefined) parts.push(<><b>{fmt.n(r.updated)}</b> {type === 'inventory' ? 'shop-gift lines updated' : 'updated'}</>);
    if (r.brands_created) parts.push(<><b>{fmt.n(r.brands_created)}</b> new brand(s)</>);
    if (r.quantity_added) parts.push(<><b>{fmt.n(r.quantity_added)}</b> gifts allocated</>);
    if (r.quantity_removed) parts.push(<><b>{fmt.n(r.quantity_removed)}</b> gifts taken back to warehouse</>);
    body = (
      <div className="imp-done">
        <div className="tick"><Icon name="check" /></div><h2>Import complete</h2>
        <p>{parts.length ? parts.map((p, i) => <Fragment key={i}>{i ? ' · ' : ''}{p}</Fragment>) : 'No changes'}</p>
        {r.errors ? <p className="muted">{fmt.n(r.errors)} row(s) with errors were skipped.</p> : null}
        {r.new_promoters && r.new_promoters.length ? <div className="callout warn" style={{ textAlign: 'left', maxWidth: 560, margin: '10px auto' }}><b>New promoter logins</b> (password <span className="mono">{r.new_promoter_password}</span>)<br />{r.new_promoters.map((p, i) => <Fragment key={i}>{p.name} — <span className="mono">{p.email}</span><br /></Fragment>)}</div> : null}
        <div className="row" style={{ justifyContent: 'center', gap: 8, marginTop: 14 }}>
          {r.errors ? <button className="btn" id="iErr2" onClick={() => Excel.errorReport(result, file.name).catch(toastError)}><Icon name="download" />Download error report</button> : null}
          <button className="btn" id="iMore" onClick={() => drawUpload()}><Icon name="upload" />Upload another file</button>
          <Link className="btn primary" to={LINKS[type]}>View {T.title}</Link></div>
      </div>
    );
  }

  return (
    <>
      <PageHead title="Excel Import Center" desc="Set up the system from Excel: upload, check every row, preview, then import."
        actions={<button className="btn" id="iTpl" onClick={() => Excel.template(type).catch(toastError)}><Icon name="download" />Download {T.title} template</button>} />
      <section className="panel">
        <div className="tabs">{ORDER.map((k) => <Link key={k} className={`tab ${k === type ? 'on' : ''}`} to={`/admin/import/${k}`}>{ImportRules.TYPES[k].title}</Link>)}</div>
        {steps}
        <div id="iBody" className="panel-b">{body}</div>
      </section>
    </>
  );
}
