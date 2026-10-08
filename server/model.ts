/**
 * Deterministic, explainable shelf-life degradation model. No ML, no LLM.
 *
 *   temperatureStress      = q10 ^ ((T − idealTemperatureC) / 10)
 *   humidityFactor         = 1 + humidityPenaltyPerPct × max(0, RH − humidityThresholdPct)
 *   equivalentAgeIncrement = exposureHours × temperatureStress × humidityFactor × calibrationCoefficient
 *   cumulativeEquivalentAge += equivalentAgeIncrement
 *   remainingHours         = max(0, baselineShelfLifeHours − cumulativeEquivalentAge)
 *
 * All numbers come from config.ts. Functions here take explicit inputs and return
 * explicit outputs, so every result can be reproduced by hand.
 */
import { MODEL_CONFIG, MODEL_VERSION, RISK_BANDS, type RiskLevel } from './config.js';

export interface ModelParams {
  q10: number;
  idealTemperatureC: number;
  humidityThresholdPct: number;
  humidityPenaltyPerPct: number;
  calibrationCoefficient: number;
}

export interface ExposureInterval {
  temperatureC: number;
  humidityPct: number;
  exposureHours: number;
}

export interface ModelOutput {
  modelVersion: string;
  baselineShelfLifeHours: number;
  temperatureC: number;
  humidityPct: number;
  exposureHours: number;
  temperatureStress: number;
  humidityFactor: number;
  equivalentAgeIncrement: number;
  cumulativeEquivalentAge: number;
  remainingHours: number;
  remainingDays: number;
  riskLevel: RiskLevel;
  explanation: string;
}

export function temperatureStress(temperatureC: number, params: ModelParams = MODEL_CONFIG): number {
  return Math.pow(params.q10, (temperatureC - params.idealTemperatureC) / 10);
}

export function humidityFactor(humidityPct: number, params: ModelParams = MODEL_CONFIG): number {
  return 1 + params.humidityPenaltyPerPct * Math.max(0, humidityPct - params.humidityThresholdPct);
}

/** Risk band for a remaining-shelf-life value. See config.ts for the band edges. */
export function classifyRisk(remainingHours: number): RiskLevel {
  if (remainingHours > RISK_BANDS.normalAboveHours) return 'NORMAL';
  if (remainingHours > RISK_BANDS.watchAboveHours) return 'WATCH';
  if (remainingHours >= RISK_BANDS.criticalBelowHours) return 'HIGH';
  return 'CRITICAL';
}

/**
 * Applies one exposure interval to the cumulative ageing and returns the full
 * decomposition. `cumulativeBefore` is the equivalent age before this interval.
 */
export function evaluateExposure(input: {
  baselineShelfLifeHours: number;
  cumulativeBefore: number;
  exposure: ExposureInterval;
  params?: ModelParams;
}): ModelOutput {
  const params = input.params ?? MODEL_CONFIG;
  const { exposure } = input;
  if (exposure.exposureHours < 0) throw new RangeError('exposureHours must not be negative');

  const stress = temperatureStress(exposure.temperatureC, params);
  const humidity = humidityFactor(exposure.humidityPct, params);
  const increment = exposure.exposureHours * stress * humidity * params.calibrationCoefficient;
  const cumulative = input.cumulativeBefore + increment;
  const remainingHours = Math.max(0, input.baselineShelfLifeHours - cumulative);

  return {
    modelVersion: MODEL_VERSION,
    baselineShelfLifeHours: input.baselineShelfLifeHours,
    temperatureC: exposure.temperatureC,
    humidityPct: exposure.humidityPct,
    exposureHours: exposure.exposureHours,
    temperatureStress: stress,
    humidityFactor: humidity,
    equivalentAgeIncrement: increment,
    cumulativeEquivalentAge: cumulative,
    remainingHours,
    remainingDays: remainingHours / 24,
    riskLevel: classifyRisk(remainingHours),
    explanation: explain(exposure, stress, humidity, increment, remainingHours, params),
  };
}

/**
 * Deterministic explanation. The same inputs always produce the same sentence,
 * and every number in it comes from the calculation.
 */
export function explain(
  exposure: ExposureInterval,
  stress: number,
  humidity: number,
  increment: number,
  remainingHours: number,
  params: ModelParams = MODEL_CONFIG,
): string {
  const t = exposure.temperatureC;
  const ideal = params.idealTemperatureC;
  const parts: string[] = [];

  if (t > ideal) {
    parts.push(
      `Temperature of ${t.toFixed(1)} °C increased above the ${ideal} °C ideal storage point, increasing thermal ageing ${stress.toFixed(2)}×.`,
    );
  } else if (t < ideal) {
    parts.push(
      `Temperature of ${t.toFixed(1)} °C was below the ${ideal} °C ideal storage point, slowing ageing to ${stress.toFixed(2)}×.`,
    );
  } else {
    parts.push(`Temperature held at the ${ideal} °C ideal storage point, so no thermal penalty applied.`);
  }

  if (humidity > 1) {
    parts.push(
      `Elevated humidity (${exposure.humidityPct.toFixed(0)}% against a ${params.humidityThresholdPct}% threshold) further increased degradation during the recorded exposure interval (${humidity.toFixed(2)}×).`,
    );
  } else {
    parts.push(
      `Humidity of ${exposure.humidityPct.toFixed(0)}% was within the ${params.humidityThresholdPct}% threshold, so no humidity penalty applied.`,
    );
  }

  parts.push(
    `Over ${exposure.exposureHours.toFixed(1)} h this added ${increment.toFixed(2)} h of equivalent ageing, leaving ${remainingHours.toFixed(1)} h of shelf life.`,
  );
  return parts.join(' ');
}
