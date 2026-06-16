import { useEffect } from 'react';
import { useUI } from '../../state/uiState';

// Styled replacement for window.confirm() — driven by showConfirm() in UI context.
export default function ConfirmDialog() {
  const { confirmState, resolveConfirm } = useUI();

  useEffect(() => {
    if (!confirmState) return;
    const onKey = (e) => {
      if (e.key === 'Escape') resolveConfirm(false);
      if (e.key === 'Enter') resolveConfirm(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirmState, resolveConfirm]);

  if (!confirmState) return null;

  const {
    title = 'Please confirm',
    message = 'Are you sure?',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false,
  } = confirmState;

  return (
    <div className="modal-overlay active" onClick={(e) => e.target === e.currentTarget && resolveConfirm(false)}>
      <div className="modal" style={{ maxWidth: 440, width: '100%' }}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={() => resolveConfirm(false)}>&times;</button>
        </div>
        <div className="modal-body">
          <p style={{ color: 'var(--gray-700)', fontSize: 14, lineHeight: 1.6, margin: 0 }}>{message}</p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={() => resolveConfirm(false)} autoFocus>{cancelLabel}</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => resolveConfirm(true)}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
