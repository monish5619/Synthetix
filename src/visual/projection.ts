/**
 * Projected shelf life: where the shipment is heading if conditions stay as the
 * latest reading until it arrives.
 *
 * It does not re-implement the degradation formula. Every point is produced by
 * the server's own `evaluateExposure`, fed the model parameters the API sends,
 * so the projection can never drift from the real model.
 */
import type { RiskLevel } from '../../server/config';
import { evaluateExposure, type ModelParams } from '../../server/model';

export interface ProjectionInput {
  baselineShelfLifeHours: number;
  transitTotalHours: number;
  transitRemainingHours: number;
  cumulativeEquivalentAge: number;
  /** The latest reading, held constant for the projection. */
  temperatureC: number;
  humidityPct: number;
  params: ModelParams;
}

export interface ProjectedPoint {
  /** Transit hours since departure. */
  elapsed: number;
  remaining: number;
}

export interface Projection {
  points: ProjectedPoint[];
  /** Shelf life when the shipment arrives, if conditions hold. */
  atArrival: number;
  /** Transit hour at which shelf life reaches zero, or null if it lasts to arrival. */
  runsOutAtElapsed: number | null;
}

const STEPS = 24;

export function projectShelfLife(input: ProjectionInput): Projection {
  const elapsedNow = Math.max(0, input.transitTotalHours - input.transitRemainingHours);
  const horizon = Math.max(0, input.transitRemainingHours);

  const at = (exposureHours: number) =>
    evaluateExposure({
      baselineShelfLifeHours: input.baselineShelfLifeHours,
      cumulativeBefore: input.cumulativeEquivalentAge,
      exposure: { temperatureC: input.temperatureC, humidityPct: input.humidityPct, exposureHours },
      params: input.params,
    });

  const points: ProjectedPoint[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = (horizon * i) / STEPS;
    points.push({ elapsed: elapsedNow + t, remaining: at(t).remainingHours });
  }

  // The exact hour shelf life hits zero: ageing per hour is constant, so it is a straight line.
  const perHour = at(1).equivalentAgeIncrement;
  const left = input.baselineShelfLifeHours - input.cumulativeEquivalentAge;
  let runsOutAtElapsed: number | null = null;
  if (perHour > 0 && left > 0 && left / perHour < horizon) {
    const t = left / perHour;
    runsOutAtElapsed = elapsedNow + t;
    // Insert the exact crossing, then flatten everything after it at zero.
    const firstAfter = points.findIndex((p) => p.elapsed > runsOutAtElapsed!);
    points.splice(firstAfter, 0, { elapsed: runsOutAtElapsed, remaining: 0 });
  }

  return { points, atArrival: at(horizon).remainingHours, runsOutAtElapsed };
}

/**
 * The shelf-life level below which the liquidation policy starts recommending a
 * markdown: the top edge of the lowest-severity band whose markdown is above zero.
 * Read from the API's policy and risk bands, so nothing is assumed.
 */
export function markdownThreshold(model: {
  riskBands: { normalAboveHours: number; watchAboveHours: number; criticalBelowHours: number };
  liquidationPolicy: Record<RiskLevel, { markdownPct: number }>;
}): { hours: number; level: RiskLevel } | null {
  const edges: Array<[RiskLevel, number]> = [
    ['WATCH', model.riskBands.normalAboveHours],
    ['HIGH', model.riskBands.watchAboveHours],
    ['CRITICAL', model.riskBands.criticalBelowHours],
  ];
  for (const [level, hours] of edges) {
    if (model.liquidationPolicy[level].markdownPct > 0) return { hours, level };
  }
  return null;
}
