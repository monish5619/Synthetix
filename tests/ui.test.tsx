import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HealthReport } from '../src/api';
import { SystemFooter } from '../src/components/SystemFooter';
import { ComingSoonPage } from '../src/pages/ComingSoonPage';
import { StatusPage } from '../src/pages/StatusPage';
import { Shell } from '../src/shell/Shell';
import { Sidebar } from '../src/shell/Sidebar';
import { liveStatus } from '../src/shell/status';
import { TopBar } from '../src/shell/TopBar';
import { IconButton } from '../src/ui/IconButton';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../src/ui/layout';
import { StatusDot } from '../src/ui/StatusDot';
import { Tooltip } from '../src/ui/Tooltip';

const html = renderToStaticMarkup;
const count = (markup: string, needle: string) => markup.split(needle).length - 1;

const health: HealthReport = {
  telemetryApi: 'ONLINE',
  database: 'CONNECTED',
  degradationEngine: 'READY',
  liquidationEngine: 'READY',
  checkedAt: '2026-10-08T10:00:00.000Z',
};

describe('Tooltip', () => {
  it('is linked to its trigger, and hidden until hover or focus', () => {
    const markup = html(
      <Tooltip label="Collapse sidebar">
        <button type="button">x</button>
      </Tooltip>,
    );
    const bubbleId = /id="([^"]+)" role="tooltip"/.exec(markup)?.[1];
    expect(bubbleId).toBeTruthy();
    expect(markup).toContain(`aria-describedby="${bubbleId}"`);
    expect(markup).toContain('Collapse sidebar');
    expect(markup).not.toContain('data-open');
  });

  it('can be switched off entirely, leaving just the trigger', () => {
    const markup = html(
      <Tooltip label="hidden" disabled>
        <button type="button">x</button>
      </Tooltip>,
    );
    expect(markup).not.toContain('role="tooltip"');
    expect(markup).not.toContain('aria-describedby');
  });
});

describe('IconButton', () => {
  it('always has an accessible name, and exposes toggle state', () => {
    const markup = html(<IconButton icon="sun" label="Control Room (dark) theme" pressed />);
    expect(markup).toContain('aria-label="Control Room (dark) theme"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('aria-hidden="true"'); // the glyph itself is decorative
  });

  it('a placeholder stays focusable but is honestly marked unavailable, with the reason', () => {
    const markup = html(<IconButton icon="bell" label="Notifications" unavailable="the notification centre isn't built yet" />);
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).not.toContain(' disabled=');
    expect(markup).toContain("Notifications — the notification centre isn&#x27;t built yet");
  });
});

describe('StatusDot', () => {
  it.each([
    ['healthy', 'Healthy'],
    ['warning', 'Warning'],
    ['failure', 'Failure'],
  ] as const)('%s: names its state and exact meaning for screen readers', (state, word) => {
    const markup = html(<StatusDot state={state} meaning="The database is connected." />);
    expect(markup).toContain(`data-state="${state}"`);
    expect(markup).toContain(`aria-label="${word}: The database is connected."`);
    expect(markup).toContain('role="tooltip"');
    expect(markup).toContain('tabindex="0"'); // reachable by keyboard, so the tooltip is too
  });
});

describe('shared layout components', () => {
  it('PageHeader: one title and at most one short subtitle', () => {
    const markup = html(<PageHeader title="Alerts" subtitle="Spoilage alerts" />);
    expect(markup).toContain('<h1 id="page-title" class="page-title">Alerts</h1>');
    expect(count(markup, '<p')).toBe(1);
    expect(html(<PageHeader title="Alerts" />)).not.toContain('<p');
  });

  it('EmptyState: title, one hint, optional action', () => {
    const markup = html(<EmptyState title="Nothing yet" hint="Check back later." action={<button type="button">Go</button>} />);
    expect(markup).toContain('Nothing yet');
    expect(markup).toContain('Check back later.');
    expect(markup).toContain('<button');
  });

  it('ErrorState: announced as an alert, with a retry only when one is possible', () => {
    const withRetry = html(<ErrorState title="Unavailable" message="Could not reach the server." onRetry={() => {}} />);
    expect(withRetry).toContain('role="alert"');
    expect(withRetry).toContain('Try again');
    expect(html(<ErrorState title="Unavailable" message="x" />)).not.toContain('Try again');
  });

  it('Skeleton is decorative; Badge and Card render their content', () => {
    expect(html(<Skeleton height={40} />)).toContain('aria-hidden="true"');
    expect(html(<Badge tone="watch">Soon</Badge>)).toContain('chip chip-watch');
    expect(html(<Card title="Totals">12</Card>)).toContain('Totals');
  });
});

