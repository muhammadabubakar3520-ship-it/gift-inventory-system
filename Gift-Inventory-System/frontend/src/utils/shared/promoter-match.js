/* =====================================================================
   Promoter matching for CSV import — shared by the server, the
   single-file engine and the screens.

   The promoter column may contain any of:
     - login email          wasif@company.com
     - promoter code        PRM-004
     - name                 Wasif Ali   /   M.Zeeshan
     - name + @domain       Wasif Ali@company.com   (common when emails are typed from names)
   Matching ignores case, spaces and dots.
   ===================================================================== */
const api = (function () {
  'use strict';

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  /** Split a cell into the parts we can match on. */
  function parse(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const at = raw.lastIndexOf('@');
    const local = at > 0 ? raw.slice(0, at).trim() : raw;
    const domain = at > 0 ? raw.slice(at + 1).trim().toLowerCase() : '';
    const email = EMAIL_RE.test(raw) ? raw.toLowerCase() : null;
    // A readable name: "Wasif Ali" stays, "wasif.ali" -> "Wasif Ali", "zeeshan" -> "Zeeshan"
    let name = local;
    if (!/\s/.test(name) && /[._-]/.test(name) && name === name.toLowerCase()) name = name.split(/[._-]+/).filter(Boolean).join(' ');
    if (name === name.toLowerCase()) name = name.replace(/\b\w/g, (c) => c.toUpperCase());
    return { raw, email, local, domain, name, key: norm(local), code: /^prm-\d+$/i.test(raw) ? raw.toUpperCase() : null };
  }

  /** Find the promoter a cell refers to. promoters: [{id, name, email, user_code}] */
  function find(value, promoters) {
    const p = parse(value);
    if (!p) return null;
    if (p.code) { const x = promoters.find((u) => String(u.user_code).toUpperCase() === p.code); if (x) return x; }
    if (p.email) { const x = promoters.find((u) => String(u.email).toLowerCase() === p.email); if (x) return x; }
    // name match ("Wasif Ali", "M.Zeeshan", "Wasif Ali@company.com")
    const byName = promoters.filter((u) => norm(u.name) === p.key);
    if (byName.length === 1) return byName[0];
    // email user part match ("zeeshan" -> zeeshan@company.com)
    const byLocal = promoters.filter((u) => norm(String(u.email).split('@')[0]) === p.key);
    if (byLocal.length === 1) return byLocal[0];
    return null;
  }

  /** Suggest a unique login email for a new promoter. */
  function newEmail(value, takenEmails) {
    const p = parse(value);
    const taken = new Set([...takenEmails].map((e) => String(e).toLowerCase()));
    if (p.email && !taken.has(p.email)) return p.email;
    const domain = /^[a-z0-9.-]+\.[a-z]{2,}$/.test(p.domain) ? p.domain : 'company.com';
    const base = String(p.name).toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'promoter';
    let email = `${base}@${domain}`;
    for (let i = 2; taken.has(email); i++) email = `${base}${i}@${domain}`;
    return email;
  }

  /** The promoter cell of a CSV row (several header spellings accepted). */
  const cell = (row) => row.promoter ?? row.promoter_email ?? row.promoter_name ?? row.promoter_code ?? '';

  const api = { parse, find, newEmail, cell, norm };
  return api;
})();
export default api;
