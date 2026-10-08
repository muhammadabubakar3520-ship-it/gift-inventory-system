'use strict';
const { model } = require('mongoose');
const { schema, ts, status } = require('./_base');

/** Admins and promoters. Passwords are stored only as one-way hashes (bcrypt). */
const UserSchema = schema({
  user_code: { type: String, required: true, maxlength: 20 },
  name: { type: String, required: true, maxlength: 100 },
  email: { type: String, required: true, maxlength: 120, match: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/ },
  phone: { type: String, default: undefined, maxlength: 20 },
  password_hash: { type: String, required: true, select: true },
  role: { type: String, enum: ['admin', 'promoter'], required: true },
  status,
  token_version: { type: Number, required: true, min: 0 },
  last_login_at: ts,
  created_at: ts,
  updated_at: ts,
}, { collection: 'users' });
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ user_code: 1 }, { unique: true });
UserSchema.index({ role: 1, status: 1 });
// never send password hashes in JSON
UserSchema.set('toJSON', { transform: (_d, r) => { delete r.password_hash; return r; } });

module.exports = model('User', UserSchema);
