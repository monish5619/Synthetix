import { describe, expect, it } from 'vitest';
import { LIQUIDATION_POLICY, MODEL_CONFIG, RISK_BANDS } from '../server/config';
import { evaluateExposure } from '../server/model';
import { GAUGE, arcPath, fractionOf, gaugeGeometry, polar } from '../src/visual/gauge';
import { markdownThreshold, projectShelfLife, type ProjectionInput } from '../src/visual/projection';
import { ROUTE_D, heatPct, routeEnd, routePoint, routeStart, stretchesOf } from '../src/visual/routePath';
import { MAX_TOASTS, TOAST_MS, addToast, removeToast, type Toast } from '../src/toasts';

describe('gauge geometry', () => {
  it('measures the share of reference life left, clamped to 0…1', () => {
    expect(fractionOf(60, 120)).toBe(0.5);
    expect(fractionOf(-5, 120)).toBe(0);
    expect(fractionOf(500, 120)).toBe(1);
    expect(fractionOf(10, 0)).toBe(0); // no baseline: nothing to measure against
    expect(fractionOf(Number.NaN, 120)).toBe(0);
  });

  it('turns the fraction into the arc offset (pathLength 100)', () => {
    expect(gaugeGeometry({ remaining: 120, baseline: 120, edges: [] }).dashOffset).toBe(0);
    expect(gaugeGeometry({ remaining: 60, baseline: 120, edges: [] }).dashOffset).toBe(50);
    expect(gaugeGeometry({ remaining: 0, baseline: 120, edges: [] }).dashOffset).toBe(100);
  });

  it('places band-edge ticks on the same scale as the arc, in order', () => {
    const { ticks } = gaugeGeometry({
      remaining: 17.7,
      baseline: 120,
      edges: [RISK_BANDS.normalAboveHours, RISK_BANDS.criticalBelowHours, RISK_BANDS.watchAboveHours],
    });
    expect(ticks.map((t) => t.hours)).toEqual([18, 36, 72]);
    // 18 h of 120 h along a 270° sweep starting at 135°
    expect(ticks[0]?.angle).toBeCloseTo(135 + (18 / 120) * 270, 1);
    // later ticks sit further round the arc
    expect(ticks[0]!.angle).toBeLessThan(ticks[1]!.angle);
    expect(ticks[1]!.angle).toBeLessThan(ticks[2]!.angle);
  });

  it('ignores ticks that fall outside the scale', () => {
    const { ticks } = gaugeGeometry({ remaining: 10, baseline: 50, edges: [0, 18, 50, 72] });
    expect(ticks.map((t) => t.hours)).toEqual([18]);
  });

  it('draws one 270° arc whose ends are at the gauge opening', () => {
    expect(arcPath()).toMatch(/^M [\d.-]+ [\d.-]+ A 108 108 0 1 1 [\d.-]+ [\d.-]+$/);
    const s = polar(GAUGE.r, GAUGE.startDeg);
    const e = polar(GAUGE.r, GAUGE.startDeg + GAUGE.sweepDeg);
    expect(s.y).toBeGreaterThan(GAUGE.cy); // both ends are below the centre: the opening faces down
    expect(e.y).toBeGreaterThan(GAUGE.cy);
    expect(s.x).toBeLessThan(GAUGE.cx);
    expect(e.x).toBeGreaterThan(GAUGE.cx);
  });
});

