import { describe, expect, it } from 'vitest';
import { MODEL_CONFIG, RISK_BANDS } from '../server/config';
import { classifyRisk, evaluateExposure, humidityFactor, temperatureStress } from '../server/model';

const BASELINE = 120;
const at = (temperatureC: number, humidityPct: number, exposureHours: number, cumulativeBefore = 0) =>
  evaluateExposure({
    baselineShelfLifeHours: BASELINE,
    cumulativeBefore,
    exposure: { temperatureC, humidityPct, exposureHours },
  });

describe('Q10 temperature stress', () => {
  it('is exactly 1 at the ideal storage temperature', () => {
    expect(temperatureStress(MODEL_CONFIG.idealTemperatureC)).toBe(1);
  });

  it('multiplies by Q10 for every 10 °C above the ideal', () => {
    expect(temperatureStress(MODEL_CONFIG.idealTemperatureC + 10)).toBeCloseTo(MODEL_CONFIG.q10, 12);
  });

  it('slows ageing below the ideal temperature', () => {
    expect(temperatureStress(MODEL_CONFIG.idealTemperatureC - 10)).toBeCloseTo(1 / MODEL_CONFIG.q10, 12);
  });
});

describe('humidity factor', () => {
  it('is 1 at or below the threshold', () => {
    expect(humidityFactor(MODEL_CONFIG.humidityThresholdPct)).toBe(1);
    expect(humidityFactor(30)).toBe(1);
  });

  it('adds the configured penalty per point above the threshold', () => {
    expect(humidityFactor(90)).toBeCloseTo(1 + MODEL_CONFIG.humidityPenaltyPerPct * 30, 12);
  });
});

describe('model scenarios', () => {
  it('1. normal storage: 10 h at 4 °C / 60 % loses about 10 h and stays NORMAL', () => {
    const r = at(4, 60, 10);
    expect(r.temperatureStress).toBe(1);
    expect(r.humidityFactor).toBe(1);
    expect(r.equivalentAgeIncrement).toBeCloseTo(10 * MODEL_CONFIG.calibrationCoefficient, 10);
    expect(r.remainingHours).toBeCloseTo(BASELINE - 10 * MODEL_CONFIG.calibrationCoefficient, 10);
    expect(r.riskLevel).toBe('NORMAL');
  });

  it('2. moderate temperature rise (8 °C): stress is Q10^0.4 and ageing rises accordingly', () => {
    const r = at(8, 60, 10);
    expect(r.temperatureStress).toBeCloseTo(Math.pow(2.5, 0.4), 10);
    expect(r.remainingHours).toBeLessThan(at(4, 60, 10).remainingHours);
    expect(r.riskLevel).toBe('NORMAL');
  });

  it('3. high temperature (22 °C, no humidity penalty): 10 h drops the shelf life into WATCH', () => {
    const r = at(22, 60, 10);
    expect(r.temperatureStress).toBeCloseTo(Math.pow(2.5, 1.8), 10);
    expect(r.equivalentAgeIncrement).toBeCloseTo(10 * Math.pow(2.5, 1.8) * MODEL_CONFIG.calibrationCoefficient, 8);
    expect(r.riskLevel).toBe('WATCH');
  });

  it('4. high humidity (90 %) at ideal temperature: ageing grows by the humidity factor alone', () => {
    const r = at(4, 90, 10);
    expect(r.temperatureStress).toBe(1);
    expect(r.humidityFactor).toBeCloseTo(1 + MODEL_CONFIG.humidityPenaltyPerPct * 30, 12);
    expect(r.equivalentAgeIncrement).toBeGreaterThan(at(4, 60, 10).equivalentAgeIncrement);
  });

  it('5. long exposure: ageing accumulates and remaining shelf life floors at zero', () => {
    const hundred = at(4, 60, 100);
    expect(hundred.remainingHours).toBeCloseTo(BASELINE - 100 * MODEL_CONFIG.calibrationCoefficient, 8);
    expect(hundred.riskLevel).toBe('HIGH');

    const beyond = at(4, 60, 130);
    expect(beyond.remainingHours).toBe(0);
    expect(beyond.riskLevel).toBe('CRITICAL');
  });

  it('cumulative ageing carries from one interval into the next', () => {
    const first = at(22, 80, 4);
    const second = at(4, 60, 2, first.cumulativeEquivalentAge);
    expect(second.cumulativeEquivalentAge).toBeCloseTo(first.cumulativeEquivalentAge + second.equivalentAgeIncrement, 10);
    expect(second.remainingHours).toBeCloseTo(BASELINE - second.cumulativeEquivalentAge, 10);
  });

  it('6. risk bands: thresholds are inclusive where the config says so', () => {
    expect(classifyRisk(RISK_BANDS.normalAboveHours + 0.01)).toBe('NORMAL');
    expect(classifyRisk(RISK_BANDS.normalAboveHours)).toBe('WATCH');
    expect(classifyRisk(RISK_BANDS.watchAboveHours + 0.01)).toBe('WATCH');
    expect(classifyRisk(RISK_BANDS.watchAboveHours)).toBe('HIGH');
    expect(classifyRisk(RISK_BANDS.criticalBelowHours)).toBe('HIGH');
    expect(classifyRisk(RISK_BANDS.criticalBelowHours - 0.01)).toBe('CRITICAL');
    expect(classifyRisk(0)).toBe('CRITICAL');
  });

  it('explanations are deterministic and cite the numbers the model used', () => {
    const a = at(22, 80, 14);
    const b = at(22, 80, 14);
    expect(a.explanation).toBe(b.explanation);
    expect(a.explanation).toContain('22.0 °C');
    expect(a.explanation).toContain('Elevated humidity');
    expect(at(4, 60, 1).explanation).toContain('no thermal penalty applied');
  });

  it('rejects negative exposure instead of silently reversing ageing', () => {
    expect(() => at(4, 60, -1)).toThrow(RangeError);
  });
});
