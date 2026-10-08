/* Transaction viewer modal + All Transactions list (from pages-transactions.js: Admin.openTransaction, Admin.txnList). */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../Icon';
import DataTable from '../DataTable';
import { Modal, openModal } from '../Modal';
import { Chip, EmptyState, LoadingBlock, ErrorBlock, SearchBox } from '../ui';
import usePaged, { PagedView } from '../../hooks/usePaged';
import { api, imageUrl } from '../../services/api';
import { fmt } from '../../utils/format';
import { clean } from '../../utils/admin';

/** Protected <img> that keeps a title attribute (legacy <img class="thumb" title=… data-auth-src=…>). */
export function ProofThumb({ path, title, className = 'thumb', alt = '' }) {
  const [src, setSrc] = useState(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    let live = true;
    setSrc(null); setBroken(false);
    if (path) imageUrl(path).then((u) => { if (live) setSrc(u); }, () => { if (live) setBroken(true); });
    return () => { live = false; };
  }, [path]);
  return <img className={`${className} ${src ? '' : 'loading'} ${broken ? 'broken' : ''}`.trim()} title={title} src={src || undefined} alt={broken ? 'Photo not available' : alt} />;
}

/* ------------------------------ Transaction viewer ------------------------------ */
function Photo({ label, path, has, txnId }) {
  const [zoom, setZoom] = useState(false);
  const [src, setSrc] = useState(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    let live = true;
    if (has) imageUrl(path).then((u) => { if (live) setSrc(u); }, () => { if (live) setBroken(true); });
    return () => { live = false; };
  }, [path, has]);
  const openFull = () => {
    if (!src) return;
    const w = window.open(src, '_blank');
    if (!w) setZoom((z) => !z);
  };
  return (
    <figure className="proof">
      <figcaption>{label}</figcaption>
      <div className={`photo-frame ${zoom ? 'zoom' : ''}`.trim()} onClick={() => setZoom((z) => !z)}>
        {has
          ? <img className={`${src ? '' : 'loading'} ${broken ? 'broken' : ''}`.trim() || undefined} src={src || undefined} alt={broken ? 'Photo not available' : `${label} for ${txnId}`} />
          : <div className="nophoto">No photo</div>}
      </div>
      {has ? <div className="row muted small" style={{ marginTop: 4 }}>Click to zoom<span className="spacer" /><button className="link-btn" onClick={openFull}>Open full size</button></div> : null}
    </figure>
  );
}

