import { useEffect, useRef, useState } from 'react';
import { fetchAlerts } from '../api';
import { alertHeadline, unreadCount } from '../alerts';
import { clock } from '../format';
import { useChangeStream } from '../live';
import { usePoll } from '../poll';
import { Icon } from '../ui/icons';
import { RiskBadge } from './RiskBadge';

/** The bell: unread badge, the latest alerts, and a link to all of them. Read from the alerts table. */
export function NotificationCentre() {
  const { data, reload } = usePoll(fetchAlerts, 5000);
  useChangeStream(() => reload());
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const unread = data ? unreadCount(data) : 0;
  return (
    <div className="notif" ref={box}>
      <button
        type="button"
        className="icon-btn notif-btn"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-controls="notif-panel"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="bell" />
        {unread > 0 && (
          <span className="notif-badge" aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div id="notif-panel" className="notif-panel" role="region" aria-label="Notifications">
          {!data || data.length === 0 ? (
            <p className="quiet">No alerts. Nothing needs attention.</p>
          ) : (
            <ul>
              {data.slice(0, 5).map((a) => (
                <li key={a.id} className={a.acknowledgedAt ? '' : 'is-unread'}>
                  <RiskBadge level={a.severity} />
                  <div>
                    <p>{alertHeadline(a)}</p>
                    <p className="notif-meta">
                      {a.produce} · {a.code} · <time dateTime={a.createdAt}>{clock(a.createdAt)}</time>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <a className="notif-all" href="#/alerts" onClick={() => setOpen(false)}>
            View all alerts
          </a>
        </div>
      )}
    </div>
  );
}
