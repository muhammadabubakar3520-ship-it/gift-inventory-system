'use strict';
const { model } = require('mongoose');
const { schema, link, ts, ref } = require('./_base');

/**
 * One transaction = one mobile sale + the gift given with it, each with a proof photo.
 * There is no approval step: a submitted sale is final (status 'approved', shown as "Completed").
 */
const TransactionSchema = schema({
  transaction_id: { type: String, required: true, maxlength: 20 },
  shop_id: { ...ref('Shop'), required: true },
  promoter_id: { ...ref('User'), required: true },
  brand_id: ref('Brand'),
  model_id: ref('PhoneModel'),
  mobile_qty: { type: Number, min: 1, default: undefined },
  mobile_photo_path: { type: String, default: undefined },
  gift_id: { ...ref('Gift'), required: true },
  quantity: { type: Number, required: true, min: 1 },
  photo_path: { type: String, default: undefined },
  status: { type: String, enum: ['pending', 'review', 'approved', 'rejected'], required: true },
  rejection_reason: { type: String, default: undefined },
  remarks: { type: String, default: undefined, maxlength: 300 },
  client_ref: { type: String, default: undefined, maxlength: 64 },
  latitude: { type: Number, default: undefined },
  longitude: { type: Number, default: undefined },
  review_started_at: ts,
  review_started_by: ref('User'),
  reviewed_by: ref('User'),
  reviewed_at: ts,
  created_at: ts,
}, { collection: 'transactions' });
TransactionSchema.index({ transaction_id: 1 }, { unique: true });
TransactionSchema.index({ shop_id: 1, created_at: -1 });
TransactionSchema.index({ promoter_id: 1, created_at: -1 });
TransactionSchema.index({ gift_id: 1 });
TransactionSchema.index({ created_at: -1 });
link(TransactionSchema, 'shop', 'Shop', 'shop_id');
link(TransactionSchema, 'promoter', 'User', 'promoter_id');
link(TransactionSchema, 'gift', 'Gift', 'gift_id');
link(TransactionSchema, 'brand', 'Brand', 'brand_id');
link(TransactionSchema, 'model', 'PhoneModel', 'model_id');

module.exports = model('Transaction', TransactionSchema);
