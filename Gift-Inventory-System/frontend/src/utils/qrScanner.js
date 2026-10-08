/* =====================================================================
   qrScanner.js — full-screen camera QR scanner (from public/js/qr-scanner.js).
     open({ title, onCode(text) -> true to close, onManual(), onClose() }) -> stop()
   Uses the browser's BarcodeDetector when available, otherwise jsQR (loaded on demand).
   Asks for camera permission; falls back to "scan from photo" when the
   live camera is not available (e.g. no HTTPS, or denied).
   ===================================================================== */
import { ensureVendor } from './vendor';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => (v === null || v === undefined ? '' : String(v).replace(/[&<>"']/g, (c) => ESC[c]));
const P = {
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  flash: '<path d="M13 2L3 14h9l-1 8 10-12h-9z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  camera: '<path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="4"/>',
};
const icon = (name, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

export function open({ title = 'Scan shop QR code', onCode, onManual, onClose, wrongMsg = 'That QR code is not a shop code. Try again.', manualLabel = 'Enter Shop ID' } = {}) {
  const canLive = window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
  const jsqrReady = ensureVendor('jsqr').catch(() => {}); // jsQR is needed when BarcodeDetector is missing
  const overlay = document.createElement('div');
  overlay.className = 'scanner';
  overlay.innerHTML = `
      <video playsinline muted autoplay></video>
      <div class="frame"><div class="laser"></div></div>
      <div class="bar"><button id="scClose" aria-label="Close">${icon('x')}</button><b>${esc(title)}</b><button id="scTorch" class="hidden" aria-label="Torch">${icon('flash')}</button></div>
      <div class="msg hidden" id="scMsg"><div class="box"></div></div>
      <div class="bottom"><div class="hint" id="scHint">Allow camera access, then hold the QR code inside the frame</div>
        <div class="row"><label class="btn">${icon('image')}Scan from photo<input type="file" accept="image/*" id="scFile" hidden></label>
        <button class="btn" id="scManual">${icon('edit')}${esc(manualLabel)}</button></div></div>`;
  document.body.appendChild(overlay);
  const $ = (sel) => overlay.querySelector(sel);
  const video = $('video');
  let stream = null, stopped = false, timer = null;
  const detector = 'BarcodeDetector' in window ? (() => { try { return new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (_) { return null; } })() : null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const hint = (t) => { $('#scHint').textContent = t; };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    overlay.remove();
  };
  const msg = (text, actions) => {
    const m = $('#scMsg');
    m.classList.remove('hidden');
    m.querySelector('.box').innerHTML = `<div style="margin-bottom:12px">${esc(text)}</div>${actions || ''}`;
  };
  const found = (text) => {
    if (navigator.vibrate) navigator.vibrate(80);
    const ok = onCode ? onCode(String(text || '').trim()) : true;
    if (ok === false) { hint(wrongMsg); return false; }
    stop();
    return true;
  };
  async function decode(source, w, h) {
    if (detector) {
      try { const r = await detector.detect(source); if (r.length) return r[0].rawValue; } catch (_) { /* fall back to jsQR */ }
    }
    await jsqrReady;
    if (!window.jsQR) return null;
    const scale = Math.min(1, 720 / Math.max(w, h));
    canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const r = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
    return r ? r.data : null;
  }
  async function tick() {
    if (stopped) return;
    if (video.readyState >= 2 && video.videoWidth) {
      const t = await decode(video, video.videoWidth, video.videoHeight);
      if (t && found(t)) return;
    }
    if (stopped) return;
    timer = setTimeout(tick, 160);
  }
  async function fromPhoto(e) {
    const f = e.target.files[0];
    if (!f) return;
    hint('Reading photo…');
    try {
      const bmp = await createImageBitmap(f);
      const t = await decode(bmp, bmp.width, bmp.height);
      if (!t) { hint('No QR code found in that photo. Move closer and try again.'); return; }
      found(t);
    } catch (_) { hint('Could not read that photo.'); }
  }
  const photoBtn = (id) => `<label class="btn primary">${icon('camera')}Take photo of QR<input type="file" accept="image/*" capture="environment" hidden id="${id}"></label>`;

  $('#scClose').onclick = () => { stop(); if (onClose) onClose(); };
  $('#scManual').onclick = () => { stop(); if (onManual) onManual(); };
  $('#scFile').onchange = fromPhoto;

  if (!canLive) {
    msg('The live camera needs a secure (HTTPS) connection. Take a photo of the QR code instead, or enter the Shop ID.', photoBtn('scFile2'));
    $('#scFile2').onchange = fromPhoto;
  } else {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((s) => {
        if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        video.srcObject = s;
        video.play().catch(() => {});
        hint('Hold the shop QR code inside the frame');
        const track = s.getVideoTracks()[0];
        const caps = track.getCapabilities ? track.getCapabilities() : {};
        if (caps.torch) {
          const tb = $('#scTorch');
          let on = false;
          tb.classList.remove('hidden');
          tb.onclick = () => { on = !on; track.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {}); };
        }
        tick();
      })
      .catch((err) => {
        if (stopped) return;
        const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
        msg(denied ? 'Camera permission was denied. Allow camera access in your browser settings, or take a photo of the QR code.' : 'Could not start the camera. Take a photo of the QR code instead.', photoBtn('scFile3'));
        $('#scFile3').onchange = fromPhoto;
      });
  }
  return stop;
}

const QRScanner = { open };
export default QRScanner;
