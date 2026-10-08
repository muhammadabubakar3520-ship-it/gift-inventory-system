'use strict';
/**
 * Shared schema options for the business collections.
 *
 * Every record keeps the numeric `id` the application uses in its links and API paths
 * (e.g. /api/shops/12). MongoDB's own `_id` stays as the internal key.
 * Business timestamps (created_at / updated_at) are UTC strings 'YYYY-MM-DD HH:MM:SS', exactly like
 * the original app; Mongoose additionally keeps createdAt / updatedAt (Date) on every document.
 */
const { Schema } = require('mongoose');

const ts = { type: String, match: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/ };
const status = { type: String, enum: ['active', 'inactive'], required: true };
const id = { type: Number, required: true, min: 1 };
const ref = (model) => ({ type: Number, ref: model, default: undefined }); // numeric id of a record in another collection

function schema(fields, opts = {}) {
  const s = new Schema({ id, ...fields }, { timestamps: true, strict: true, versionKey: false, minimize: false, ...opts });
  s.index({ id: 1 }, { unique: true });
  return s;
}
/** Virtual "populate" link: numeric foreign key → document of another model. */
function link(s, name, model, localField) {
  s.virtual(name, { ref: model, localField, foreignField: 'id', justOne: true });
}
module.exports = { Schema, schema, link, ts, status, ref };
