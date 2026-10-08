import type { RiskLevel } from '../../server/config';
import { RISK_VISUAL, type RiskVisual } from '../risk';

/**
 * One icon per risk level, each a different SHAPE, drawn with currentColor so
 * it follows the badge colour. The shapes alone distinguish the levels:
 * circle-check (normal), outlined triangle (watch), solid triangle (high),
 * solid octagon (critical).
 */
export function RiskIcon({ icon }: { icon: RiskVisual['icon'] }) {
  const common = { viewBox: '0 0 20 20', width: 16, height: 16, 'aria-hidden': true, focusable: false } as const;
  switch (icon) {
    case 'safe':
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="m6.2 10.3 2.7 2.7 5-5.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'watch':
      return (
        <svg {...common}>
          <path d="M10 2.8 18 17H2L10 2.8Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <path d="M10 8v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="10" cy="14.4" r="1.1" fill="currentColor" />
        </svg>
      );
    case 'high':
      return (
        <svg {...common}>
          <path d="M10 2.2 18.6 17.4H1.4L10 2.2Z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
          <path d="M10 7.6v4.6" stroke="var(--color-surface)" strokeWidth="2" strokeLinecap="round" />
          <circle cx="10" cy="14.7" r="1.15" fill="var(--color-surface)" />
        </svg>
      );
    case 'critical':
      return (
        <svg {...common}>
          <path d="M6.6 1.8h6.8l4.8 4.8v6.8l-4.8 4.8H6.6l-4.8-4.8V6.6l4.8-4.8Z" fill="currentColor" />
          <path d="M10 5.8v5.2" stroke="var(--color-surface)" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="10" cy="13.7" r="1.2" fill="var(--color-surface)" />
        </svg>
      );
  }
}

/**
 * Risk, always as icon + colour + written label — never colour alone.
 * The text is the engine's level name (NORMAL / WATCH / HIGH / CRITICAL).
 */
export function RiskBadge({ level }: { level: RiskLevel }) {
  const visual = RISK_VISUAL[level];
  return (
    <span className={`risk-badge risk-${level}`}>
      <RiskIcon icon={visual.icon} />
      <span className="risk-badge-label">{visual.label}</span>
    </span>
  );
}
