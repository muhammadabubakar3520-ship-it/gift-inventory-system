'use strict';
const { model } = require('mongoose');
const { schema, ts, ref } = require('./_base');

/** Who did what and when (sign-ins, changes, imports, backups). */
const AuditLogSchema = schema({
  user_id: ref('User'),
  user_name: { type: String, default: undefined },
  role: { type: String, default: undefined },
  action: { type: String, required: true, maxlength: 60 },
  entity: { type: String, default: undefined },
  entity_id: { type: String, default: undefined },
  details: { type: String, default: undefined }, // JSON text
  ip: { type: String, default: undefined },
  created_at: ts,
}, { collection: 'audit_logs' });
AuditLogSchema.index({ created_at: -1 });
AuditLogSchema.index({ action: 1 });

module.exports = model('AuditLog', AuditLogSchema);
