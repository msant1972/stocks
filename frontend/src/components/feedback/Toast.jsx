import { createContext, useCallback, useContext, useState } from 'react';

const ToastContext = createContext(() => {});

/** Avisos curtos de confirmação secundária. Erros e confirmações financeiras ficam sempre no contexto. */
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text) => {
    const id = Math.random().toString(36).slice(2);
    setItems((xs) => [...xs, { id, text }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className="toast">{t.text}</div>)}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