describe('projection', () => {
  const base: ProjectionInput = {
    baselineShelfLifeHours: 120,
    transitTotalHours: 48,
    transitRemainingHours: 29.7,
    cumulativeEquivalentAge: 102.35,
    temperatureC: 30,
    humidityPct: 85,
    params: MODEL_CONFIG,
  };

  it('is produced by the real model formula, not a copy of it', () => {
    const p = projectShelfLife(base);
    const direct = evaluateExposure({
      baselineShelfLifeHours: 120,
      cumulativeBefore: base.cumulativeEquivalentAge,
      exposure: { temperatureC: 30, humidityPct: 85, exposureHours: 29.7 },
    });
    expect(p.atArrival).toBeCloseTo(direct.remainingHours, 10);
    // every sampled point agrees with the model at that exposure
    for (const pt of p.points) {
      const exposure = pt.elapsed - (48 - 29.7);
      const at = evaluateExposure({ baselineShelfLifeHours: 120, cumulativeBefore: base.cumulativeEquivalentAge, exposure: { temperatureC: 30, humidityPct: 85, exposureHours: exposure } });
      expect(pt.remaining).toBeCloseTo(at.remainingHours, 8);
    }
  });

  it('starts where the shipment is now and never rises', () => {
    const p = projectShelfLife({ ...base, temperatureC: 12, cumulativeEquivalentAge: 40 });
    expect(p.points[0]?.remaining).toBeCloseTo(80, 8);
    expect(p.points[0]?.elapsed).toBeCloseTo(48 - 29.7, 8);
    for (let i = 1; i < p.points.length; i++) expect(p.points[i]!.remaining).toBeLessThanOrEqual(p.points[i - 1]!.remaining + 1e-9);
    expect(p.points.at(-1)?.elapsed).toBeCloseTo(48, 8);
  });

  it('finds the exact hour shelf life runs out, and holds at zero after it', () => {
    const p = projectShelfLife(base);
    expect(p.runsOutAtElapsed).not.toBeNull();
    const crossing = p.points.find((pt) => pt.elapsed === p.runsOutAtElapsed);
    expect(crossing?.remaining).toBe(0);
    expect(p.atArrival).toBe(0);
    for (const pt of p.points) expect(pt.remaining).toBeGreaterThanOrEqual(0);
  });

  it('reports no run-out when shelf life lasts to arrival', () => {
    const p = projectShelfLife({ ...base, temperatureC: 4, humidityPct: 60, cumulativeEquivalentAge: 0, transitRemainingHours: 48 });
    expect(p.runsOutAtElapsed).toBeNull();
    expect(p.atArrival).toBeCloseTo(72, 8); // ideal conditions still age 1 h per hour: 120 − 48
  });

  it('is a single point when the shipment has arrived', () => {
    const p = projectShelfLife({ ...base, transitRemainingHours: 0 });
    expect(new Set(p.points.map((pt) => pt.elapsed)).size).toBe(1);
  });

  it('uses the parameters it is given: a hotter Q10 ages faster', () => {
    // A mild scenario, so neither result is clamped at zero.
    const mild = { ...base, temperatureC: 12, humidityPct: 60, cumulativeEquivalentAge: 0 };
    const slow = projectShelfLife({ ...mild, params: { ...MODEL_CONFIG, q10: 2 } });
    const fast = projectShelfLife({ ...mild, params: { ...MODEL_CONFIG, q10: 3 } });
    expect(slow.atArrival).toBeGreaterThan(0);
    expect(fast.atArrival).toBeLessThan(slow.atArrival);
  });
});

describe('markdown threshold', () => {
  const model = { riskBands: RISK_BANDS, liquidationPolicy: LIQUIDATION_POLICY };

  it('is where the policy first recommends a markdown, read from the policy', () => {
    expect(markdownThreshold(model)).toEqual({ hours: RISK_BANDS.normalAboveHours, level: 'WATCH' });
  });

  it('moves down when milder levels carry no markdown', () => {
    const policy = { ...LIQUIDATION_POLICY, WATCH: { ...LIQUIDATION_POLICY.WATCH, markdownPct: 0 } };
    expect(markdownThreshold({ ...model, liquidationPolicy: policy })).toEqual({ hours: RISK_BANDS.watchAboveHours, level: 'HIGH' });
  });

  it('is absent when no level has a markdown', () => {
    const none = Object.fromEntries(Object.entries(LIQUIDATION_POLICY).map(([k, v]) => [k, { ...v, markdownPct: 0 }])) as typeof LIQUIDATION_POLICY;
    expect(markdownThreshold({ ...model, liquidationPolicy: none })).toBeNull();
  });
});

