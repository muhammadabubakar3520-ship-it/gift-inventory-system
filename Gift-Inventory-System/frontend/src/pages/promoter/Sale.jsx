/* Promoter sale wizard (promoter.js saleScreen(), mobileStep(), giftStep(), reviewStep(), success()). */
import { useEffect, useReducer, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import BusyButton from '../../components/BusyButton';
import { EmptyState, LoadingBlock, ErrorBlock } from '../../components/ui';
import { toast, toastError } from '../../components/Toasts';
import { useAuth } from '../../context/AuthContext';
import { useHoldLive } from '../../context/SyncContext';
import { api } from '../../services/api';
import { fmt } from '../../utils/format';
import { useTop, useNav, useGo, usePromoter, loadShop, newDraft, plural, GiftIco, enc } from './common';

async function compress(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const max = 1600;
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
    return blob && blob.size < file.size ? blob : file;
  } catch (_) { return file; }
}

const STEPS = [['mobile', 'Mobile Sold'], ['gift', 'Gift Given'], ['review', 'Review']];
function Stepper({ cur }) {
  const ci = STEPS.findIndex((x) => x[0] === cur);
  return <ol className="stepper">{STEPS.map(([k, l], i) => <li key={k} className={i < ci ? 'done' : i === ci ? 'on' : ''}><span>{i < ci ? <Icon name="check" /> : i + 1}</span>{l}</li>)}</ol>;
}
const ShopStrip = ({ s }) => <div className="shop-strip"><Icon name="store" /><div><b>{s.shop_name}</b><span className="mono">{s.shop_id}</span> · {s.market_name}, {s.city_name}</div></div>;
const FormErr = ({ id, errs }) => <div className={`form-err ${errs[id] ? '' : 'hidden'}`} id={id}>{errs[id] || ''}</div>;
const insufficient = (g) => `Insufficient Gift Inventory. Only ${g.available} ${plural(g.gift_name, g.available)} ${g.available === 1 ? 'is' : 'are'} available for this shop.`;

