import type { ShipmentDetail } from '../../server/pipeline';
import { clock, hours } from '../format';

const W = 800;
const H = 330;
const PAD = { left: 52, right: 84, top: 18, mid: 40, bottom: 26 };
const TEMP_H = 74;

/**
 * Exposure timeline: remaining shelf life against transit elapsed, from the stored
 * snapshots. Background bands are the engine's configured risk thresholds. The lower
 * strip plots the temperature of each recorded interval against the ideal.
 */
export function Timeline({ state }: { state: ShipmentDetail }) {
  const { snapshots, model, shipment, current } = state;
  const bands = model.riskBands;
  const transitTotal = shipment.transitTotalHours;
  const maxHours = Math.max(model.riskBands.normalAboveHours + 48, shipment.baselineShelfLifeHours);
  const plotW = W - PAD.left - PAD.right;
  const shelfTop = PAD.top;
  const shelfH = H - PAD.top - PAD.bottom - TEMP_H - PAD.mid;
  const tempTop = shelfTop + shelfH + PAD.mid;

  const x = (elapsed: number) => PAD.left + (clampRange(elapsed, 0, transitTotal) / transitTotal) * plotW;
  const yShelf = (h: number) => shelfTop + shelfH - (clampRange(h, 0, maxHours) / maxHours) * shelfH;
  const tempMax = 30;
  const yTemp = (t: number) => tempTop + TEMP_H - (clampRange(t, 0, tempMax) / tempMax) * TEMP_H;

  const points = snapshots.map((s) => ({
    x: x(transitTotal - s.transitRemainingHours),
    y: yShelf(s.remainingHours),
    tY: yTemp(s.temperatureC),
    ...s,
  }));
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const tempPath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.tY.toFixed(1)}`)
    .join(' ');
  const arrivalX = x(transitTotal);
  const latest = points[points.length - 1];

  const bandRects = [
    { from: 0, to: bands.criticalBelowHours, cls: 'band-critical', label: 'Critical' },
    { from: bands.criticalBelowHours, to: bands.watchAboveHours, cls: 'band-high', label: 'High' },
    { from: bands.watchAboveHours, to: bands.normalAboveHours, cls: 'band-watch', label: 'Watch' },
    { from: bands.normalAboveHours, to: maxHours, cls: 'band-normal', label: 'Normal' },
  ];

  return (
    <section className="panel timeline" aria-labelledby="timeline-title">
      <header className="panel-head">
        <div>
          <p className="eyebrow">Thermal exposure</p>
          <h2 id="timeline-title">Shelf life across the journey</h2>
        </div>
        <span className="panel-meta">{snapshots.length} model runs · from the database</span>
      </header>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="timeline-svg"
        role="img"
        aria-labelledby="timeline-svg-title timeline-svg-desc"
      >
        <title id="timeline-svg-title">Remaining shelf life and temperature across transit</title>
        <desc id="timeline-svg-desc">
          {`Shelf life is ${hours(current.remainingHours)} hours after ${hours(transitTotal - current.transitRemainingHours)} hours of transit. Risk is ${current.riskLevel}.`}
        </desc>

        {bandRects.map((b) => (
          <g key={b.label}>
            <rect
              x={PAD.left}
              y={yShelf(b.to)}
              width={plotW}
              height={Math.max(0, yShelf(b.from) - yShelf(b.to))}
              className={b.cls}
            />
            <text x={W - PAD.right + 10} y={yShelf((b.from + b.to) / 2) + 4} className="band-label">
              {b.label}
            </text>
          </g>
        ))}

        {[0, bands.criticalBelowHours, bands.watchAboveHours, bands.normalAboveHours].map((h) => (
          <g key={`tick-${h}`}>
            <line x1={PAD.left - 4} x2={PAD.left} y1={yShelf(h)} y2={yShelf(h)} className="axis" />
            <text x={PAD.left - 10} y={yShelf(h) + 4} className="axis-label" textAnchor="end">
              {h} h
            </text>
          </g>
        ))}

        <line x1={arrivalX} x2={arrivalX} y1={shelfTop} y2={shelfTop + shelfH} className="arrival" />
        <text x={arrivalX - 6} y={shelfTop + 12} className="arrival-label" textAnchor="end">
          arrival · {transitTotal} h
        </text>

        {points.length > 1 && <path d={path} className="shelf-line" />}
        {points.map((p, i) => (
          <circle
            key={`${p.createdAt}-${i}`}
            cx={p.x}
            cy={p.y}
            r={i === points.length - 1 ? 5.5 : 3.5}
            className={`node node-${p.riskLevel.toLowerCase()}`}
          >
            <title>
              {`${hours(p.remainingHours)} h remaining · ${p.riskLevel} · ${p.temperatureC.toFixed(1)} °C`}
            </title>
          </circle>
        ))}

        {latest && (
          <text x={latest.x + 10} y={latest.y - 10} className="latest-label">
            {hours(latest.remainingHours)} h
          </text>
        )}

        <text x={PAD.left} y={tempTop - 6} className="axis-label">
          temperature · ideal {model.idealTemperatureC} °C
        </text>
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={yTemp(model.idealTemperatureC)}
          y2={yTemp(model.idealTemperatureC)}
          className="ideal-line"
        />
        <rect x={PAD.left} y={tempTop} width={plotW} height={TEMP_H} className="temp-well" />
        {points.length > 1 && <path d={tempPath} className="temp-line" />}
        {points.map((p, i) => (
          <circle key={`t-${i}`} cx={p.x} cy={p.tY} r={2.8} className={p.temperatureC > model.idealTemperatureC + 4 ? 'temp-dot hot' : 'temp-dot'} />
        ))}
        <text x={PAD.left - 10} y={tempTop + 4} className="axis-label" textAnchor="end">
          30°
        </text>
        <text x={PAD.left - 10} y={tempTop + TEMP_H} className="axis-label" textAnchor="end">
          0°
        </text>
        <text x={PAD.left} y={H - 6} className="axis-label">
          0 h transit
        </text>
        <text x={arrivalX} y={H - 6} className="axis-label" textAnchor="end">
          {transitTotal} h
        </text>
      </svg>

      <details className="table-fallback">
        <summary>Readings as a table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Temperature</th>
              <th scope="col">Humidity</th>
              <th scope="col">Remaining shelf life</th>
              <th scope="col">Risk</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.map((s, i) => (
              <tr key={`${s.createdAt}-${i}`}>
                <td>{clock(s.createdAt)}</td>
                <td>{s.temperatureC.toFixed(1)} °C</td>
                <td>{s.humidityPct.toFixed(0)}%</td>
                <td>{hours(s.remainingHours)} h</td>
                <td>{s.riskLevel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

function clampRange(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
