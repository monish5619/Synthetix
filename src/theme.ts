/**
 * Frost & Field theme selection.
 *
 * Light ("Field") is the default: bright, high-contrast, projector-friendly.
 * Dark ("Control Room") is opt-in and remembered in localStorage.
 *
 * Every storage access is wrapped in try/catch: private windows, blocked
 * cookies or a full quota make localStorage throw, and that must never stop
 * the app from rendering. The worst case is simply "the choice isn't saved".
 */

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'agrosense.theme';

/** The subset of the Storage API we use, so tests can pass a fake. */
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}

/** The browser's localStorage, or null when it is missing or access itself throws. */
export function browserStorage(): ThemeStorage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The saved choice, or null if there is none, it is invalid, or storage is blocked. */
export function readSavedTheme(storage: ThemeStorage | null): Theme | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

/** Saves the choice. Returns false (and changes nothing else) when storage refuses. */
export function saveTheme(storage: ThemeStorage | null, theme: Theme): boolean {
  if (!storage) return false;
  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

/**
 * A saved choice always wins. Only when nothing is saved does the operating
 * system preference apply. With neither, the default is light.
 */
export function resolveTheme(saved: Theme | null, _systemPrefersDark: boolean): Theme {
  if (saved) return saved;
  // Light is the default for every visitor. The system setting does not override it.
  return 'light';
}

export function systemPrefersDark(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/** Light is expressed by the absence of the attribute, so the default needs no JavaScript at all. */
export function applyTheme(root: { setAttribute(n: string, v: string): void; removeAttribute(n: string): void }, theme: Theme) {
  if (theme === 'dark') root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
}

/** The theme to use right now, from storage and the system preference. */
export function initialTheme(storage: ThemeStorage | null = browserStorage()): Theme {
  return resolveTheme(readSavedTheme(storage), systemPrefersDark());
}
