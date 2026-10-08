import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { HealthReport } from '../api';
import type { Route } from '../route';
import { Icon } from '../ui/icons';
import { canToggleSidebar, readSidebarPref, saveSidebarPref, sidebarLayout, type SidebarPref } from './layout';
import { useNow, useViewportWidth } from './hooks';
import { Sidebar } from './Sidebar';
import { liveStatus } from './status';
import { TopBar } from './TopBar';

interface Props {
  route: Route;
  /** Facts about the connection, supplied by whoever talks to the server. */
  sync: { lastSyncedAt: number | null; failed: boolean; health: HealthReport | null };
  footer?: ReactNode;
  children: ReactNode;
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The application shell: sidebar, top bar and content area.
 *  ≥ 1024px  a rail that can be collapsed to icons (remembered)
 *  768–1023  a compact icon rail
 *  < 768     a menu button that opens the same navigation as a drawer
 */
export function Shell({ route, sync, footer, children }: Props) {
  const width = useViewportWidth();
  const now = useNow(1000);
  const [pref, setPref] = useState<SidebarPref | null>(() => readSidebarPref());
  const layout = sidebarLayout(width, pref);
  const drawer = layout === 'drawer';
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const status = liveStatus({ now, lastSyncedAt: sync.lastSyncedAt, failed: sync.failed, health: sync.health });

  const toggle = () => {
    const next: SidebarPref = layout === 'expanded' ? 'collapsed' : 'expanded';
    setPref(next);
    saveSidebarPref(next); // ignored safely if storage is blocked
  };

  const close = useCallback(() => {
    setOpen(false);
    menuRef.current?.focus();
  }, []);

  // A drawer only exists on mobile; resizing up closes it.
  useEffect(() => {
    if (!drawer) setOpen(false);
  }, [drawer]);

  // Opening: move focus in, stop the page behind from scrolling. Escape closes.
  useEffect(() => {
    if (!open) return;
    drawerRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  // Keep Tab inside the open drawer.
  const trapTab = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const items = [...(drawerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="shell" data-layout={layout}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      {!drawer && (
        <Sidebar layout={layout} route={route} {...(canToggleSidebar(width) ? { onToggle: toggle } : {})} />
      )}

      <div className="shell-main">
        <TopBar
          status={status}
          lastSyncedAt={sync.lastSyncedAt}
          now={now}
          {...(drawer ? { onMenu: () => setOpen(true), menuOpen: open, menuRef } : {})}
        />
        <main id="main" tabIndex={-1} className="app">
          {children}
        </main>
        {footer}
      </div>

      {drawer && open && (
        <>
          <div className="drawer-backdrop" onClick={close} aria-hidden="true" />
          <div
            id="mobile-nav"
            ref={drawerRef}
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            onKeyDown={trapTab}
          >
            <button type="button" className="icon-btn drawer-close" aria-label="Close navigation" onClick={close}>
              <Icon name="close" />
            </button>
            <Sidebar layout="drawer" route={route} onNavigate={() => setOpen(false)} />
          </div>
        </>
      )}
    </div>
  );
}
