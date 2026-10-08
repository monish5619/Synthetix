import { describe, expect, it } from 'vitest';
import type { HealthReport } from '../src/api';
import { ROUTES, ROUTE_HREF } from '../src/route';
import {
  BREAKPOINT,
  SIDEBAR_STORAGE_KEY,
  canToggleSidebar,
  readSidebarPref,
  saveSidebarPref,
  sidebarLayout,
} from '../src/shell/layout';
import { NAV_ITEMS, navItemFor, navTooltip } from '../src/shell/nav';
import {
  HEARTBEAT_MS,
  STALE_AFTER_MS,
  dotForLive,
  healthDots,
  liveStatus,
  pillText,
  syncLabel,
} from '../src/shell/status';
import type { ThemeStorage } from '../src/theme';

const blocked: ThemeStorage = {
  getItem() {
    throw new DOMException('blocked', 'SecurityError');
  },
  setItem() {
    throw new DOMException('quota', 'QuotaExceededError');
  },
};

const memory = (initial: Record<string, string> = {}) => {
  const data = { ...initial };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) } satisfies ThemeStorage & { data: Record<string, string> };
};

const health = (over: Partial<HealthReport> = {}): HealthReport => ({
  telemetryApi: 'ONLINE',
  database: 'CONNECTED',
  degradationEngine: 'READY',
  liquidationEngine: 'READY',
  checkedAt: '2026-10-08T10:00:00.000Z',
  ...over,
});

describe('navigation', () => {
  it('lists the nine required items in order', () => {
    expect(NAV_ITEMS.map((n) => n.label)).toEqual([
      'Control Tower',
      'Fleet',
      'Marketplace',
      'Telemetry',
      'Alerts',
      'Impact',
      'Explainability',
      'Admin',
      'Status',
    ]);
  });

  it('keeps every route that existed before (none deleted, same addresses)', () => {
    const before = { control: '#/', marketplace: '#/marketplace', telemetry: '#/telemetry', alerts: '#/alerts' };
    for (const [route, href] of Object.entries(before)) {
      expect(ROUTES).toContain(route);
      expect(ROUTE_HREF[route as keyof typeof ROUTE_HREF]).toBe(href);
    }
  });

  it('has exactly one item per route, with unique links', () => {
    expect(NAV_ITEMS.map((n) => n.route)).toEqual([...ROUTES]);
    expect(new Set(NAV_ITEMS.map((n) => n.href)).size).toBe(NAV_ITEMS.length);
  });

  it('only marks a page "built" when it really does something today', () => {
    // If a page is added later, this list is where it must be declared — no silent fakes.
    expect(NAV_ITEMS.filter((n) => n.built).map((n) => n.route)).toEqual(['control', 'fleet', 'marketplace', 'telemetry', 'alerts', 'status']);
    expect(NAV_ITEMS.filter((n) => !n.built).map((n) => n.route)).toEqual(['impact', 'explainability', 'admin']);
  });

  it('says "not built yet" in the tooltip of unbuilt pages, and nothing extra for built ones', () => {
    expect(navTooltip(navItemFor('impact'))).toBe('Impact — not built yet');
    expect(navTooltip(navItemFor('alerts'))).toBe('Alerts');
  });

  it('uses short labels — never navigation paragraphs', () => {
    for (const n of NAV_ITEMS) expect(n.label.split(' ').length).toBeLessThanOrEqual(2);
  });
});

describe('sidebar layout by viewport width', () => {
  it('is a drawer below 768', () => {
    for (const w of [320, 375, 430, 767]) expect(sidebarLayout(w, null)).toBe('drawer');
    expect(sidebarLayout(375, 'expanded')).toBe('drawer'); // a saved choice can't force a rail onto a phone
  });

  it('is a compact icon rail from 768 to 1023, whatever was saved', () => {
    for (const w of [768, 900, 1023]) {
      expect(sidebarLayout(w, null)).toBe('collapsed');
      expect(sidebarLayout(w, 'expanded')).toBe('collapsed');
    }
  });

  it('is full at 1280 and above by default, collapsed between 1024 and 1279', () => {
    expect(sidebarLayout(1440, null)).toBe('expanded');
    expect(sidebarLayout(1280, null)).toBe('expanded');
    expect(sidebarLayout(1024, null)).toBe('collapsed');
    expect(sidebarLayout(1279, null)).toBe('collapsed');
  });

  it('honours the saved choice from 1024 up', () => {
    expect(sidebarLayout(1440, 'collapsed')).toBe('collapsed');
    expect(sidebarLayout(1024, 'expanded')).toBe('expanded');
  });

  it('offers the collapse toggle only where there is room to choose', () => {
    expect(canToggleSidebar(BREAKPOINT.collapsible)).toBe(true);
    expect(canToggleSidebar(1023)).toBe(false);
    expect(canToggleSidebar(375)).toBe(false);
  });
});

