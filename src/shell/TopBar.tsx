import type { RefObject } from 'react';
import { Icon } from '../ui/icons';
import { NotificationCentre } from '../components/NotificationCentre';
import { Tooltip } from '../ui/Tooltip';
import { ThemeToggle } from '../components/ThemeToggle';
import { dotForLive, pillText, type LiveStatus } from './status';

interface Props {
  status: LiveStatus;
  lastSyncedAt: number | null;
  now: number;
  /** Mobile only: opens the navigation drawer. */
  onMenu?: () => void;
  menuOpen?: boolean;
  menuRef?: RefObject<HTMLButtonElement | null>;
}

/** The live status: a coloured shape, the state in words, and how fresh it is. */
function LivePill({ status, lastSyncedAt, now }: Pick<Props, 'status' | 'lastSyncedAt' | 'now'>) {
  const text = pillText(status, lastSyncedAt, now);
  return (
    <>
      <Tooltip label={status.meaning} side="bottom-end">
        <span className="live-pill" data-state={dotForLive(status.state)} tabIndex={0}>
          <span className="status-dot" data-state={dotForLive(status.state)} aria-hidden="true" />
          <span className="live-text">{text}</span>
        </span>
      </Tooltip>
      {/* Announces only when the STATE changes ("Offline"), not every second the age ticks. */}
      <span className="visually-hidden" role="status">
        {status.label}
      </span>
    </>
  );
}

/**
 * A placeholder for the future sign-in system. It shows who the demo is acting
 * as and says plainly that switching is not available yet.
 */
function RoleSwitcher() {
  return (
    <Tooltip label="Role: Operator — switching arrives with sign-in" side="bottom-end">
      <button type="button" className="role-switcher" aria-disabled="true" aria-label="Role: Operator. Switching arrives with sign-in.">
        <Icon name="user" size={18} />
        <span className="role-name">Operator</span>
      </button>
    </Tooltip>
  );
}

/** Always visible: brand (mobile), live status, role, theme, notifications. */
export function TopBar({ status, lastSyncedAt, now, onMenu, menuOpen, menuRef }: Props) {
  return (
    <header className="topbar">
      <div className="topbar-start">
        {onMenu && (
          <button
            ref={menuRef}
            type="button"
            className="icon-btn"
            aria-label="Open navigation"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={onMenu}
          >
            <Icon name="menu" />
          </button>
        )}
        {onMenu && <span className="topbar-brand">AGROSENSE</span>}
      </div>

      <div className="topbar-end">
        <LivePill status={status} lastSyncedAt={lastSyncedAt} now={now} />
        <RoleSwitcher />
        <ThemeToggle />
        <NotificationCentre />
      </div>
    </header>
  );
}