/** Photo block: big TAKE PHOTO button + gallery upload, then preview with retake. */
function PhotoBlock({ kind, label, d, showErr, hideErr, bump }) {
  const [preparing, setPreparing] = useState(false);
  const has = d[kind + 'Photo']; const url = d[kind + 'Url'];
  const onFile = async (e) => {
    const f = e.target.files[0];
    e.target.value = ''; // the same photo can be chosen again
    if (!f) return;
    const errId = kind + 'PErr';
    if (!/^image\//.test(f.type)) { showErr(errId, 'Please choose an image file.'); return; }
    setPreparing(true);
    const p = await compress(f);
    if (p.size > 6 * 1024 * 1024) { showErr(errId, 'Photo is too large (max 6 MB).'); setPreparing(false); return; }
    if (d[kind + 'Url']) URL.revokeObjectURL(d[kind + 'Url']);
    d[kind + 'Photo'] = p; d[kind + 'Url'] = URL.createObjectURL(p);
    hideErr(errId);
    setPreparing(false);
    bump();
  };
  let body;
  if (preparing) body = <LoadingBlock text="Preparing photo…" />;
  else if (has) {
    body = (
      <div className="photo-preview"><img src={url} alt={`${label} preview`} /><span className="meta">{label} · {(has.size / 1024).toFixed(0)} KB</span>
        <label className="btn sm retake"><Icon name="camera" />Retake<input type="file" accept="image/*" capture="environment" hidden data-photo={kind} onChange={onFile} /></label></div>
    );
  } else {
    body = (
      <>
        <label className="btn primary block big photo-btn"><Icon name="camera" />TAKE {kind === 'mobile' ? 'MOBILE' : 'GIFT'} PHOTO<input type="file" accept="image/*" capture="environment" hidden data-photo={kind} onChange={onFile} /></label>
        <label className="btn block gallery-btn"><Icon name="image" />Upload from gallery<input type="file" accept="image/jpeg,image/png,image/webp" hidden data-photo={kind} onChange={onFile} /></label>
      </>
    );
  }
  return <div id={kind + 'Photo'}>{body}</div>;
}

/** Quantity input with − / + buttons. The draft value follows what is typed; blur and the buttons clamp it. */
function QtyBox({ id, value, max, onSet }) {
  const [text, setText] = useState(String(value));
  const apply = (v) => { v = Math.floor(Number(v) || 0); if (v < 1) v = 1; if (max && v > max) v = max; onSet(v); setText(String(v)); };
  return (
    <div className="qty-box"><button type="button" data-qm={id} aria-label="Decrease" onClick={() => apply(value - 1)}>−</button>
      <input id={id} type="number" inputMode="numeric" pattern="[0-9]*" min="1" max={max || undefined} value={text} aria-label="Quantity"
        onChange={(e) => { setText(e.target.value); onSet(Math.floor(Number(e.target.value) || 0)); }}
        onBlur={(e) => { if (e.target.value !== '') apply(e.target.value); }} />
      <button type="button" data-qp={id} aria-label="Increase" onClick={() => apply(value + 1)}>+</button></div>
  );
}

/* Step 1 — MOBILE SOLD */
function MobileStep({ d, brands, errs, ui, onNext }) {
  const s = d.shop;
  const b = brands.find((x) => x.id === d.brandId);
  return (
    <>
      <Stepper cur="mobile" /><ShopStrip s={s} />
      <div className="sec-title"><Icon name="phone" />MOBILE SOLD</div>
      <div className="field-l"><span>Mobile Brand <span className="req">*</span></span></div>
      {brands.length ? <div className="brand-pick">{brands.map((x) => (
        <button type="button" key={x.id} className={`brand-opt ${x.id === d.brandId ? 'on' : ''}`} data-b={x.id}
          onClick={() => { if (d.brandId !== x.id) { d.brandId = x.id; d.modelId = null; } ui.draw(); }}>{x.brand_name}<span>{x.models.length} model{x.models.length === 1 ? '' : 's'}</span></button>))}</div>
        : <div className="callout warn">No mobile brands are set up. Ask your admin to add brands and models.</div>}
      <FormErr id="bErr" errs={errs} />
      <div className="field-l"><span>Mobile Model <span className="req">*</span></span>{b ? <span className="muted small">{b.brand_name} models</span> : null}</div>
      {b ? <div className="model-pick">{b.models.map((m) => (
        <button type="button" key={m.id} className={`model-opt ${m.id === d.modelId ? 'on' : ''}`} data-m={m.id}
          onClick={() => { d.modelId = m.id; ui.hideErr('mErr'); }}><b>{m.model_name}</b><span>{m.item_code}</span></button>))}</div>
        : <div className="hint-box">Select a brand first</div>}
      <FormErr id="mErr" errs={errs} />
      <div className="field-l"><span>Quantity Sold <span className="req">*</span></span></div>
      <QtyBox key={'mQty' + ui.drawN} id="mQty" value={d.mobileQty} onSet={(v) => { d.mobileQty = v; ui.hideErr('mqErr'); }} />
      <FormErr id="mqErr" errs={errs} />
      <div className="field-l"><span>Mobile Sale Proof <span className="req">*</span></span><span className="muted small">Photo of the phone / bill</span></div>
      <PhotoBlock key={'mp' + ui.drawN} kind="mobile" label="Mobile sale proof" d={d} showErr={ui.showErr} hideErr={ui.hideErr} bump={ui.bump} />
      <FormErr id="mobilePErr" errs={errs} />
      <div className="sticky-submit"><button className="btn primary block big" id="toGift" onClick={onNext}>NEXT: GIFT <Icon name="chevron" /></button></div>
    </>
  );
}

/* Step 2 — GIFT GIVEN TO CUSTOMER */
function GiftStep({ d, errs, ui, onNext }) {
  const s = d.shop;
  const g = d.gifts.find((x) => x.gift_id === d.giftId);
  return (
    <>
      <Stepper cur="gift" /><ShopStrip s={s} />
      <div className="sec-title"><Icon name="gift" />GIFT GIVEN TO CUSTOMER</div>
      <div className="field-l"><span>Select Gift <span className="req">*</span></span><span className="muted small">Available at this shop</span></div>
      <div className="pm-card gift-list">{d.gifts.length ? d.gifts.map((x) => (
        <button type="button" key={x.gift_id} className={`list-item gift-opt ${x.gift_id === d.giftId ? 'on' : ''}`} data-g={x.gift_id} disabled={x.available <= 0}
          onClick={() => {
            if (x.available <= 0) return;
            d.giftId = x.gift_id;
            if (d.giftQty > x.available) d.giftQty = Math.max(1, x.available);
            ui.draw();
          }}>
          <GiftIco g={x} />
          <div className="main"><div className="t">{x.gift_name}</div><div className="s">Available: <b>{fmt.n(x.available)}</b></div></div>
          <span className="radio" /></button>)) : <EmptyState title="No gifts at this shop" text="Contact your admin." />}</div>
      <FormErr id="gErr" errs={errs} />
      {g ? <>
        <div className="field-l"><span>Quantity Given <span className="req">*</span></span><span className="muted small">Available: {fmt.n(g.available)}</span></div>
        <QtyBox key={'gQty' + ui.drawN} id="gQty" value={d.giftQty} max={null}
          onSet={(v) => { d.giftQty = v; if (v > g.available) ui.showErr('gqErr', insufficient(g)); else ui.hideErr('gqErr'); }} />
      </> : null}
      <FormErr id="gqErr" errs={errs} />
      <div className="field-l"><span>Gift Proof <span className="req">*</span></span><span className="muted small">Photo of the gift handed over</span></div>
      <PhotoBlock key={'gp' + ui.drawN} kind="gift" label="Gift proof" d={d} showErr={ui.showErr} hideErr={ui.hideErr} bump={ui.bump} />
      <FormErr id="giftPErr" errs={errs} />
      <div className="sticky-submit"><button className="btn primary block big" id="toReview" onClick={onNext}>NEXT: REVIEW <Icon name="chevron" /></button></div>
    </>
  );
}

/* Step 3 — REVIEW */
function ReviewStep({ d, brands, ui, onSubmit, onEdit }) {
  const { user: u } = useAuth();
  const s = d.shop;
  // picked once when the step opens (legacy renders the summary once; a 409 stock refresh must not break it)
  const [{ brand, model, g }] = useState(() => {
    const b = brands.find((x) => x.id === d.brandId);
    return { brand: b, model: b.models.find((m) => m.id === d.modelId), g: d.gifts.find((x) => x.gift_id === d.giftId) };
  });
  return (
    <>
      <Stepper cur="review" />
      <div className="pm-card review">
        <h3 className="rv-title">SALE SUMMARY</h3>
        <dl className="vlist"><dt>Shop</dt><dd><b>{s.shop_name}</b></dd><dt>Shop ID</dt><dd className="mono">{s.shop_id}</dd><dt>Promoter</dt><dd>{u.name}</dd></dl>
        <div className="rv-sec"><Icon name="phone" />MOBILE SALE</div>
        <dl className="vlist"><dt>Brand</dt><dd>{brand.brand_name}</dd><dt>Model</dt><dd><b>{model.model_name}</b> <span className="muted mono small">{model.item_code}</span></dd><dt>Quantity Sold</dt><dd className="big-n">{fmt.n(d.mobileQty)}</dd></dl>
        <div className="rv-photo"><span>Mobile Sale Proof</span><img src={d.mobileUrl} alt="Mobile sale proof" /></div>
        <div className="rv-sec"><Icon name="gift" />GIFT GIVEN</div>
        <dl className="vlist"><dt>Gift</dt><dd><b>{g.gift_name}</b></dd><dt>Quantity</dt><dd className="big-n">{fmt.n(d.giftQty)}</dd></dl>
        <div className="rv-photo"><span>Gift Proof</span><img src={d.giftUrl} alt="Gift proof" /></div>
        <div className="field-l" style={{ marginTop: 14 }}><span>Remarks <span className="muted" style={{ fontWeight: 500 }}>(optional)</span></span></div>
        <textarea className="input" id="remarks" maxLength={300} placeholder="e.g. customer name or bill number" style={{ minHeight: 60, borderRadius: 10 }}
          value={d.remarks} onChange={(e) => { d.remarks = e.target.value; ui.bump(); }} />
      </div>
      <div className="review-actions"><button className="btn big" id="editBtn" onClick={onEdit}><Icon name="edit" />EDIT</button>
        <BusyButton className="btn primary big" id="submitBtn" busyText="Submitting…" onClick={() => onSubmit({ s, brand, model, g })}><Icon name="check" />SUBMIT SALE</BusyButton></div>
    </>
  );
}

function Success({ r, shop, brand, model, gift, mobileQty, giftQty }) {
  return (
    <div className="pm-card success">
      <div className="tick"><Icon name="check" /></div>
      <h2>TRANSACTION SUCCESSFUL</h2>
      <div className="txn">Transaction ID: {r.transaction_id}</div>
      <dl className="vlist left">
        <dt>Shop</dt><dd><b>{shop.shop_name}</b></dd>
        <dt>Mobile</dt><dd>{brand.brand_name} {model.model_name}</dd>
        <dt>Quantity Sold</dt><dd><b>{fmt.n(mobileQty)}</b></dd>
        <dt>Gift</dt><dd>{gift.gift_name}</dd>
        <dt>Quantity Given</dt><dd><b>{fmt.n(giftQty)}</b></dd>
      </dl>
      <p className="muted small">Saved. The gift quantity has been deducted from the shop&apos;s stock.</p>
      <div className="btn-stack">
        <Link className="btn primary big" to="/app/home"><Icon name="home" />Back to Dashboard</Link>
        <Link className="btn" to={`/app/shop/${enc(shop.shop_id)}`}><Icon name="plus" />Record another sale at this shop</Link>
        <Link className="btn" to="/app/scan"><Icon name="scan" />Scan next shop</Link>
      </div></div>
  );
}

export default function Sale() {
  const { code, step: stepParam } = useParams();
  const step = stepParam || 'mobile';
  const { store } = usePromoter();
  const go = useGo();
  // draft and brands already in memory and the step is valid: show it at once (legacy renders synchronously)
  const [phase, setPhase] = useState(() => (!store.draft || store.draft.shop.shop_id !== code ? 'loading'
    : store.brands && !(step === 'gift' && !mobileValid(true)) && !(step === 'review' && (!mobileValid(true) || !giftValid(true))) ? 'ready' : 'pending'));
  const [loadErr, setLoadErr] = useState('');
  const [done, setDone] = useState(null);
  const [errs, setErrs] = useState({});
  const [drawN, setDrawN] = useState(0);
  const [, bump] = useReducer((x) => x + 1, 0);
  useHoldLive(); // never interrupted by live sync; the server re-checks stock on submit
  useNav(done ? '' : 'scan');

  const d = store.draft;
  const path = (st) => `/app/sale/${enc(code)}/${st}`; // redirects use the scanned code
  const stepPath = (st) => `/app/sale/${enc(store.draft.shop.shop_id)}/${st}`; // the steps use the shop's ID
  const showErr = (id, msg) => { setErrs((e) => ({ ...e, [id]: msg })); return false; };
  const hideErr = (id) => setErrs((e) => ({ ...e, [id]: '' }));
  const ui = { showErr, hideErr, bump, drawN, draw: () => { setErrs({}); setDrawN((n) => n + 1); } };

  function mobileValid(silent) {
    const x = store.draft;
    const brand = store.brands && store.brands.find((b) => b.id === x.brandId);
    const model = brand && brand.models.find((m) => m.id === x.modelId);
    if (!brand) return silent ? false : showErr('bErr', 'Please select the mobile brand.');
    if (!model) return silent ? false : showErr('mErr', 'Please select the mobile model.');
    if (!(x.mobileQty >= 1)) return silent ? false : showErr('mqErr', 'Mobile quantity must be greater than zero.');
    if (!x.mobilePhoto) return silent ? false : showErr('mobilePErr', 'Please take or upload the mobile sale proof photo.');
    return true;
  }
  function giftValid(silent) {
    const x = store.draft;
    const g = x.gifts.find((y) => y.gift_id === x.giftId);
    if (!g) return silent ? false : showErr('gErr', 'Please select the gift given to the customer.');
    if (!(x.giftQty >= 1)) return silent ? false : showErr('gqErr', 'Gift quantity must be greater than zero.');
    if (x.giftQty > g.available) return silent ? false : showErr('gqErr', insufficient(g));
    if (!x.giftPhoto) return silent ? false : showErr('giftPErr', 'Please take or upload the gift proof photo.');
    return true;
  }

  useEffect(() => {
    let dead = false;
    (async () => {
      if (!store.draft || store.draft.shop.shop_id !== code) {
        try {
          const shopData = await loadShop(code);
          if (dead) return;
          store.draft = newDraft(shopData);
        } catch (e) { if (dead) return; toastError(e); go('/app/shop/' + enc(code)); return; }
      }
      if (!store.brands) {
        try {
          const b = await api('/promoter/brands');
          if (dead) return;
          store.brands = b;
        } catch (e) { if (dead) return; setLoadErr(e.message); setPhase('error'); return; }
      }
      if (!store.draft.geo && navigator.geolocation) navigator.geolocation.getCurrentPosition((p) => { if (store.draft) store.draft.geo = p.coords; }, () => {}, { timeout: 8000, maximumAge: 120000 });
      if (step === 'gift' && !mobileValid(true)) { go(path('mobile')); return; }
      if (step === 'review' && (!mobileValid(true) || !giftValid(true))) { go(path(mobileValid(true) ? 'gift' : 'mobile')); return; }
      setPhase('ready');
    })();
    return () => { dead = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = phase === 'ready' && !done && d;
  const s = ready ? d.shop : null;
  const kind = step === 'gift' || step === 'review' ? step : 'mobile';
  useTop(done ? 'Sale Saved' : ready ? (kind === 'review' ? 'Review Sale' : 'Record Sale') : null, {
    back: !ready ? null : kind === 'mobile' ? '/app/shop/' + enc(s.shop_id) : kind === 'gift' ? stepPath('mobile') : stepPath('gift'),
    sub: ready ? s.shop_id : null,
  });

  const submit = async ({ s: shop, brand, model, g }) => {
    const x = store.draft;
    const fd = new FormData();
    fd.append('shop_id', shop.shop_id);
    fd.append('brand_id', String(x.brandId)); fd.append('model_id', String(x.modelId)); fd.append('mobile_qty', String(x.mobileQty));
    fd.append('gift_id', x.giftId); fd.append('gift_qty', String(x.giftQty));
    fd.append('client_ref', x.clientRef);
    fd.append('remarks', (x.remarks || '').trim());
    if (x.geo) { fd.append('latitude', String(x.geo.latitude)); fd.append('longitude', String(x.geo.longitude)); }
    fd.append('mobile_photo', x.mobilePhoto, 'mobile-proof.jpg');
    fd.append('gift_photo', x.giftPhoto, 'gift-proof.jpg');
    try {
      const r = await api('/promoter/transactions', { method: 'POST', form: fd });
      const result = { r, shop, brand, model, gift: g, mobileQty: x.mobileQty, giftQty: x.giftQty };
      if (x.mobileUrl) URL.revokeObjectURL(x.mobileUrl);
      if (x.giftUrl) URL.revokeObjectURL(x.giftUrl);
      store.draft = null;
      window.scrollTo(0, 0);
      setDone(result);
      if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
    } catch (ex) {
      if (ex.status === 0) toast('No connection. Your sale is kept — tap SUBMIT SALE again when you are online.', 'warn', 7000);
      else {
        toastError(ex);
        if (ex.status === 409 && /Insufficient Gift Inventory/.test(ex.message)) { try { const fresh = await loadShop(shop.shop_id); x.gifts = fresh.gifts; } catch (_) { /* ignore */ } }
      }
    }
  };

  if (done) return <Success {...done} />;
  if (phase === 'error') return <ErrorBlock message={loadErr} />;
  if (phase === 'loading') return <LoadingBlock text="Verifying shop…" />;
  if (!ready) return null;
  if (kind === 'gift') return <GiftStep d={d} errs={errs} ui={ui} onNext={() => { if (giftValid(false)) go(stepPath('review')); }} />;
  if (kind === 'review') return <ReviewStep d={d} brands={store.brands} ui={ui} onSubmit={submit} onEdit={() => go(stepPath('mobile'))} />;
  return <MobileStep d={d} brands={store.brands} errs={errs} ui={ui}
    onNext={() => { if (mobileValid(false)) go(stepPath('gift')); else window.scrollTo({ top: 0, behavior: 'smooth' }); }} />;
}
