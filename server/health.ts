/**
 * Health checks for the subsystems shown in the UI. Each engine is checked by running
 * it on a known input and comparing the result with an independently known answer.
 * A status is "READY" only if the check passes now.
 */
import { LIQUIDATION_POLICY, MODEL_CONFIG } from './config.js';
import { decideLiquidation } from './liquidation.js';
import { evaluateExposure, type ModelOutput } from './model.js';

export type EngineStatus = 'READY' | 'FAILED';

export interface HealthReport {
  telemetryApi: 'ONLINE';
  database: 'CONNECTED';
  degradationEngine: EngineStatus;
  liquidationEngine: EngineStatus;
  checkedAt: string;
}

/** Degradation engine: no exposure leaves 120 h at NORMAL, and the 30 °C / 85 % RH / 6.3 h case lands at 17.65 h. */
export function checkDegradationEngine(): EngineStatus {
  try {
    const neutral = evaluateExposure({
      baselineShelfLifeHours: 120,
      cumulativeBefore: 0,
      exposure: { temperatureC: MODEL_CONFIG.idealTemperatureC, humidityPct: 60, exposureHours: 0 },
    });
    const spike = evaluateExposure({
      baselineShelfLifeHours: 120,
      cumulativeBefore: 0,
      exposure: { temperatureC: 30, humidityPct: 85, exposureHours: 6.3 },
    });
    const ok =
      neutral.remainingHours === 120 &&
      neutral.riskLevel === 'NORMAL' &&
      Math.abs(spike.remainingHours - 17.65) < 0.01 &&
      spike.riskLevel === 'CRITICAL';
    return ok ? 'READY' : 'FAILED';
  } catch {
    return 'FAILED';
  }
}

/** Liquidation engine: a CRITICAL output must produce the configured markdown and a discounted price. */
export function checkLiquidationEngine(): EngineStatus {
  try {
    const output = { riskLevel: 'CRITICAL', remainingHours: 17.65, temperatureStress: 2, humidityFactor: 1.2 } as ModelOutput;
    const d = decideLiquidation({ output, originalPricePerKg: 100, previousMarkdownPct: 0 });
    const ok =
      d.markdownPct === LIQUIDATION_POLICY.CRITICAL.markdownPct &&
      d.recommendedPricePerKg === 100 - LIQUIDATION_POLICY.CRITICAL.markdownPct &&
      d.deepened;
    return ok ? 'READY' : 'FAILED';
  } catch {
    return 'FAILED';
  }
}
