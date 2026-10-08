import type { RiskLevel } from '../server/config';

export const RISK_COPY: Record<RiskLevel, { label: string; note: string }> = {
  NORMAL: { label: 'Normal', note: 'Shelf life comfortably outlasts the planned storage window.' },
  WATCH: { label: 'Watch', note: 'Shelf life is narrowing. Keep the next readings under review.' },
  HIGH: { label: 'High risk', note: 'Shelf life is close to running out. Prioritise sale.' },
  CRITICAL: { label: 'Critical', note: 'Produce will spoil before it can be sold at full price.' },
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
