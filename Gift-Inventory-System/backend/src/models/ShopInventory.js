'use strict';
const { model } = require('mongoose');
const { schema, link, ts, ref } = require('./_base');

/**
 * Gift stock of one shop (one document per shop × gift).
 *   remaining = allocated_quantity - distributed_quantity
 * Gifts given with a sale are deducted at once (distributed_quantity). pending_quantity is kept
 * for data from older versions and is always 0 now.
 */
const qty = { type: Number, required: true, min: 0 };
const ShopInventorySchema = schema({
  shop_id: { ...ref('Shop'), required: true },
  gift_id: { ...ref('Gift'), required: true },
  allocated_quantity: qty,
  distributed_quantity: qty,
  pending_quantity: qty,
  created_at: ts,
  updated_at: ts,
}, { collection: 'shop_inventory' });
ShopInventorySchema.index({ shop_id: 1, gift_id: 1 }, { unique: true });
ShopInventorySchema.index({ gift_id: 1 });
ShopInventorySchema.path('distributed_quantity').validate(function (v) {
  return typeof this.allocated_quantity !== 'number' || v + (this.pending_quantity || 0) <= this.allocated_quantity;
}, 'Given quantity cannot be more than the allocated quantity');
link(ShopInventorySchema, 'shop', 'Shop', 'shop_id');
link(ShopInventorySchema, 'gift', 'Gift', 'gift_id');

module.exports = model('ShopInventory', ShopInventorySchema);
