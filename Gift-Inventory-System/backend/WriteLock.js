'use strict';
const { Schema, model } = require('mongoose');

/**
 * Write lock shared by all server instances (e.g. the old and the new instance during a deploy).
 * Only the instance holding the lock may change data, so stock checks and stock updates can never
 * interleave between instances. A lock expires by itself (until) if an instance stops.
 */
const WriteLockSchema = new Schema({
  _id: { type: String },
  owner: { type: String, default: null },
  until: { type: Date, default: () => new Date(0) },
}, { collection: 'locks', versionKey: false });

module.exports = model('WriteLock', WriteLockSchema);
