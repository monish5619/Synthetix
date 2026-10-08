import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WhyDrop } from '../src/components/WhyDrop';
import { statusTiles } from '../src/shell/tiles';
import { demoStates } from './helpers/states';

const ok = { telemetryApi: 'ONLINE', database: 'CONNECTED', degradationEngine: 'READY', liquidationEngine: 'READY', checkedAt: '2026-01-01T00:00:00Z' } as const;

describe('status tiles', () => {
  it('five tiles, all healthy when the server and stream are fine', () => {
    const tiles = statusTiles(ok, 'open');
    expect(tiles.map((t) => t.label)).toEqual(['API', 'Database', 'Model', 'Marketplace', 'Realtime']);
    expect(tiles.every((t) => t.state === 'healthy')).toBe(true);
  });
  it('a failed engine or a closed stream turns exactly that tile red', () => {
    const t = statusTiles({ ...ok, degradationEngine: 'FAILED' }, 'closed');
    expect(t.filter((x) => x.state === 'failing').map((x) => x.key)).toEqual(['model', 'realtime']);
  });
  it('shows "checking", never "healthy", before any answer exists', () => {
    expect(statusTiles(null, 'connecting').every((t) => t.state === 'checking')).toBe(true);
  });
});

describe('Why did shelf life drop?', () => {
  it('shows the stored values of the official scenario, step by step', () => {
    const { spiked } = demoStates();
    const m = renderToStaticMarkup(<WhyDrop state={spiked} />);
    for (const t of ['30.0 °C', '85% RH', '×10.83', '×1.50', '+102.35 h', '17.7 h', 'Q10']) expect(m).toContain(t);
    expect(m).toContain('Q10 ^ ((T − 4) / 10)');
    expect(m).toContain('remaining = baseline − cumulative ageing');
  });
  it('at the baseline it shows zero ageing and the full reference life, not invented drops', () => {
    const { baseline: fresh } = demoStates();
    const m = renderToStaticMarkup(<WhyDrop state={fresh} />);
    expect(m).toContain('+0.00 h');
    expect(m).toContain('120.0 h');
  });
});
