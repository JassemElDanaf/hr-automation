import { createContext, useContext, useState, useCallback, useRef } from 'react';

const UIContext = createContext(null);

export function UIProvider({ children }) {
  const [toast, setToastState] = useState(null);
  const [emailComposer, setEmailComposer] = useState(null);
  const toastTimerRef = useRef(null);

  const showToast = useCallback((msg, type = 'success', duration = 3500) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastState({ msg, type });
    toastTimerRef.current = setTimeout(() => { setToastState(null); toastTimerRef.current = null; }, duration);
  }, []);

  const openEmailComposer = useCallback((config) => {
    setEmailComposer(config);
  }, []);

  const closeEmailComposer = useCallback(() => {
    setEmailComposer(null);
  }, []);

  return (
    <UIContext.Provider value={{ toast, showToast, emailComposer, openEmailComposer, closeEmailComposer }}>
      {children}
    </UIContext.Provider>
  );
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used within UIProvider');
  return ctx;
}
