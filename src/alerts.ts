import type { RiskLevel } from '../server/config';
import { LIQUIDATION_POLICY } from '../server/config';

/** One short line for a notification. Built from stored fields only. */
export function alertHeadline(a: { severity: RiskLevel; markdownPct: number | null }): string {
  const what = a.severity === 'CRITICAL' ? 'Critical' : 'High';
  return a.markdownPct ? `${what} shelf life detected — markdown applied.` : `${what} shelf life detected — retailer notified.`;
}

export const unreadCount = (alerts: ReadonlyArray<{ acknowledgedAt: string | null }>) => alerts.filter((a) => a.acknowledgedAt === null).length;

const LEVEL_WORD: Record<RiskLevel, string> = { NORMAL: 'Healthy', WATCH: 'Watch', HIGH: 'High risk', CRITICAL: 'Critical' };

/** "35% markdown • Critical shelf life" — the reason chip on a deal. */
export function dealReason(discountPct: number, level: RiskLevel): string {
  const lead = discountPct > 0 ? `${discountPct}% markdown` : 'Full price';
  return `${lead} • ${LEVEL_WORD[level]} shelf life`;
}

/** The one place the policy is explained, from the same table the backend uses. */
export const policyExplanation = () =>
  `Set automatically from remaining shelf life: ${(['WATCH', 'HIGH', 'CRITICAL'] as const).map((l) => `${LEVEL_WORD[l]} ${LIQUIDATION_POLICY[l].markdownPct}%`).join(', ')}. No one edits it by hand.`;
