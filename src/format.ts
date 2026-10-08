import type { RiskLevel } from '../server/config';

/** Display copy for each risk level. The level names come from the engine. */
export const RISK_COPY: Record<RiskLevel, { label: string; short: string; note: string }> = {
  NORMAL: {
    label: 'Low spoilage risk',
    short: 'LOW',
    note: 'Shelf life comfortably outlasts the planned storage window.',
  },
  WATCH: {
    label: 'Moderate risk',
    short: 'MODERATE',
    note: 'Shelf life is narrowing. Keep the next readings under review.',
  },
  HIGH: {
    label: 'High spoilage risk',
    short: 'HIGH',
    note: 'Shelf life is close to running out. Prioritise sale.',
  },
  CRITICAL: {
    label: 'Critical risk',
    short: 'CRITICAL',
    note: 'Produce will spoil before it can be sold at full price.',
  },
};

/** Whole days once a full day remains, otherwise one decimal place, so 17.7 h reads as 0.7 days. */
export const daysLabel = (hours: number) => {
  const d = hours / 24;
  if (d >= 1) return `${Math.floor(d)} ${Math.floor(d) === 1 ? 'day' : 'days'}`;
  return `${d.toFixed(1)} days`;
};
export const hours = (value: number) => value.toFixed(1);
export const multiplier = (value: number) => `×${value.toFixed(2)}`;
export const rupees = (value: number) => `₹${value.toFixed(2).replace(/\.00$/, '')}`;
export const signedHours = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)} h`;

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}
