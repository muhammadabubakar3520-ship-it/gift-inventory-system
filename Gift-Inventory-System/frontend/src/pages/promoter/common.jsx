/* Promoter app shared pieces (from promoter.js): shell context, helpers, manual Shop ID entry, transaction rows/details. */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon';
import { Chip, AuthImage } from '../../components/ui';
import { Modal, openModal } from '../../components/Modal';
import { toastError } from '../../components/Toasts';
import { api } from '../../services/api';
import { fmt, uuid } from '../../utils/format';

/* ------------------------------ Shell context ------------------------------ */
/** setTop({ title, back, sub }), setNav(active), store (draft / brands cache / screen filters kept while the app is open). */
export const PromoterContext = createContext(null);
export const usePromoter = () => useContext(PromoterContext);

/** Top bar of the current screen (legacy top()). Pass null to keep the previous header. back = app path. */
export function useTop(title, { back, sub } = {}, on = true) {
  const { setTop } = usePromoter();
  useEffect(() => { if (on && title !== null && title !== undefined) setTop({ title, back: back || null, sub: sub || null }); }, [on, title, back, sub, setTop]);
}
/** Active bottom-nav item (legacy nav()). */
export function useNav(active, on = true) {
  const { setNav } = usePromoter();
  useEffect(() => { if (on) setNav(active); }, [on, active, setNav]);
}
/** Legacy go(hash): open a screen; the same screen again is re-run (fresh load). */
export function useGo() {
  const navigate = useNavigate();
  const loc = useLocation();
  return useCallback((path) => {
    if (path === loc.pathname) navigate(path, { replace: true, state: { n: Date.now() } });
    else navigate(path);
  }, [navigate, loc.pathname]);
}

/* ------------------------------ Helpers ------------------------------ */
export const plural = (name, q) => (q === 1 || /s$/i.test(name) ? name : name + 's');
/** "Wasif Ali" → Wasif, "M.Zeeshan" → Zeeshan, "M. Adnan" → Adnan */
export const firstName = (n) => {
  const words = String(n || '').split(/\s+/).filter(Boolean);
  for (const w of words) { const x = w.split('.').filter(Boolean).pop(); if (x && x.length > 1) return x; }
  return n || '';
};
export const ratioText = (r) => (r === null || r === undefined ? '—' : `${Number(r).toFixed(r % 1 ? 1 : 0)}%`);
export const enc = encodeURIComponent;

/** Clean a scanned / typed Shop ID (PK413451, SHP-0001, 413451). The server finds the shop. */
export function normalizeCode(rawCode) {
  const s = String(rawCode || '').trim().toUpperCase().replace(/\s+/g, '');
  return /^[A-Z0-9][A-Z0-9-]{0,39}$/.test(s) ? s : null;
}
export const loadShop = (code) => api('/promoter/shops/' + enc(code));

/** The sale being entered (kept in the app store while moving between steps). */
export function newDraft(shopData) {
  return { shop: shopData.shop, gifts: shopData.gifts, brandId: null, modelId: null, mobileQty: 1, mobilePhoto: null, mobileUrl: null,
    giftId: null, giftQty: 1, giftPhoto: null, giftUrl: null, remarks: '', clientRef: uuid(), geo: null };
}

/* ------------------------------ Manual Shop ID entry ------------------------------ */
function ManualEntryModal({ onClose, go }) {
  const [v, setV] = useState('');
  const [err, setErr] = useState('');
  const goTo = () => {
    const code = normalizeCode(v);
    if (!code) { setErr('Enter a valid Shop ID like PK413451'); return; }
    onClose(); go('/app/shop/' + enc(code));
  };
  return (
    <Modal title="Enter Shop ID manually" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" id="mGo" onClick={goTo}>Verify shop</button></>}>
      <div className="stack"><div className="muted small">Use this only when the QR code cannot be scanned.</div>
        <input className="input mono" id="mId" placeholder="e.g. PK413451" autoComplete="off" autoCapitalize="characters" style={{ height: 50, fontSize: 18, textTransform: 'uppercase' }}
          value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') goTo(); }} />
        <div className={`form-err ${err ? '' : 'hidden'}`} id="mErr2">{err}</div></div>
    </Modal>
  );
}
/** go = useGo() of the calling screen. */
export const manualEntry = (go) => openModal((close) => <ManualEntryModal onClose={close} go={go} />);

/* ------------------------------ Transactions ------------------------------ */
export function TxnRow({ t }) {
  return (
    <button className="list-item txn-item" data-txn={t.transaction_id} onClick={() => showTxn(t.transaction_id)}>
      <div className="main"><div className="t">{t.brand_name ? <>{t.brand_name} {t.model_name}</> : t.model_name || t.gift_name}</div>
        <div className="s">{t.mobile_qty ? <><b>{fmt.n(t.mobile_qty)}</b> sold · </> : ''}{t.gift_name} × {fmt.n(t.quantity)} · {t.shop_name}</div>
        <div className="s"><span className="mono">{t.transaction_id}</span> · {fmt.dt(t.created_at)}</div>
        {t.rejection_reason ? <div className="reason">Rejected: {t.rejection_reason}</div> : null}</div>
      <div className="right"><Chip status={t.status} /></div></button>
  );
}

export async function showTxn(code) {
  let t;
  try { t = await api('/promoter/transactions/' + enc(code)); } catch (e) { toastError(e); return; }
  openModal((close) => (
    <Modal title={t.transaction_id} onClose={close} footer={<button className="btn block" onClick={close}>Close</button>}>
      <div className="stack">
        <div><Chip status={t.status} />{t.rejection_reason ? <div className="callout bad" style={{ marginTop: 8 }}>Rejected: {t.rejection_reason}</div> : null}</div>
        <dl className="dl" style={{ gridTemplateColumns: '120px 1fr' }}>
          <dt>Shop</dt><dd>{t.shop_name} <span className="muted mono">{t.shop_id}</span></dd>
          <dt>Date / time</dt><dd>{fmt.dt(t.created_at)}</dd>
          <dt>Mobile</dt><dd>{t.brand_name || ''} {t.model_name || '—'} {t.item_code ? <span className="muted mono">{t.item_code}</span> : null}</dd>
          <dt>Quantity sold</dt><dd><b>{t.mobile_qty ? fmt.n(t.mobile_qty) : '—'}</b></dd>
          <dt>Gift</dt><dd>{t.gift_name}</dd>
          <dt>Quantity given</dt><dd><b>{fmt.n(t.quantity)}</b> {t.unit}</dd>
          {t.remarks ? <><dt>Remarks</dt><dd>{t.remarks}</dd></> : null}
          {t.reviewed_at ? <><dt>Reviewed</dt><dd>{fmt.dt(t.reviewed_at)}</dd></> : null}
        </dl>
        <div className="proof-pair">
          <figure><figcaption>MOBILE SALE PROOF</figcaption>{t.has_mobile_photo ? <AuthImage path={`/files/transactions/${t.transaction_id}/mobile-photo`} alt="Mobile sale proof" /> : <div className="nophoto">No photo</div>}</figure>
          <figure><figcaption>GIFT PROOF</figcaption>{t.has_photo ? <AuthImage path={`/files/transactions/${t.transaction_id}/photo`} alt="Gift proof" /> : <div className="nophoto">No photo</div>}</figure>
        </div></div>
    </Modal>
  ));
}

/** Gift picture or the gift icon (legacy <span class="gift-ico">). */
export const GiftIco = ({ g }) => (
  <span className="gift-ico">{g.has_image ? <AuthImage path={`/files/gifts/${g.gift_id}/image`} alt="" /> : <Icon name="gift" />}</span>
);
