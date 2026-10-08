import { useEffect } from 'react';
import { TOAST_MS, type Toast } from '../toasts';
import { Icon } from './icons';

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), TOAST_MS[toast.kind]);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.kind, onDismiss]);

  return (
    <li className={`toast toast-${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
      <Icon name={toast.kind === 'error' ? 'warning' : 'check'} size={18} />
      <span className="toast-text">{toast.text}</span>
      <button type="button" className="toast-close" aria-label="Dismiss message" onClick={() => onDismiss(toast.id)}>
        <Icon name="close" size={16} />
      </button>
    </li>
  );
}

/** Short messages after an action. Successes are polite; failures interrupt. */
export function ToastRegion({ toasts, onDismiss }: { toasts: readonly Toast[]; onDismiss: (id: number) => void }) {
  return (
    <ul className="toast-region" aria-label="Messages">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </ul>
  );
}
