'use strict';
const { Schema, model } = require('mongoose');

/**
 * Photos and images stored in MongoDB: sale proof photos (mobile + gift) and gift images.
 * key = the path saved on the record (e.g. photos/TXN-0000012-gift-1a2b3c). Max size per photo is
 * MAX_PHOTO_MB (default 6 MB), well below MongoDB's 16 MB document limit.
 */
const StoredFileSchema = new Schema({
  key: { type: String, required: true, maxlength: 200 },
  content_type: { type: String, required: true, maxlength: 100 },
  size: { type: Number, required: true, min: 0 },
  data: { type: Buffer, required: true },
}, { collection: 'stored_files', timestamps: true, versionKey: false });
StoredFileSchema.index({ key: 1 }, { unique: true });

module.exports = model('StoredFile', StoredFileSchema);
