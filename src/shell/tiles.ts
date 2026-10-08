import type { HealthReport } from '../api';

export type TileState = 'healthy' | 'failing' | 'checking';
export type StreamState = 'connecting' | 'open' | 'closed';

export interface StatusTile {
  key: 'api' | 'database' | 'model' | 'marketplace' | 'realtime';
  label: string;
  state: TileState;
  detail: string;
}

/**
 * The five tiles. Each is the server's own answer: the health report for four of them, and
 * whether the live-update stream is actually connected for the fifth. Nothing is assumed.
 */
export function statusTiles(health: HealthReport | null, stream: StreamState): StatusTile[] {
  const ready = (v: string | undefined, ok: string) => (v === undefined ? 'checking' : v === ok ? 'healthy' : 'failing');
  const detail = (s: TileState, good: string, bad: string) => (s === 'healthy' ? good : s === 'failing' ? bad : 'Checking…');
  const api = ready(health?.telemetryApi, 'ONLINE');
  const db = ready(health?.database, 'CONNECTED');
  const model = ready(health?.degradationEngine, 'READY');
  const market = ready(health?.liquidationEngine, 'READY');
  const rt: TileState = stream === 'open' ? 'healthy' : stream === 'closed' ? 'failing' : 'checking';
  return [
    { key: 'api', label: 'API', state: api, detail: detail(api, 'Accepting readings', 'Not responding') },
    { key: 'database', label: 'Database', state: db, detail: detail(db, 'Connected', 'Not connected') },
    { key: 'model', label: 'Model', state: model, detail: detail(model, 'Known-answer test passed', 'Known-answer test failed') },
    { key: 'marketplace', label: 'Marketplace', state: market, detail: detail(market, 'Markdown engine ready', 'Markdown engine failed') },
    { key: 'realtime', label: 'Realtime', state: rt, detail: detail(rt, 'Live stream connected', 'Stream down, polling instead') },
  ];
}
