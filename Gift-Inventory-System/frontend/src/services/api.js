/* =====================================================================
   Central API service. Every screen talks to the backend through api().
   The backend address comes from VITE_API_URL (e.g. http://localhost:5000/api
   locally, https://YOUR-RENDER-BACKEND.onrender.com/api in production).
   No data is kept in the browser: only the sign-in token of this device.
   ===================================================================== */

export const API_URL = String(import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '');
/** Origin of the backend (used by Socket.IO). */
export const API_ORIGIN = (() => {
  try { return new URL(API_URL, window.location.href).origin; } catch (_) { return window.location.origin; }
})();

/** Random id of this browser tab (sent as X-Client-Id so live sync can skip the tab's own changes). */
export const CLIENT_ID = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');

/* ------------------------------ Session (sign-in token only) ------------------------------ */
const KEY = 'gims.session';
export const session = {
  get() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (_) { return null; } },
  set(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) { /* private mode */ } },
  clear() { try { localStorage.removeItem(KEY); } catch (_) { /* ignore */ } },
  token() { const s = session.get(); return s && s.token; },
  user() { const s = session.get(); return s && s.user; },
};

export class ApiError extends Error {
  constructor(status, msg, details) { super(msg); this.status = status; this.details = details; }
}

/* ------------------------------ Progress bar ------------------------------ */
let inflight = 0;
function progress(delta) {
  inflight += delta;
  let bar = document.querySelector('.topbar-progress');
  if (!bar) { bar = document.createElement('div'); bar.className = 'topbar-progress'; document.body.appendChild(bar); }
  if (inflight > 0) { bar.style.opacity = '1'; bar.style.width = '70%'; } else {
    bar.style.width = '100%';
    setTimeout(() => { if (inflight === 0) { bar.style.opacity = '0'; bar.style.width = '0'; } }, 250);
  }
}

const url = (path, query) => {
  let u = API_URL + path;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') qs.set(k, v);
    const s = qs.toString();
    if (s) u += (u.includes('?') ? '&' : '?') + s;
  }
  return u;
};

/**
 * api('/gifts', { method, body, form, query, raw, quiet })
 *   body  → JSON;  form → FormData (file uploads);  raw → returns the fetch Response (downloads)
 *   quiet → no progress bar;  ignore401 → no "session ended" handling (sign-out call)
 */
export async function api(path, { method = 'GET', body, form, query, raw: rawResp, quiet, ignore401 } = {}) {
  const headers = { 'X-Client-Id': CLIENT_ID };
  const t = session.token();
  if (t) headers.Authorization = 'Bearer ' + t;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  if (!quiet) progress(1);
  let res;
  try {
    res = await fetch(url(path, query), { method, headers, body: payload, cache: 'no-store' });
  } catch (_) {
    throw new ApiError(0, 'No connection to the server. Please check your internet connection and try again.');
  } finally {
    if (!quiet) progress(-1);
  }
  if (res.status === 401 && !path.startsWith('/auth/login') && !ignore401) {
    session.clear();
    window.dispatchEvent(new CustomEvent('gims:unauthorized'));
    throw new ApiError(401, 'Your session has ended. Please sign in again.');
  }
  if (rawResp && res.ok) return res;
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(() => ({})) : null;
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || `Request failed (${res.status})`, data && data.details);
  return data;
}

/** Is the backend reachable? (sign-in page) */
export async function health() {
  try { const r = await fetch(API_URL + '/health', { cache: 'no-store' }); return r.ok; } catch (_) { return false; }
}

/** Save a Blob as a file download. */
export async function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** Download a server-generated file (CSV, backup, QR image) with the sign-in token. */
export async function download(path, query, filename) {
  const res = await api(path, { query, raw: true });
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const m = cd.match(/filename="([^"]+)"/);
  await saveBlob(blob, filename || (m ? m[1] : 'download'));
}

/** Protected images (proof photos, gift images): fetched with the token, cached as blob URLs. */
const imgCache = new Map();
export async function imageUrl(path) {
  if (imgCache.has(path)) return imgCache.get(path);
  const p = api(path, { raw: true, quiet: true }).then(async (res) => URL.createObjectURL(await res.blob()));
  imgCache.set(path, p);
  p.catch(() => imgCache.delete(path));
  return p;
}
/** Forget cached images (e.g. after a gift image was replaced). */
export function forgetImage(path) { if (path) imgCache.delete(path); else imgCache.clear(); }