describe('route geometry', () => {
  it('starts and ends where the road does', () => {
    expect(routePoint(0)).toMatchObject({ x: routeStart.x, y: routeStart.y });
    expect(routePoint(1).x).toBeCloseTo(routeEnd.x, 1);
    expect(routePoint(1).y).toBeCloseTo(routeEnd.y, 1);
    expect(ROUTE_D.startsWith('M ')).toBe(true);
  });

  it('moves steadily along the road, and clamps nonsense', () => {
    let last = -Infinity;
    for (let f = 0; f <= 1.0001; f += 0.05) {
      const x = routePoint(f).x;
      expect(x).toBeGreaterThanOrEqual(last - 0.01);
      last = x;
    }
    expect(routePoint(-3)).toEqual(routePoint(0));
    expect(routePoint(9)).toEqual(routePoint(1));
    expect(routePoint(Number.NaN)).toEqual(routePoint(0));
  });

  it('keeps a vehicle upright', () => {
    for (let f = 0; f <= 1; f += 0.05) expect(Math.abs(routePoint(f).angle)).toBeLessThanOrEqual(30);
  });

  it('measures by distance travelled: half the transit is half the road', () => {
    const a = routePoint(0.25);
    const b = routePoint(0.5);
    const c = routePoint(0.75);
    const d1 = Math.hypot(b.x - a.x, b.y - a.y);
    const d2 = Math.hypot(c.x - b.x, c.y - b.y);
    expect(Math.abs(d1 - d2) / Math.max(d1, d2)).toBeLessThan(0.2);
  });

  it('turns stored model runs into stretches carrying their temperature', () => {
    const snaps = [
      { transitRemainingHours: 48, temperatureC: 4 },
      { transitRemainingHours: 40, temperatureC: 5 },
      { transitRemainingHours: 24, temperatureC: 30 },
    ];
    const s = stretchesOf(snaps, 48);
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ from: 0, temperatureC: 5 });
    expect(s[0]?.to).toBeCloseTo(8 / 48, 8);
    expect(s[1]).toMatchObject({ temperatureC: 30 });
    expect(s[1]?.to).toBeCloseTo(0.5, 8);
  });

  it('invents nothing: no readings, no stretches; no transit time, no stretches', () => {
    expect(stretchesOf([{ transitRemainingHours: 48, temperatureC: 4 }], 48)).toEqual([]);
    expect(stretchesOf([], 48)).toEqual([]);
    expect(stretchesOf([{ transitRemainingHours: 1, temperatureC: 1 }, { transitRemainingHours: 0, temperatureC: 1 }], 0)).toEqual([]);
  });

  it('scales heat from the ideal (0) to the hottest recorded (100)', () => {
    expect(heatPct(4, 4, 30)).toBe(0);
    expect(heatPct(30, 4, 30)).toBe(100);
    expect(heatPct(17, 4, 30)).toBe(50);
    expect(heatPct(-10, 4, 30)).toBe(0);
    expect(heatPct(50, 4, 30)).toBe(100);
    expect(heatPct(20, 4, 4)).toBe(0); // no range, no heat
  });
});

describe('toasts', () => {
  const t = (id: number): Toast => ({ id, kind: 'success', text: `m${id}` });

  it('keeps only the newest few', () => {
    let list: Toast[] = [];
    for (let i = 1; i <= MAX_TOASTS + 2; i++) list = addToast(list, t(i));
    expect(list.map((x) => x.id)).toEqual([3, 4, 5]);
  });

  it('removes one by id', () => {
    expect(removeToast([t(1), t(2), t(3)], 2).map((x) => x.id)).toEqual([1, 3]);
  });

  it('keeps errors on screen longer than successes', () => {
    expect(TOAST_MS.error).toBeGreaterThan(TOAST_MS.success);
  });
});
