/* Number and date formatting (same output as the original app). */
const nf = new Intl.NumberFormat('en-US');
export { nf };

export const fmt = {
  n: (v) => (v === null || v === undefined || v === '' ? '—' : nf.format(Number(v))),
  pct: (v) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(1)}%`),
  /** DB timestamps are UTC 'YYYY-MM-DD HH:MM:SS' */
  toDate(s) { if (!s) return null; return new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z'); },
  date(s) { const d = fmt.toDate(s); return d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; },
  time(s) { const d = fmt.toDate(s); return d ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—'; },
  dt(s) { return s ? `${fmt.date(s)}, ${fmt.time(s)}` : '—'; },
  ago(s) {
    const d = fmt.toDate(s); if (!d) return '—';
    const sec = (Date.now() - d.getTime()) / 1000;
    if (sec < 60) return 'just now';
    if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)} h ago`;
    if (sec < 86400 * 7) return `${Math.floor(sec / 86400)} d ago`;
    return fmt.date(s);
  },
  today() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); },
  daysAgo(n) { const d = new Date(Date.now() - n * 86400000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); },
  monthStart() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; },
};

export const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2));

/** Minimal CSV parser (handles quotes, commas, CRLF). Returns rows as objects keyed by header. */
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim()));
  if (!nonEmpty.length) return [];
  const head = nonEmpty[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return nonEmpty.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}
