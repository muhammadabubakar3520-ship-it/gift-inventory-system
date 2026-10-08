'use strict';
/**
 * MongoDB storage for the business logic.
 *
 *  load()        read every collection from MongoDB into the working copy
 *  save(S)       write back ONLY the documents that changed since the last load/save
 *                (upserts by numeric id, deletes for removed records), then raise the data revision
 *  ensureFresh() reload when the revision in MongoDB changed (another server instance wrote data)
 *  files.*       photos and images in the stored_files collection
 *
 * MongoDB is the only place where data is kept. The working copy is a cache that is rebuilt from
 * MongoDB at start, after a failed save and whenever the revision in MongoDB moves on.
 */
const crypto = require('crypto');
const { collections, Counter, Setting, StoredFile, WriteLock } = require('../models');
const config = require('../config/env');

const HIDE = { _id: 0, createdAt: 0, updatedAt: 0, __v: 0 };
const REV = '__revision';
const LOCK_MS = 30000;      // a held lock is extended while the write runs
const LOCK_WAIT_MS = 25000; // how long a write waits for another instance
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (row) => JSON.parse(JSON.stringify(row)); // drops undefined values

class MongoStore {
  constructor(G) {
    this.G = G;
    this.saved = {};          // data set -> Map(id -> JSON text of the saved document)
    this.savedSettings = '';
    this.savedFlags = '';
    this.savedSeq = new Map();
    this.rev = null;          // data revision this working copy belongs to
    this.fresh = false;
    this.lastCheck = 0;
    this.writeCount = 0;      // goes up with every save that wrote something
    this.instance = crypto.randomBytes(6).toString('hex');
    this.lockSeq = 0;
    this.files = this.makeFiles();
  }

  /** Current data revision in MongoDB. */
  async revision() {
    const c = await Counter.findOne({ name: REV }, { value: 1 }).lean();
    return c ? c.value : 0;
  }

  async load() {
    // A consistent picture: retry when another instance wrote while we were reading.
    for (let i = 0; ; i++) {
      const rev = await this.revision();
      const S = await this.readAll();
      if (i >= 8 || ((await this.revision()) === rev && !(await this.lockedByOther()))) {
        this.G.setState(S);
        this.snapshot();
        this.rev = rev;
        this.fresh = true;
        this.lastCheck = Date.now();
        return;
      }
      await sleep(60 + i * 40);
    }
  }

  async readAll() {
    const S = {};
    await Promise.all(Object.entries(collections).map(async ([key, M]) => { S[key] = await M.find({}, HIDE).sort({ id: 1 }).lean(); }));
    const settings = await Setting.find({}, { _id: 0, key: 1, value: 1 }).lean();
    const get = (k, d) => { const s = settings.find((x) => x.key === k); return s && s.value && typeof s.value === 'object' ? s.value : d; };
    S.settings = get('settings', { sales_mode: 'submitted' });
    S.flags = get('flags', {});
    S.seq = {};
    for (const c of await Counter.find({ name: { $ne: REV } }, { _id: 0, name: 1, value: 1 }).lean()) S.seq[c.name] = c.value;
    return S;
  }

  /* ------------------------------ write lock (all instances) ------------------------------ */
  async lockedByOther() {
    const l = await WriteLock.findById('write').lean();
    return !!(l && l.owner && !String(l.owner).startsWith(this.instance + ':') && l.until > new Date());
  }

  /** Wait for and take the write lock. Returns a handle for unlock(). */
  async lock() {
    const me = `${this.instance}:${++this.lockSeq}`;
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (let i = 0; ; i++) {
      try {
        const now = new Date();
        const r = await WriteLock.findOneAndUpdate(
          { _id: 'write', $or: [{ owner: null }, { until: { $lt: now } }] },
          { $set: { owner: me, until: new Date(Date.now() + LOCK_MS) } },
          { upsert: true, new: true },
        ).lean();
        if (r && r.owner === me) break;
      } catch (e) { if (!e || e.code !== 11000) throw e; } // held by another instance
      if (Date.now() > deadline) { const err = new Error('The server is busy saving other changes. Please try again.'); err.status = 503; throw err; }
      await sleep(Math.min(250, 15 + i * 15));
    }
    const beat = setInterval(() => { WriteLock.updateOne({ _id: 'write', owner: me }, { $set: { until: new Date(Date.now() + LOCK_MS) } }).catch(() => {}); }, LOCK_MS / 3);
    beat.unref();
    return { me, beat };
  }

