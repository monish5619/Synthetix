/**
 * Liquidation recommendation engine. Pure: turns a risk level into a markdown,
 * prices, urgency, reason, and retailer action, using the policy in config.ts.
 */
import {
  LIQUIDATION_MAX_MARKDOWN_PCT,
  LIQUIDATION_POLICY,
  type RiskLevel,
  type Urgency,
} from './config.js';
import { assertMarkdownPct, assertPricePerKg } from './guards.js';
import type { ModelOutput } from './model.js';

export interface LiquidationDecision {
  riskLevel: RiskLevel;
  markdownPct: number;
  previousMarkdownPct: number;
  originalPricePerKg: number;
  recommendedPricePerKg: number;
  urgency: Urgency;
  reason: string;
  retailerAction: string;
  sellByHours: number;
  /** True only when the markdown deepens. Repeat readings at the same level do not re-recommend. */
  deepened: boolean;
}

const THRESHOLD_LABEL: Record<RiskLevel, string> = {
  NORMAL: 'normal',
  WATCH: 'watch',
  HIGH: 'high-risk',
  CRITICAL: 'critical liquidation',
};

export function decideLiquidation(input: {
  output: ModelOutput;
  originalPricePerKg: number;
  previousMarkdownPct: number;
}): LiquidationDecision {
  const { output, previousMarkdownPct } = input;
  const originalPricePerKg = assertPricePerKg(input.originalPricePerKg, 'original price');
  assertMarkdownPct(previousMarkdownPct, 'previous markdown percentage');
  const rule = LIQUIDATION_POLICY[output.riskLevel];

  // Discounts only deepen, so a later milder reading never raises the price back.
  const markdownPct = Math.min(LIQUIDATION_MAX_MARKDOWN_PCT, Math.max(previousMarkdownPct, rule.markdownPct));

  return {
    riskLevel: output.riskLevel,
    markdownPct,
    previousMarkdownPct,
    originalPricePerKg,
    recommendedPricePerKg: round2(originalPricePerKg * (1 - markdownPct / 100)),
    urgency: rule.urgency,
    reason: reasonFor(output),
    retailerAction: rule.retailerAction,
    sellByHours: Math.max(0, Math.floor(output.remainingHours)),
    deepened: markdownPct > previousMarkdownPct,
  };
}

/** Deterministic reason built from the model's own drivers. */
export function reasonFor(output: ModelOutput): string {
  if (output.riskLevel === 'NORMAL') return 'Predicted shelf life is within the normal range.';

  const thermal = output.temperatureStress > 1;
  const humid = output.humidityFactor > 1;
  const driver = thermal && humid
    ? 'elevated thermal exposure and humidity'
    : thermal
      ? 'elevated thermal exposure'
      : humid
        ? 'elevated humidity'
        : 'cumulative exposure';

  return `Predicted shelf life has fallen below the ${THRESHOLD_LABEL[output.riskLevel]} threshold due to ${driver}.`;
}

export function discountedPrice(basePricePerKg: number, markdownPct: number): number {
  assertPricePerKg(basePricePerKg, 'base price');
  assertMarkdownPct(markdownPct);
  return round2(basePricePerKg * (1 - markdownPct / 100));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
