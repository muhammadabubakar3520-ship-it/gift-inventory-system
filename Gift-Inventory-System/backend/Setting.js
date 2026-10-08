'use strict';
const { Schema, model } = require('mongoose');

/**
 * Application settings and one-time upgrade markers.
 *   key 'settings' → { sales_mode }
 *   key 'flags'    → which one-time data upgrades already ran
 */
const SettingSchema = new Schema({
  key: { type: String, required: true, maxlength: 60 },
  value: { type: Schema.Types.Mixed, default: {} },
}, { collection: 'settings', timestamps: true, versionKey: false, minimize: false });
SettingSchema.index({ key: 1 }, { unique: true });

module.exports = model('Setting', SettingSchema);
