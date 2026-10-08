/* Create / edit user form and activate / deactivate (from pages-promoters.js: Admin.userForm, Admin.toggleUser). */
import { useState } from 'react';
import { Modal, openModal, confirmDialog } from '../Modal';
import BusyButton from '../BusyButton';
import { toast, toastError } from '../Toasts';
import { api } from '../../services/api';
import { useLookups, lookups } from '../../context/LookupsContext';

function UserFormModal({ user, role, onClose, onSaved }) {
  const { loadLookups } = useLookups();
  const u = user || { role, status: 'active' };
  const [f, setF] = useState({ name: u.name || '', phone: u.phone || '', email: u.email || '', status: u.status || 'active', password: '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = async () => {
    const body = { name: f.name, phone: f.phone, email: f.email, status: f.status, ...(!user ? { password: f.password } : {}), role: u.role };
    if (!body.name.trim() || !body.email.trim()) return toast('Name and email are required', 'warn');
    try {
      // the user list/detail views carry no updated_at, so the conflict check is only sent when it is there
      const saved = await api(user ? `/users/${user.id}` : '/users', { method: user ? 'PUT' : 'POST', body: { ...body, ...(user && user.updated_at !== undefined ? { expected_updated_at: user.updated_at } : {}) } });
      toast(user ? 'Saved' : `${saved.user_code} created`, 'ok');
      await loadLookups();
      onClose(); if (onSaved) onSaved(saved);
    } catch (ex) { toastError(ex); }
    return undefined;
  };

  return (
    <Modal title={user ? `Edit ${u.role} · ${u.user_code}` : `Add ${role}`} size="wide" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><BusyButton className="btn primary" id="uSave" busyText="Saving…" onClick={save}>{user ? 'Save changes' : `Create ${role}`}</BusyButton></>}>
      <div className="form-grid" id="uForm">
        <div className="field"><label>Full name <span className="req">*</span></label><input className="input" name="name" value={f.name} onChange={set('name')} maxLength={100} /></div>
        <div className="field"><label>Phone</label><input className="input" name="phone" value={f.phone} onChange={set('phone')} maxLength={20} inputMode="tel" placeholder="03xx-xxxxxxx" /></div>
        <div className="field"><label>Email (login) <span className="req">*</span></label><input className="input" name="email" type="email" value={f.email} onChange={set('email')} maxLength={120} autoComplete="off" /></div>
        <div className="field"><label>Status</label><select className="select" name="status" value={f.status} onChange={set('status')}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
        {!user && (
          <div className="field"><label>Password <span className="req">*</span></label><input className="input" name="password" type="text" autoComplete="new-password" minLength={8} placeholder="Min. 8 characters, letters and numbers" value={f.password} onChange={set('password')} />
            <div className="hint">Share it with the {role} securely. They can change it after signing in.</div></div>
        )}
        <input type="hidden" name="role" value={u.role} />
      </div>
    </Modal>
  );
}

/** Admin.userForm(user, role, onSaved): user = null for a new promoter / admin. */
export function openUserForm(user, role, onSaved) {
  return openModal((close) => <UserFormModal user={user} role={role} onClose={close} onSaved={onSaved} />);
}

/** Admin.toggleUser(u, done): activate / deactivate after confirmation. */
export async function toggleUser(u, done) {
  const to = u.status === 'active' ? 'inactive' : 'active';
  const ok = await confirmDialog({
    title: to === 'inactive' ? `Deactivate ${u.name}?` : `Activate ${u.name}?`,
    message: to === 'inactive'
      ? <>They will be signed out and cannot log in.{u.shops_assigned ? <> They still have <b>{u.shops_assigned}</b> assigned shop(s) — reassign them so field work continues.</> : ''}</>
      : 'They will be able to sign in again.',
    confirmText: to === 'inactive' ? 'Deactivate' : 'Activate', danger: to === 'inactive',
  });
  if (!ok) return;
  try { await api(`/users/${u.id}/status`, { method: 'PATCH', body: { status: to } }); toast('Status updated', 'ok'); await lookups.loadLookups(); done(); } catch (e) { toastError(e); }
}
