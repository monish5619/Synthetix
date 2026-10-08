import { describe, expect, it } from 'vitest';
import {
  applyInterval,
  assess,
  classifyRisk,
  discountedPrice,
  liquidationMarkdownPct,
  thermalMultiplier,
  humidityMultiplier,
} from '../server/model';
import { DEMO_SHIPMENT } from '../server/demo';

const profile = DEMO_SHIPMENT.profile;
const baseline = { equivalentAgeHours: 0, transitRemainingHours: DEMO_SHIPMENT.transitHours };

describe('degradation model', () => {
  it('is neutral at the reference conditions', () => {
    expect(thermalMultiplier(4, profile)).toBeCloseTo(1, 10);
    expect(humidityMultiplier(60, profile)).toBe(1);
  });

  it('starts at 120 h shelf life, LOW risk, 3.33× cover', () => {
    const a = assess(profile, baseline, { temperatureC: 4, humidityPct: 60 });
    expect(a.remainingShelfLifeHours).toBeCloseTo(120, 6);
    expect(a.margin).toBeCloseTo(120 / 36, 6);
    expect(a.riskLevel).toBe('LOW');
  });

  it('doubles decay rate for each 10 °C above reference when Q10 = 2', () => {
    expect(thermalMultiplier(14, { ...profile, q10: 2 })).toBeCloseTo(2, 10);
  });

  it('reproduces the ambient spike: ~18 h left, CRITICAL, ~34 % markdown', () => {
    const next = applyInterval(profile, baseline, { temperatureC: 22, humidityPct: 80 }, 1.5);
    const a = assess(profile, next, { temperatureC: 22, humidityPct: 80 });

    expect(a.thermalMultiplier).toBeCloseTo(Math.pow(2.5, 1.8), 6); // ≈ 5.20
    expect(a.humidityMultiplier).toBeCloseTo(1.2, 10);
    expect(a.remainingShelfLifeHours).toBeGreaterThan(17);
    expect(a.remainingShelfLifeHours).toBeLessThan(18.5);
    expect(a.transitRemainingHours).toBeCloseTo(34.5, 10);
    expect(a.riskLevel).toBe('CRITICAL');
    expect(liquidationMarkdownPct(a.margin)).toBe(34);
  });

  it('classifies risk by margin thresholds', () => {
    expect(classifyRisk(2.5, 100)).toBe('LOW');
    expect(classifyRisk(1.5, 100)).toBe('MODERATE');
    expect(classifyRisk(1.1, 100)).toBe('HIGH');
    expect(classifyRisk(0.9, 100)).toBe('CRITICAL');
    expect(classifyRisk(3, 0)).toBe('CRITICAL');
  });

  it('caps markdown at 60 % and prices ₹100/kg correctly', () => {
    expect(liquidationMarkdownPct(-5)).toBe(60);
    expect(discountedPrice(100, 34)).toBe(66);
  });

  it('never lets shelf life go negative once reference life is spent', () => {
    const next = applyInterval(profile, { equivalentAgeHours: 0, transitRemainingHours: 36 }, { temperatureC: 30, humidityPct: 90 }, 24);
    const a = assess(profile, next, { temperatureC: 30, humidityPct: 90 });
    expect(a.remainingShelfLifeHours).toBe(0);
    expect(a.riskLevel).toBe('CRITICAL');
  });

  it('does not let transit remaining go below zero', () => {
    const next = applyInterval(profile, baseline, { temperatureC: 4, humidityPct: 60 }, 50);
    expect(next.transitRemainingHours).toBe(0);
  });
});
