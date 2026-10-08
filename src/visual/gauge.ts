/**
 * Geometry for the radial shelf-life gauge. Pure maths, no DOM, so it can be tested.
 *
 * A 270° arc, open at the bottom. The filled part is the share of the reference
 * shelf life that is left; ticks mark the risk-band edges on the same scale.
 * Every input comes from the API; nothing here knows any particular value.
 */

export const GAUGE = { size: 260, cx: 130, cy: 130, r: 108, startDeg: 135, sweepDeg: 270 } as const;

const round = (n: number) => Math.round(n * 100) / 100;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** SVG angles: 0° points right and angles grow clockwise. */
export function polar(radius: number, deg: number) {
  return { x: round(GAUGE.cx + radius * Math.cos(rad(deg))), y: round(GAUGE.cy + radius * Math.sin(rad(deg))) };
}

/** The full 270° track as an SVG path. Its `pathLength` is set to 100 where it is drawn. */
export function arcPath(radius: number = GAUGE.r): string {
  const s = polar(radius, GAUGE.startDeg);
  const e = polar(radius, GAUGE.startDeg + GAUGE.sweepDeg);
  return `M ${s.x} ${s.y} A ${radius} ${radius} 0 1 1 ${e.x} ${e.y}`;
}

/** Share of the reference life that remains, clamped to 0…1. */
export function fractionOf(remaining: number, baseline: number): number {
  if (!(baseline > 0) || !Number.isFinite(remaining)) return 0;
  return Math.min(1, Math.max(0, remaining / baseline));
}

export interface GaugeTick {
  hours: number;
  angle: number;
  inner: { x: number; y: number };
  outer: { x: number; y: number };
  label: { x: number; y: number };
}

export interface GaugeGeometry {
  fraction: number;
  /** For a path with pathLength=100: stroke-dasharray is "100 100", this is the dashoffset. */
  dashOffset: number;
  ticks: GaugeTick[];
}

export function gaugeGeometry(input: { remaining: number; baseline: number; edges: readonly number[] }): GaugeGeometry {
  const fraction = fractionOf(input.remaining, input.baseline);
  const ticks = [...input.edges]
    .filter((h) => h > 0 && h < input.baseline)
    .sort((a, b) => a - b)
    .map((hours) => {
      const angle = GAUGE.startDeg + (hours / input.baseline) * GAUGE.sweepDeg;
      return {
        hours,
        angle: round(angle),
        inner: polar(GAUGE.r - 14, angle),
        outer: polar(GAUGE.r + 14, angle),
        label: polar(GAUGE.r + 28, angle),
      };
    });
  return { fraction, dashOffset: round(100 - fraction * 100), ticks };
}
