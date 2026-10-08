import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MiniGauge } from '../src/components/MiniGauge';
import { SimulatorPanel } from '../src/components/SimulatorPanel';
import { riskCounts, sortFleet } from '../src/fleet';
import { parseChange } from '../src/live';
import { controlTowerLink, pickShipment, selectedIdFromHash } from '../src/selection';
import { PRESETS, matchPreset, parseReading } from '../src/simulator/presets';

const ID = '123e4567-e89b-12d3-a456-426614174000';
const s = (code: string, riskLevel: 'NORMAL' | 'WATCH' | 'HIGH' | 'CRITICAL', remainingHours: number) => ({ id: code, code, riskLevel, remainingHours });

describe('fleet sorting', () => {
  const list = [s('B', 'NORMAL', 100), s('A', 'CRITICAL', 17), s('C', 'HIGH', 30), s('D', 'CRITICAL', 5), s('E', 'WATCH', 40)];

  it('puts the highest risk first, then the least shelf life left', () => {
    expect(sortFleet(list, 'risk').map((x) => x.code)).toEqual(['D', 'A', 'C', 'E', 'B']);
  });
  it('sorts by code and never mutates its input', () => {
    const before = list.map((x) => x.code);
    expect(sortFleet(list, 'code').map((x) => x.code)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(list.map((x) => x.code)).toEqual(before);
  });
  it('counts every level, including empty ones', () => {
    expect(riskCounts(list)).toEqual({ NORMAL: 1, WATCH: 1, HIGH: 1, CRITICAL: 2 });
    expect(riskCounts([])).toEqual({ NORMAL: 0, WATCH: 0, HIGH: 0, CRITICAL: 0 });
  });
});

describe('simulator presets', () => {
  it('has the four requested presets, each recognised by matchPreset', () => {
    expect(PRESETS.map((p) => p.id)).toEqual(['normal', 'reefer-failure', 'door-open', 'traffic-delay']);
    for (const p of PRESETS) expect(matchPreset(p.reading)).toBe(p.id);
    expect(matchPreset({ temperature: 1, humidity: 1, transitDuration: 1 })).toBeNull();
  });
  it('reefer failure is the official 30 °C / 85 % / 6.3 h scenario', () => {
    expect(PRESETS.find((p) => p.id === 'reefer-failure')!.reading).toEqual({ temperature: 30, humidity: 85, transitDuration: 6.3 });
  });
  it('parseReading accepts numbers and rejects blanks and junk', () => {
    expect(parseReading({ temperature: '30', humidity: '85', transitDuration: '6.3' })).toMatchObject({ ok: true });
    expect(parseReading({ temperature: '', humidity: '85', transitDuration: '6.3' }).ok).toBe(false);
    expect(parseReading({ temperature: 'abc', humidity: '85', transitDuration: '6.3' }).ok).toBe(false);
  });
});

describe('shipment selection', () => {
  it('reads ?s= from the hash only when it is a UUID', () => {
    expect(selectedIdFromHash(`#/?s=${ID}`)).toBe(ID);
    expect(selectedIdFromHash('#/?s=nope')).toBeNull();
    expect(selectedIdFromHash('#/telemetry')).toBeNull();
    expect(controlTowerLink(ID)).toBe(`#/?s=${ID}`);
  });
  it('picks by id, then the demo shipment code, then the first', () => {
    const list = [{ id: 'x', code: 'AS-1' }, { id: 'y', code: 'AS-1042' }];
    expect(pickShipment(list, 'x')?.id).toBe('x');
    expect(pickShipment(list.slice(0, 1), 'zzz')?.id).toBe('x');
    expect(pickShipment([], null)).toBeUndefined();
  });
});

describe('change stream messages', () => {
  it('parses valid frames and ignores junk', () => {
    expect(parseChange('{"shipmentId":"a","kind":"telemetry"}')).toEqual({ shipmentId: 'a', kind: 'telemetry' });
    expect(parseChange('{"shipmentId":"a","kind":"other"}')).toBeNull();
    expect(parseChange('not json')).toBeNull();
  });
});

describe('components', () => {
  it('MiniGauge shows hours and a risk-coloured arc', () => {
    const markup = renderToStaticMarkup(<MiniGauge remaining={18} baseline={120} level="CRITICAL" />);
    expect(markup).toContain('mini-fill');
    expect(markup).toContain('--color-critical');
  });
  it('SimulatorPanel renders presets and both actions, with no preview before one is asked for', () => {
    const markup = renderToStaticMarkup(<SimulatorPanel shipmentId={ID} disabled={false} onCommit={async () => {}} />);
    for (const t of ['Normal', 'Reefer failure', 'Door open', 'Traffic delay', 'Preview impact', 'Commit telemetry']) expect(markup).toContain(t);
    expect(markup).not.toContain('nothing saved');
  });
});
