import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { setToastFn } from '../services/api';

const UIContext = createContext(null);

export function UIProvider({ children }) {
  const [toast, setToastState] = useState(null);
  const [emailComposer, setEmailComposer] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const toastTimerRef = useRef(null);

  // Styled replacement for window.confirm(). Returns a Promise<boolean>.
  // Usage: if (!(await showConfirm({ message, danger: true }))) return;
  const showConfirm = useCallback((opts) => {
    const config = typeof opts === 'string' ? { message: opts } : (opts || {});
    return new Promise((resolve) => setConfirmState({ ...config, _resolve: resolve }));
  }, []);

  const resolveConfirm = useCallback((result) => {
    setConfirmState((cur) => { if (cur && cur._resolve) cur._resolve(result); return null; });
  }, []);

  const showToast = useCallback((msg, type = 'success', duration = 3500) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastState({ msg, type });
    toastTimerRef.current = setTimeout(() => { setToastState(null); toastTimerRef.current = null; }, duration);
  }, []);

  // Let the API-layer read-only gate (apiPost) surface a toast for viewers.
  useEffect(() => { setToastFn(showToast); }, [showToast]);

  const openEmailComposer = useCallback((config) => {
    setEmailComposer(config);
  }, []);

  const closeEmailComposer = useCallback(() => {
    setEmailComposer(null);
  }, []);

  return (
    <UIContext.Provider value={{ toast, showToast, emailComposer, openEmailComposer, closeEmailComposer, confirmState, showConfirm, resolveConfirm }}>
      {children}
    </UIContext.Provider>
  );
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used within UIProvider');
  return ctx;
}
