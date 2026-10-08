/** Small, pure bookkeeping for toast messages. */

export type ToastKind = 'success' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

/** How long a toast stays. Errors stay longer: they are the ones people need to read. */
export const TOAST_MS: Record<ToastKind, number> = { success: 4000, error: 8000 };

export const MAX_TOASTS = 3;

/** Adds a toast, keeping only the newest few. */
export function addToast(list: readonly Toast[], toast: Toast): Toast[] {
  return [...list, toast].slice(-MAX_TOASTS);
}

export const removeToast = (list: readonly Toast[], id: number): Toast[] => list.filter((t) => t.id !== id);
