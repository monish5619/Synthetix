/**
 * Geometry for the route drawing: a gently curving road from origin to
 * destination, with positions measured by distance travelled (not by curve
 * parameter), so "40% of the transit" is 40% of the road's length.
 * No map service: this is a diagram, drawn from the shipment's own hours.
 */

export const ROUTE_VIEW = { w: 1000, h: 150 } as const;

type Pt = readonly [number, number];
/** Two cubic Bézier segments with a smooth join: [start, control1, control2, end]. */
const SEGMENTS: ReadonlyArray<readonly [Pt, Pt, Pt, Pt]> = [
  [[56, 112], [250, 112], [320, 44], [510, 62]],
  [[510, 62], [700, 80], [780, 110], [944, 46]],
];

export const routeStart = { x: SEGMENTS[0]![0][0], y: SEGMENTS[0]![0][1] };
export const routeEnd = { x: SEGMENTS[1]![3][0], y: SEGMENTS[1]![3][1] };

/** SVG path data for the road. */
export const ROUTE_D = `M ${SEGMENTS[0]![0].join(' ')} C ${SEGMENTS[0]![1].join(' ')} ${SEGMENTS[0]![2].join(' ')} ${SEGMENTS[0]![3].join(' ')} C ${SEGMENTS[1]![1].join(' ')} ${SEGMENTS[1]![2].join(' ')} ${SEGMENTS[1]![3].join(' ')}`;

const cubic = (p: readonly [Pt, Pt, Pt, Pt], t: number): [number, number] => {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0], a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1]];
};

const PER_SEGMENT = 120;
/** Sampled points along the road with cumulative length, built once. */
const TABLE = (() => {
  const pts: Array<{ x: number; y: number; len: number }> = [];
  let len = 0;
  SEGMENTS.forEach((seg, s) => {
    for (let i = s === 0 ? 0 : 1; i <= PER_SEGMENT; i++) {
      const [x, y] = cubic(seg, i / PER_SEGMENT);
      const prev = pts.at(-1);
      if (prev) len += Math.hypot(x - prev.x, y - prev.y);
      pts.push({ x, y, len });
    }
  });
  return { pts, total: len };
})();

export interface RoutePoint {
  x: number;
  y: number;
  /** Heading in degrees, limited so a vehicle stays upright. */
  angle: number;
}

/** The point `fraction` (0…1) of the way along the road by distance. */
export function routePoint(fraction: number): RoutePoint {
  const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  const target = f * TABLE.total;
  const { pts } = TABLE;
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid]!.len <= target) lo = mid;
    else hi = mid;
  }
  const a = pts[lo]!;
  const b = pts[hi]!;
  const span = b.len - a.len || 1;
  const k = (target - a.len) / span;
  const x = a.x + (b.x - a.x) * k;
  const y = a.y + (b.y - a.y) * k;
  const raw = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, angle: Math.max(-30, Math.min(30, Math.round(raw * 10) / 10)) };
}

export interface Stretch {
  /** Fractions of the route, 0…1. */
  from: number;
  to: number;
  temperatureC: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * The stretches already travelled, each carrying the temperature recorded across it,
 * from the stored model runs. Nothing beyond the latest run is invented.
 */
export function stretchesOf(
  snapshots: ReadonlyArray<{ transitRemainingHours: number; temperatureC: number }>,
  transitTotalHours: number,
): Stretch[] {
  if (!(transitTotalHours > 0)) return [];
  const frac = (remaining: number) => clamp01((transitTotalHours - remaining) / transitTotalHours);
  const out: Stretch[] = [];
  for (let i = 1; i < snapshots.length; i++) {
    const from = frac(snapshots[i - 1]!.transitRemainingHours);
    const to = frac(snapshots[i]!.transitRemainingHours);
    if (to > from) out.push({ from, to, temperatureC: snapshots[i]!.temperatureC });
  }
  return out;
}

/**
 * How hot a temperature is on the scale from the ideal (0) to the hottest recorded (100),
 * for colouring the road. The scale ends are data, so the legend can print them.
 */
export function heatPct(temperatureC: number, idealC: number, hottestC: number): number {
  const span = hottestC - idealC;
  if (!(span > 0)) return 0;
  return Math.round(clamp01((temperatureC - idealC) / span) * 100);
}