function TransactionModal({ code, onClose }) {
  const [d, setD] = useState(undefined);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let live = true;
    api('/transactions/' + encodeURIComponent(code)).then((x) => { if (live) setD(x); }, (e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [code]);

  const t = d && d.transaction;
  const st = (d && d.stock) || {};
  const title = t ? <>Transaction <span className="mono">{t.transaction_id}</span> <Chip status={t.status} /></> : 'Transaction';
  const footer = t ? <><span className="spacer" /><button className="btn" onClick={onClose}>Close</button></> : null;

  let body;
  if (err) body = <ErrorBlock message={err.message} />;
  else if (!t) body = <LoadingBlock />;
  else {
    body = (
      <div className="txn-view">
        <div className="proof-grid">
          <Photo label="MOBILE SALE PROOF" path={`/files/transactions/${t.transaction_id}/mobile-photo`} has={t.has_mobile_photo} txnId={t.transaction_id} />
          <Photo label="GIFT PROOF" path={`/files/transactions/${t.transaction_id}/photo`} has={t.has_photo} txnId={t.transaction_id} />
        </div>
        <div className="txn-info">
          <div className="info-block"><h4><Icon name="receipt" />Transaction</h4><dl className="dl">
            <dt>Transaction ID</dt><dd className="mono">{t.transaction_id}</dd>
            <dt>Date / time</dt><dd>{fmt.dt(t.created_at)}</dd>
            <dt>Promoter</dt><dd><Link to={`/admin/promoters/${t.promoter_pk}/performance`} onClick={onClose}>{t.promoter_name}</Link> <span className="muted mono">{t.promoter_code}</span></dd>
            <dt>Shop</dt><dd><Link to={`/admin/shops/${t.shop_id}`} onClick={onClose}>{t.shop_name}</Link> <span className="muted mono">{t.shop_id}</span></dd>
            <dt>City / Market</dt><dd>{t.city_name} · {t.market_name}</dd>
            <dt>Status</dt><dd><Chip status={t.status} /></dd>
            {t.status === 'rejected' && t.reviewed_at ? <><dt>Rejected</dt><dd>{t.reviewed_by_name || '—'} · {fmt.dt(t.reviewed_at)}</dd></> : null}
            {t.rejection_reason ? <><dt>Rejection reason</dt><dd style={{ color: 'var(--bad)' }}>{t.rejection_reason}</dd></> : null}
            {t.remarks ? <><dt>Remarks</dt><dd>{t.remarks}</dd></> : null}
            {t.latitude ? <><dt>Location</dt><dd><span className="mono small">{Number(t.latitude).toFixed(5)}, {Number(t.longitude).toFixed(5)}</span></dd></> : null}
          </dl></div>
          <div className="info-pair">
            <div className="info-block"><h4><Icon name="phone" />Mobile sale</h4><dl className="dl">
              <dt>Brand</dt><dd>{t.brand_name || <span className="muted">—</span>} <span className="muted mono small">{t.brand_code || ''}</span></dd>
              <dt>Model</dt><dd>{t.model_name ? <><b>{t.model_name}</b> <span className="muted mono small">{t.item_code}</span></> : <span className="muted">Not recorded</span>}</dd>
              <dt>Mobile quantity</dt><dd className="big-q">{t.mobile_qty === null ? '—' : fmt.n(t.mobile_qty)}</dd></dl></div>
            <div className="info-block"><h4><Icon name="gift" />Gift given</h4><dl className="dl">
              <dt>Gift</dt><dd><b>{t.gift_name}</b> <span className="muted mono small">{t.gift_id}</span></dd>
              <dt>Gift quantity</dt><dd className="big-q">{fmt.n(t.quantity)} <span className="muted small">{t.unit}</span></dd>
              <dt>Ratio</dt><dd>{t.mobile_qty ? `${Math.round((t.quantity / t.mobile_qty) * 1000) / 10}% gifts per phone` : '—'}</dd></dl></div>
          </div>
          <div className="panel"><div className="panel-h" style={{ minHeight: 38, padding: '8px 12px' }}><h3>Shop stock for this gift</h3></div>
            <div className="stat-row" style={{ borderTop: 0, gridTemplateColumns: 'repeat(3,1fr)' }}>
              <div><div className="v">{fmt.n(st.allocated)}</div><div className="l">Allocated</div></div>
              <div><div className="v">{fmt.n(st.distributed)}</div><div className="l">Given</div></div>
              <div><div className="v">{fmt.n(st.remaining)}</div><div className="l">Remaining</div></div>
            </div></div>
        </div>
      </div>
    );
  }
  return <Modal title={title} ariaLabel="Transaction" size="xwide" onClose={onClose} footer={footer}>{body}</Modal>;
}

/** Admin.openTransaction(code, onChange): read-only viewer; onChange runs when the modal closes. */
export function openTransaction(code, onChange) {
  let closed = false;
  let closeModal = null;
  const close = () => {
    if (closed) return;
    closed = true;
    if (closeModal) closeModal();
    if (onChange) onChange();
  };
  closeModal = openModal(() => <TransactionModal code={code} onClose={close} />);
  return close;
}

/* ------------------------------ Transaction list ------------------------------ */
const cols = [
  { label: 'Transaction', render: (t) => <><div className="cell-main mono">{t.transaction_id}</div><div className="cell-sub">{fmt.date(t.created_at)} · {fmt.time(t.created_at)}</div></> },
  { label: 'Promoter', render: (t) => <><div>{t.promoter_name}</div><div className="cell-sub mono">{t.promoter_code}</div></> },
  { label: 'Shop', render: (t) => <><div className="cell-main">{t.shop_name}</div><div className="cell-sub">{t.shop_id} · {t.market_name}</div></> },
  { label: 'Mobile sold', render: (t) => (t.model_name ? <><div className="cell-main">{t.brand_name || ''} {t.model_name}</div><div className="cell-sub mono">{t.item_code}</div></> : <span className="muted">—</span>) },
  { label: 'Mobile qty', num: true, render: (t) => <b>{t.mobile_qty === null ? '—' : fmt.n(t.mobile_qty)}</b> },
  { label: 'Gift given', key: 'gift_name' },
  { label: 'Gift qty', num: true, render: (t) => <b>{fmt.n(t.quantity)}</b> },
  { label: 'Proof photos', render: (t) => <div className="thumbs">
    {t.has_mobile_photo ? <ProofThumb title="Mobile sale proof" path={`/files/transactions/${t.transaction_id}/mobile-photo`} /> : <span className="thumb empty" title="No mobile photo" />}
    {t.has_photo ? <ProofThumb title="Gift proof" path={`/files/transactions/${t.transaction_id}/photo`} /> : <span className="thumb empty" title="No gift photo" />}</div> },
  { label: 'Status', render: (t) => <Chip status={t.status} /> },
  { label: '', cls: 'actions', render: (t) => <button className="btn sm ghost" title="Open" onClick={(e) => { e.stopPropagation(); openTransaction(t.transaction_id); }}><Icon name="eye" /></button> },
];

/**
 * All Transactions list (used by Reports → Gift Distribution). Legacy Admin.txnList(el, { base }).
 *   base: () => ({ from, to, city_id, … }) or a plain object with the same filters.
 *   reloadKey: change it to reload the list from page 1 (legacy: txns.state.page = 1; txns.load()).
 * A change of the base filters also reloads from page 1.
 */
export function TxnList({ base, reloadKey }) {
  const baseRef = useRef(base);
  baseRef.current = base;
  const getBase = () => (typeof baseRef.current === 'function' ? baseRef.current() : baseRef.current) || {};
  const list = usePaged({
    initial: { search: '', dir: 'desc' }, pageSize: 25,
    fetch: (st) => api('/transactions', { query: clean({ ...getBase(), search: st.search, dir: st.dir, page: st.page, pageSize: st.pageSize }) }),
  });
  const key = JSON.stringify([getBase(), reloadKey]);
  const lastKey = useRef(key);
  // (comparing with the last key also skips StrictMode's second mount run: no double load)
  useEffect(() => { if (lastKey.current === key) return; lastKey.current = key; list.set({}); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="filters" id="tlFilters"><SearchBox value={list.state.search} onChange={(v) => list.set({ search: v })} placeholder="Search TXN, shop, promoter, model" /></div>
      <div id="tlList">
        <PagedView list={list}>{(d) => (
          <DataTable cols={cols} rows={d.rows} rowKey="transaction_id" onRow={(t) => openTransaction(t.transaction_id)}
            empty={<EmptyState title="No transactions found" text="Try changing the filters or date range." />} />
        )}</PagedView>
      </div>
    </>
  );
}