  async unlock(h) {
    if (!h) return;
    clearInterval(h.beat);
    await WriteLock.updateOne({ _id: 'write', owner: h.me }, { $set: { owner: null, until: new Date(0) } }).catch(() => {});
  }

  /** Remember what is in MongoDB now (after a load or a successful save). */
  snapshot() {
    const S = this.G.S;
    for (const key of Object.keys(collections)) this.saved[key] = new Map(S[key].map((r) => [r.id, JSON.stringify(clean(r))]));
    this.savedSettings = JSON.stringify(S.settings || {});
    this.savedFlags = JSON.stringify(S.flags || {});
    this.savedSeq = new Map(Object.entries(S.seq || {}));
  }

  invalidate() { this.fresh = false; }

  /** force = always compare the revision (used while holding the write lock). */
  async ensureFresh(force) {
    if (!this.fresh) return this.load();
    if (!force && Date.now() - this.lastCheck < config.FRESH_CHECK_MS) return undefined;
    this.lastCheck = Date.now();
    if ((await this.revision()) !== this.rev) return this.load();
    return undefined;
  }

  /** Is the database still empty (first start)? */
  async isEmpty() { return (await collections.users.estimatedDocumentCount()) === 0 && (await collections.users.countDocuments({})) === 0; }

  /**
   * Write the changes of the working copy to MongoDB.
   * opts.replace = replace every business collection completely (backup restore).
   */
  async save(S, opts = {}) {
    if (opts.replace) return this.replaceAll(S);
    const work = [];
    const next = {};
    for (const [key, M] of Object.entries(collections)) {
      const prev = this.saved[key] || new Map();
      const now = new Map();
      const deletes = []; const upserts = [];
      for (const row of S[key]) {
        const doc = clean(row);
        const text = JSON.stringify(doc);
        now.set(row.id, text);
        const old = prev.get(row.id);
        if (old === text) continue;
        const update = { $set: doc };
        if (old) {
          const unset = {};
          for (const k of Object.keys(JSON.parse(old))) if (!(k in doc)) unset[k] = 1;
          if (Object.keys(unset).length) update.$unset = unset;
        }
        upserts.push({ updateOne: { filter: { id: row.id }, update, upsert: true } });
      }
      for (const id of prev.keys()) if (!now.has(id)) deletes.push({ deleteOne: { filter: { id } } });
      next[key] = now;
      if (deletes.length || upserts.length) work.push({ M, deletes, upserts });
    }
    const settingOps = [];
    const st = JSON.stringify(S.settings || {}); const fl = JSON.stringify(S.flags || {});
    if (st !== this.savedSettings) settingOps.push({ updateOne: { filter: { key: 'settings' }, update: { $set: { value: S.settings || {} } }, upsert: true } });
    if (fl !== this.savedFlags) settingOps.push({ updateOne: { filter: { key: 'flags' }, update: { $set: { value: S.flags || {} } }, upsert: true } });
    const seqOps = [];
    for (const [name, value] of Object.entries(S.seq || {})) if (this.savedSeq.get(name) !== value) seqOps.push({ updateOne: { filter: { name }, update: { $set: { value: Number(value) || 0 } }, upsert: true } });
    if (!work.length && !settingOps.length && !seqOps.length) return false;

    this.writeCount++;
    // removed records first (frees unique values such as Shop IDs), then new / changed records
    for (const w of work) if (w.deletes.length) await w.M.bulkWrite(w.deletes, { ordered: true });
    for (const w of work) if (w.upserts.length) await writeAll(w.M, w.upserts);
    if (seqOps.length) await Counter.bulkWrite(seqOps, { ordered: false });
    if (settingOps.length) await Setting.bulkWrite(settingOps, { ordered: true });

    for (const [k, v] of Object.entries(next)) this.saved[k] = v;
    this.savedSettings = st; this.savedFlags = fl; this.savedSeq = new Map(Object.entries(S.seq || {}));
    const c = await Counter.findOneAndUpdate({ name: REV }, { $inc: { value: 1 } }, { upsert: true, new: true, projection: { value: 1 } }).lean();
    if (this.rev !== null && c.value !== this.rev + 1) this.fresh = false; // someone else wrote meanwhile: reload before the next request
    this.rev = c.value;
    this.lastCheck = Date.now();
    return true;
  }