describe('sidebar preference storage', () => {
  it('round-trips and rejects junk', () => {
    const s = memory();
    expect(saveSidebarPref('collapsed', s)).toBe(true);
    expect(s.data[SIDEBAR_STORAGE_KEY]).toBe('collapsed');
    expect(readSidebarPref(s)).toBe('collapsed');
    expect(readSidebarPref(memory({ [SIDEBAR_STORAGE_KEY]: 'huge' }))).toBeNull();
  });

  it('never throws when storage is blocked or missing', () => {
    expect(readSidebarPref(blocked)).toBeNull();
    expect(saveSidebarPref('expanded', blocked)).toBe(false);
    expect(readSidebarPref(null)).toBeNull();
    expect(saveSidebarPref('expanded', null)).toBe(false);
  });
});

describe('"synced Ns ago" wording', () => {
  it.each([
    [0, 'just now'],
    [999, 'just now'],
    [1000, '1s ago'],
    [2400, '2s ago'],
    [59_999, '59s ago'],
    [60_000, '1m ago'],
    [3_599_000, '59m ago'],
    [3_600_000, '1h ago'],
    [-500, 'just now'], // a clock that stepped backwards must not print nonsense
  ])('%i ms → %s', (ms, label) => {
    expect(syncLabel(ms)).toBe(label);
  });
});

describe('live status — only claims what is true', () => {
  const now = 1_000_000;

  it('is Connecting before the first answer, and Offline if that first attempt fails', () => {
    expect(liveStatus({ now, lastSyncedAt: null, failed: false, health: null }).state).toBe('connecting');
    expect(liveStatus({ now, lastSyncedAt: null, failed: true, health: null }).state).toBe('offline');
  });

  it('is Live when a recent check succeeded', () => {
    const s = liveStatus({ now, lastSyncedAt: now - 2000, failed: false, health: health() });
    expect(s).toMatchObject({ state: 'live', label: 'Live' });
  });

  it('stops being Live after three missed heartbeats, even without an error', () => {
    expect(STALE_AFTER_MS).toBeGreaterThan(HEARTBEAT_MS * 3);
    expect(liveStatus({ now, lastSyncedAt: now - STALE_AFTER_MS, failed: false, health: health() }).state).toBe('live');
    expect(liveStatus({ now, lastSyncedAt: now - STALE_AFTER_MS - 1, failed: false, health: health() }).state).toBe('offline');
  });

  it('is Offline as soon as a check fails, and says how stale the page is', () => {
    const s = liveStatus({ now, lastSyncedAt: now - 40_000, failed: true, health: health() });
    expect(s.state).toBe('offline');
    expect(s.meaning).toContain('40s ago');
  });

  it('is Degraded when the server answers but an engine reports a failure', () => {
    expect(liveStatus({ now, lastSyncedAt: now - 1000, failed: false, health: health({ degradationEngine: 'FAILED' }) }).state).toBe('degraded');
    expect(liveStatus({ now, lastSyncedAt: now - 1000, failed: false, health: health({ liquidationEngine: 'FAILED' }) }).state).toBe('degraded');
  });

  it('maps to the three dot colours', () => {
    expect(dotForLive('live')).toBe('healthy');
    expect(dotForLive('degraded')).toBe('warning');
    expect(dotForLive('connecting')).toBe('warning');
    expect(dotForLive('offline')).toBe('failure');
  });
});

describe('pill text', () => {
  const now = 1_000_000;
  const text = (over: Parameters<typeof liveStatus>[0]) => pillText(liveStatus(over), over.lastSyncedAt, over.now);

  it('reads "Live • synced 2s ago"', () => {
    expect(text({ now, lastSyncedAt: now - 2000, failed: false, health: health() })).toBe('Live • synced 2s ago');
  });

  it('keeps the last good time when offline', () => {
    expect(text({ now, lastSyncedAt: now - 75_000, failed: true, health: null })).toBe('Offline • last synced 1m ago');
  });

  it('has sensible words before any sync', () => {
    expect(text({ now, lastSyncedAt: null, failed: false, health: null })).toBe('Connecting…');
    expect(text({ now, lastSyncedAt: null, failed: true, health: null })).toBe('Offline');
  });

  it('labels a degraded server as degraded, with its age', () => {
    expect(text({ now, lastSyncedAt: now - 3000, failed: false, health: health({ degradationEngine: 'FAILED' }) })).toBe('Degraded • synced 3s ago');
  });
});

describe('health dots', () => {
  it('gives each of the four checks a dot with an exact meaning', () => {
    const dots = healthDots(health());
    expect(dots.map((d) => d.label)).toEqual(['Telemetry API', 'Degradation engine', 'Liquidation engine', 'Database']);
    expect(dots.every((d) => d.state === 'healthy')).toBe(true);
    expect(dots.every((d) => d.meaning.length > 10)).toBe(true);
  });

  it('turns an engine dot to failure, with a meaning that names the engine', () => {
    const dot = healthDots(health({ liquidationEngine: 'FAILED' })).find((d) => d.key === 'liquidation');
    expect(dot).toMatchObject({ state: 'failure' });
    expect(dot?.meaning).toBe('The liquidation engine reported a failure.');
  });
});
