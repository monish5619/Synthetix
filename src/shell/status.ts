import type { HealthReport } from '../api';

/** The shell checks the server this often. */
export const HEARTBEAT_MS = 5000;
/** Three missed heartbeats: the connection is no longer "live", even if no error was raised. */
export const STALE_AFTER_MS = HEARTBEAT_MS * 3 + 1000;

/** "just now", "2s ago", "3m ago", "1h ago". Always floors, never rounds up. */
export function syncLabel(ageMs: number): string {
  const seconds = Math.max(0, Math.floor(ageMs / 1000));
  if (seconds < 1) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export type LiveState = 'connecting' | 'live' | 'degraded' | 'offline';

export interface LiveStatus {
  state: LiveState;
  /** The word shown in the pill. */
  label: 'Connecting' | 'Live' | 'Degraded' | 'Offline';
  /** Exact meaning, for the tooltip and screen readers. */
  meaning: string;
}

/**
 * What the status pill says, from facts only: whether the last check failed,
 * how long ago the last successful one was, and what the server reported.
 * It never claims "Live" unless a recent check actually succeeded.
 */
export function liveStatus(input: {
  now: number;
  lastSyncedAt: number | null;
  failed: boolean;
  health: HealthReport | null;
}): LiveStatus {
  const { now, lastSyncedAt, failed, health } = input;
  if (lastSyncedAt === null) {
    return failed
      ? { state: 'offline', label: 'Offline', meaning: 'The AgroSense server could not be reached.' }
      : { state: 'connecting', label: 'Connecting', meaning: 'Waiting for the first response from the server.' };
  }
  if (failed || now - lastSyncedAt > STALE_AFTER_MS) {
    return {
      state: 'offline',
      label: 'Offline',
      meaning: `The server stopped responding. Last synced ${syncLabel(now - lastSyncedAt)}.`,
    };
  }
  if (health && (health.degradationEngine !== 'READY' || health.liquidationEngine !== 'READY')) {
    return { state: 'degraded', label: 'Degraded', meaning: 'The server is reachable, but an engine reported a failure.' };
  }
  return { state: 'live', label: 'Live', meaning: 'The server is responding and the page is up to date.' };
}

export type DotState = 'healthy' | 'warning' | 'failure';

export const DOT_WORD: Record<DotState, string> = {
  healthy: 'Healthy',
  warning: 'Warning',
  failure: 'Failure',
};

export const dotForLive = (state: LiveState): DotState =>
  state === 'live' ? 'healthy' : state === 'offline' ? 'failure' : 'warning';

/** The four checks the server reports, as dots with the exact meaning of each. */
export function healthDots(health: HealthReport): Array<{ key: string; label: string; state: DotState; meaning: string }> {
  const engine = (name: string, value: string) => ({
    state: (value === 'READY' ? 'healthy' : 'failure') as DotState,
    meaning: value === 'READY' ? `${name} is ready.` : `${name} reported a failure.`,
  });
  return [
    { key: 'api', label: 'Telemetry API', state: 'healthy', meaning: 'The telemetry API is online and accepting readings.' },
    { key: 'degradation', label: 'Degradation engine', ...engine('The degradation engine', health.degradationEngine) },
    { key: 'liquidation', label: 'Liquidation engine', ...engine('The liquidation engine', health.liquidationEngine) },
    { key: 'database', label: 'Database', state: 'healthy', meaning: 'The database is connected.' },
  ];
}

/**
 * The words in the status pill, e.g. "Live • synced 2s ago".
 * Offline keeps the last good time, so the person knows how stale the page is.
 */
export function pillText(status: LiveStatus, lastSyncedAt: number | null, now: number): string {
  if (status.state === 'connecting') return 'Connecting…';
  if (lastSyncedAt === null) return status.label;
  const age = syncLabel(now - lastSyncedAt);
  return status.state === 'offline' ? `Offline • last synced ${age}` : `${status.label} • synced ${age}`;
}
