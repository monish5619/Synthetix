import type { RiskLevel } from '../server/model';

export const RISK_COPY: Record<RiskLevel, { label: string; note: string }> = {
  LOW: { label: 'Low risk', note: 'Shelf life comfortably outlasts transit.' },
  MODERATE: { label: 'Moderate', note: 'Margin is narrowing. Watch the next reading.' },
  HIGH: { label: 'High risk', note: 'Shelf life is short of arrival. Liquidation threshold crossed.' },
  CRITICAL: { label: 'Critical', note: 'Produce will spoil before it reaches the destination.' },
};

/** "5 days · 0.0 h" style, from a decimal hour count. */
export function daysAndHours(hours: number): string {
  const days = Math.floor(hours / 24);
  const rest = hours - days * 24;
  return `${days} ${days === 1 ? 'day' : 'days'} · ${rest.toFixed(1)} h`;
}

export const hours = (value: number) => value.toFixed(1);
export const multiplier = (value: number) => `×${value.toFixed(2)}`;
export const rupees = (value: number) => `₹${value.toFixed(2).replace(/\.00$/, '')}`;

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