describe('Sidebar', () => {
  it('shows all nine links, marks only the current page, and tags the unbuilt ones', () => {
    const markup = html(<Sidebar layout="expanded" route="alerts" />);
    expect(count(markup, 'class="sb-link')).toBe(9);
    expect(count(markup, 'aria-current="page"')).toBe(1);
    expect(markup).toMatch(/href="#\/alerts"[^>]*aria-current="page"|aria-current="page"[^>]*href="#\/alerts"/);
    expect(count(markup, 'class="sb-soon"')).toBe(3);
  });

  it('expanded: labels visible, no tooltips needed', () => {
    const markup = html(<Sidebar layout="expanded" route="control" />);
    expect(count(markup, 'role="tooltip"')).toBe(0);
    expect(markup).toContain('Control Tower');
  });

  it('collapsed: every item keeps its label in the page and gets a tooltip', () => {
    const markup = html(<Sidebar layout="collapsed" route="control" />);
    expect(count(markup, 'role="tooltip"')).toBe(9);
    expect(markup).toContain('Impact — not built yet');
    for (const label of ['Control Tower', 'Fleet', 'Marketplace', 'Telemetry', 'Alerts', 'Impact', 'Explainability', 'Admin', 'Status']) {
      expect(markup).toContain(`<span class="sb-label">${label}</span>`);
    }
  });

  it('offers a collapse control only when a toggle is supplied, named for what it will do', () => {
    expect(html(<Sidebar layout="expanded" route="control" />)).not.toContain('Collapse sidebar');
    expect(html(<Sidebar layout="expanded" route="control" onToggle={() => {}} />)).toContain('aria-label="Collapse sidebar"');
    expect(html(<Sidebar layout="collapsed" route="control" onToggle={() => {}} />)).toContain('aria-label="Expand sidebar"');
  });
});

describe('TopBar', () => {
  const now = 1_000_000;
  const status = liveStatus({ now, lastSyncedAt: now - 2000, failed: false, health });

  it('shows the live status, role, theme and notifications — compactly', () => {
    const markup = html(<TopBar status={status} lastSyncedAt={now - 2000} now={now} />);
    expect(markup).toContain('Live • synced 2s ago');
    expect(markup).toContain('Role: Operator');
    expect(markup).toContain('Control Room (dark) theme');
    expect(markup).toContain('aria-label="Notifications"');
  });

  it('the role switcher is an honest placeholder; the bell is a real control with no count until alerts exist', () => {
    const markup = html(<TopBar status={status} lastSyncedAt={now - 2000} now={now} />);
    expect(count(markup, 'aria-disabled="true"')).toBe(1);
    expect(markup).toContain('switching arrives with sign-in');
    expect(markup).toContain('aria-label="Notifications"');
    expect(markup).not.toContain('notif-badge');
  });

  it('the state change is announced politely, not every tick of the age', () => {
    const markup = html(<TopBar status={status} lastSyncedAt={now - 2000} now={now} />);
    expect(markup).toContain('role="status">Live</span>');
  });

  it('has a menu button only on mobile, and it names and controls the drawer', () => {
    expect(html(<TopBar status={status} lastSyncedAt={now} now={now} />)).not.toContain('Open navigation');
    const mobile = html(<TopBar status={status} lastSyncedAt={now} now={now} onMenu={() => {}} menuOpen={false} />);
    expect(mobile).toContain('aria-label="Open navigation"');
    expect(mobile).toContain('aria-controls="mobile-nav"');
    expect(mobile).toContain('aria-expanded="false"');
  });
});

describe('Shell', () => {
  it('provides a skip link, one main landmark, the sidebar and the top bar', () => {
    const markup = html(
      <Shell route="control" sync={{ lastSyncedAt: Date.now(), failed: false, health }}>
        <p>page</p>
      </Shell>,
    );
    expect(markup).toContain('href="#main"');
    expect(count(markup, '<main')).toBe(1);
    expect(markup).toContain('id="main"');
    expect(markup).toContain('class="sidebar"');
    expect(markup).toContain('class="topbar"');
    expect(markup).toContain('<p>page</p>');
  });
});

describe('pages behind navigation items', () => {
  it.each(['impact', 'explainability', 'admin'] as const)('%s says plainly that it is not built — no invented content', (route) => {
    const markup = html(<ComingSoonPage route={route} />);
    expect(markup).toContain('Not built yet');
    expect(markup).toContain("isn&#x27;t available yet");
    expect(markup).not.toMatch(/<table|<svg[^>]*chart|\d{2,} ?(kg|h|%)/i);
  });

  it("Status shows the server's real checks as five tiles", () => {
    const markup = html(<StatusPage health={health} failed={false} stream="open" />);
    expect(count(markup, 'class="tile is-healthy"')).toBe(5);
    for (const label of ['API', 'Database', 'Model', 'Marketplace', 'Realtime']) expect(markup).toContain(label);
  });

  it('Status reports an unreachable server as an alert, not as healthy', () => {
    const markup = html(<StatusPage health={null} failed />);
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain('class="tile is-healthy"');
  });

  it('the footer uses compact dots, and shows a failure when the server is unreachable', () => {
    expect(count(html(<SystemFooter health={health} healthError={false} />), 'class="status-dot"')).toBe(4);
    const down = html(<SystemFooter health={null} healthError />);
    expect(down).toContain('data-state="failure"');
    expect(down).toContain('Server unreachable');
  });
});
