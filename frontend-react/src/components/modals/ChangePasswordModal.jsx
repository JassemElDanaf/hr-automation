import { useState } from 'react';
import Modal from './Modal';
import { useAuth } from '../../state/auth';
import { useUI } from '../../state/uiState';

// Self-service password change for the signed-in user. Opened from the account
// menu in the header. The backend verifies the current password, then revokes
// every other session (this one stays alive).
export default function ChangePasswordModal({ isOpen, onClose }) {
  const { changePassword } = useAuth();
  const { showToast } = useUI();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  function close() {
    setCurrent(''); setNext(''); setConfirm(''); setSaving(false);
    onClose();
  }

  async function submit() {
    if (!current || !next) { showToast('Fill in every field', 'error'); return; }
    if (next.length < 6) { showToast('New password must be at least 6 characters', 'error'); return; }
    if (next !== confirm) { showToast('New passwords do not match', 'error'); return; }
    if (next === current) { showToast('New password must be different from the current one', 'error'); return; }
    setSaving(true);
    try {
      await changePassword(current, next);
      showToast('Password changed — other devices have been signed out.', 'success');
      close();
    } catch (e) {
      showToast(e.message, 'error');
      setSaving(false);
    }
  }

  const footer = (
    <>
      <button className="btn btn-secondary" onClick={close} disabled={saving}>Cancel</button>
      <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Update password'}</button>
    </>
  );

  return (
    <Modal isOpen={isOpen} onClose={close} title="Change password" footer={footer}>
      <div style={{ display: 'grid', gap: 14 }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--gray-500)', lineHeight: 1.5 }}>
          Pick a new password for your account. You'll stay signed in here; any other devices will be signed out.
        </p>
        <Field label="Current password" value={current} onChange={setCurrent} autoFocus autoComplete="current-password" />
        <Field label="New password" value={next} onChange={setNext} hint="At least 6 characters" autoComplete="new-password" />
        <Field label="Confirm new password" value={confirm} onChange={setConfirm} onEnter={submit} autoComplete="new-password" />
      </div>
    </Modal>
  );
}

function Field({ label, value, onChange, hint, autoFocus, onEnter, autoComplete }) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      <input
        style={inp}
        type="password"
        value={value}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) onEnter(); }}
      />
      {hint && <div style={{ fontSize: 11.5, color: 'var(--gray-400)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

const lbl = { fontSize: 12.5, fontWeight: 600, color: 'var(--gray-600)', display: 'block', marginBottom: 5 };
const inp = { width: '100%', padding: '8px 10px', fontSize: 14, border: '1px solid var(--gray-300)', borderRadius: 8, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' };