  /**
   * Backup restore: empty each business collection and insert the restored records.
   * (Unique values such as Shop IDs may move between records in a backup, so a full replace is used.)
   * The records are written as they are in the backup file, without re-validation.
   */
  async replaceAll(S) {
    this.writeCount++;
    const now = new Date();
    for (const [key, M] of Object.entries(collections)) {
      await M.collection.deleteMany({});
      const docs = S[key].map((r) => ({ ...clean(r), createdAt: now, updatedAt: now }));
      for (let i = 0; i < docs.length; i += 1000) await M.collection.insertMany(docs.slice(i, i + 1000), { ordered: true });
    }
    await Counter.deleteMany({ name: { $ne: REV } });
    const seq = Object.entries(S.seq || {}).map(([name, value]) => ({ insertOne: { document: { name, value: Number(value) || 0 } } }));
    if (seq.length) await Counter.bulkWrite(seq, { ordered: true });
    await Setting.bulkWrite([
      { updateOne: { filter: { key: 'settings' }, update: { $set: { value: S.settings || {} } }, upsert: true } },
      { updateOne: { filter: { key: 'flags' }, update: { $set: { value: S.flags || {} } }, upsert: true } },
    ], { ordered: true });
    this.snapshot();
    const c = await Counter.findOneAndUpdate({ name: REV }, { $inc: { value: 1 } }, { upsert: true, new: true, projection: { value: 1 } }).lean();
    this.rev = c.value;
    this.lastCheck = Date.now();
    return true;
  }

  /** Photos and images (sale proof photos, gift images). */
  makeFiles() {
    const toBuf = (b) => (Buffer.isBuffer(b) ? b : b && b.buffer ? Buffer.from(b.buffer) : Buffer.from(b || []));
    return {
      name: 'MongoDB',
      open: async () => {},
      fileGet: async (key) => {
        const f = await StoredFile.findOne({ key }, { content_type: 1, data: 1 }).lean();
        return f ? new Blob([toBuf(f.data)], { type: f.content_type }) : null;
      },
      fileSet: async (key, blob) => {
        const buf = Buffer.from(await blob.arrayBuffer());
        await StoredFile.updateOne({ key }, { $set: { content_type: blob.type || 'application/octet-stream', size: buf.length, data: buf } }, { upsert: true });
      },
      fileDel: async (key) => { await StoredFile.deleteOne({ key }); },
      fileKeys: async () => (await StoredFile.find({}, { key: 1, _id: 0 }).lean()).map((f) => f.key),
      filesClear: async () => { await StoredFile.deleteMany({}); },
      stats: async () => {
        const [r] = await StoredFile.aggregate([{ $group: { _id: null, n: { $sum: 1 }, bytes: { $sum: '$size' } } }]);
        return { count: r ? r.n : 0, bytes: r ? r.bytes : 0 };
      },
    };
  }
}

/**
 * Upserts, unordered. A unique value that moves from one record to another inside the same save
 * (e.g. two Shop IDs swapped, or a backup restore) can clash for a moment; such writes are retried
 * after the others went through.
 */
async function writeAll(M, ops) {
  let todo = ops;
  for (let pass = 0; pass < 4 && todo.length; pass++) {
    try { await M.bulkWrite(todo, { ordered: false }); return; } catch (e) {
      const errs = (e && (e.writeErrors || (e.result && e.result.getWriteErrors && e.result.getWriteErrors()))) || [];
      if (!errs.length || errs.some((x) => (x.code || (x.err && x.err.code)) !== 11000)) throw e;
      todo = errs.map((x) => todo[x.index !== undefined ? x.index : x.err.index]).filter(Boolean);
    }
  }
  if (todo.length) await M.bulkWrite(todo, { ordered: true });
}

module.exports = { MongoStore };
