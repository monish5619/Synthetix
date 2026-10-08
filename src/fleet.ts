import { RISK_ORDER, type RiskLevel } from '../server/config';

export type FleetSort = 'risk' | 'code';

interface Sortable {
  code: string;
  riskLevel: RiskLevel;
  remainingHours: number;
}

/**
 * "risk": the most urgent first: highest risk level, then the least shelf life left,
 * then by code so the order is stable. "code": plain alphabetical by shipment code.
 * Never mutates its input.
 */
export function sortFleet<T extends Sortable>(list: readonly T[], mode: FleetSort): T[] {
  const copy = [...list];
  if (mode === 'code') return copy.sort((a, b) => a.code.localeCompare(b.code));
  return copy.sort(
    (a, b) =>
      RISK_ORDER[b.riskLevel] - RISK_ORDER[a.riskLevel] ||
      a.remainingHours - b.remainingHours ||
      a.code.localeCompare(b.code),
  );
}

/** How many shipments sit at each risk level. Every level is present, even at zero. */
export function riskCounts(list: ReadonlyArray<{ riskLevel: RiskLevel }>): Record<RiskLevel, number> {
  const counts: Record<RiskLevel, number> = { NORMAL: 0, WATCH: 0, HIGH: 0, CRITICAL: 0 };
  for (const s of list) counts[s.riskLevel]++;
  return counts;
}
