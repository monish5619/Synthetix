import type { RiskLevel } from '../server/config';

/**
 * How each risk level is shown. Risk is never colour alone: every level has
 * its own icon SHAPE, a colour, and a written label — so it reads correctly
 * in greyscale, on a washed-out projector, and for colour-blind viewers.
 */
export interface RiskVisual {
  /** The engine's level name, shown as the label. */
  label: RiskLevel;
  /** Which icon shape to draw. */
  icon: 'safe' | 'watch' | 'high' | 'critical';
  /** CSS custom property holding the level's colour. */
  tone: string;
}

export const RISK_VISUAL: Record<RiskLevel, RiskVisual> = {
  NORMAL: { label: 'NORMAL', icon: 'safe', tone: '--color-safe' },
  WATCH: { label: 'WATCH', icon: 'watch', tone: '--color-watch' },
  HIGH: { label: 'HIGH', icon: 'high', tone: '--color-high' },
  CRITICAL: { label: 'CRITICAL', icon: 'critical', tone: '--color-critical' },
};

export const RISK_LEVELS: readonly RiskLevel[] = ['NORMAL', 'WATCH', 'HIGH', 'CRITICAL'];
