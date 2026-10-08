import { browserStorage, type ThemeStorage } from '../theme';

/** Viewport breakpoints (px). */
export const BREAKPOINT = { mobile: 768, collapsible: 1024, full: 1280 } as const;

export type SidebarPref = 'expanded' | 'collapsed';
/** `drawer`: no rail at all; navigation opens from a menu button. */
export type SidebarLayout = 'expanded' | 'collapsed' | 'drawer';

export const SIDEBAR_STORAGE_KEY = 'agrosense.sidebar';

/**
 * How the sidebar looks at a given viewport width.
 *  < 768        drawer      (mobile)
 *  768 – 1023   collapsed   (compact, icon-only; nothing to toggle)
 *  ≥ 1024       the person's saved choice, else expanded from 1280 up and collapsed below
 */
export function sidebarLayout(width: number, saved: SidebarPref | null): SidebarLayout {
  if (width < BREAKPOINT.mobile) return 'drawer';
  if (width < BREAKPOINT.collapsible) return 'collapsed';
  return saved ?? (width >= BREAKPOINT.full ? 'expanded' : 'collapsed');
}

/** The collapse toggle only exists where there is room to choose. */
export const canToggleSidebar = (width: number) => width >= BREAKPOINT.collapsible;

export const isSidebarPref = (value: unknown): value is SidebarPref => value === 'expanded' || value === 'collapsed';

/** Same safety rule as the theme: storage may throw, and that must never break the app. */
export function readSidebarPref(storage: ThemeStorage | null = browserStorage()): SidebarPref | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(SIDEBAR_STORAGE_KEY);
    return isSidebarPref(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveSidebarPref(pref: SidebarPref, storage: ThemeStorage | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SIDEBAR_STORAGE_KEY, pref);
    return true;
  } catch {
    return false;
  }
}
