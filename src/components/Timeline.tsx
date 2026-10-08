import type { ShipmentDetail } from '../../server/pipeline';
import { clock, hours } from '../format';
import { useElementWidth } from '../hooks';
import { InfoTip } from '../ui/InfoTip';
import { markdownThreshold, projectShelfLife } from '../visual/projection';
import { RiskBadge } from './RiskBadge';

const H = 340;
const TEMP_H = 74;
const clampRange = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Shelf life across the journey.
 *  - Solid line and dots: OBSERVED, from the stored model runs.
 *  - Dashed line and hollow end: PROJECTED, from the same model formula, holding
 *    the latest reading until arrival.
 *  - Dashed horizontal line: where the markdown policy starts.
 * Drawn at its real pixel width, so labels stay readable on a phone.
 */
export function Timeline({ state }: { state: ShipmentDetail }) {
  const [wrap, width] = useElementWidth<HTMLDivElement>(760);
  const { snapshots, model, shipment, current } = state;
  const W = Math.max(300, width);
  const narrow = W < 520;
  const PAD = { left: narrow ? 40 : 52, right: narrow ? 58 : 84, top: 18, mid: 40, bottom: 26 };

  const bands = model.riskBands;
  const transitTotal = shipment.transitTotalHours;
  const maxHours = Math.max(bands.normalAboveHours + 48, shipment.baselineShelfLifeHours);
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
  const tempPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.tY.toFixed(1)}`).join(' ');
  const arrivalX = x(transitTotal);
  const latest = points[points.length - 1];

  const projection = projectShelfLife({
    baselineShelfLifeHours: shipment.baselineShelfLifeHours,
    transitTotalHours: transitTotal,
    transitRemainingHours: current.transitRemainingHours,
    cumulativeEquivalentAge: current.cumulativeEquivalentAge,
    temperatureC: current.temperature,
    humidityPct: current.humidity,
    params: model,
  });
  const projectedPath = projection.points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.elapsed).toFixed(1)},${yShelf(p.remaining).toFixed(1)}`)
    .join(' ');
  const projectedEnd = projection.points[projection.points.length - 1];
  const showProjection = current.transitRemainingHours > 0 && projection.points.length > 1;

  const threshold = markdownThreshold(model);

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
        <span className="panel-meta">{snapshots.length} model runs</span>
      </header>

      <ul className="chart-legend" aria-label="Chart key">
        <li>
          <span className="lg lg-observed" aria-hidden="true" />
          Observed
          <InfoTip about="observed data" text="Shelf life after each stored model run, read from the database." />
        </li>
        {showProjection && (
          <li>
            <span className="lg lg-projected" aria-hidden="true" />
            Projected
            <InfoTip
              about="the projection"
              text={`The same model formula, holding the latest reading (${current.temperature.toFixed(1)} °C, ${current.humidity.toFixed(0)}% RH) until arrival.`}
            />
          </li>
        )}
        {threshold && (
          <li>
            <span className="lg lg-markdown" aria-hidden="true" />
            Markdown starts below {threshold.hours} h
            <InfoTip
              about="the markdown threshold"
              text={`Below ${threshold.hours} h of shelf life the liquidation policy recommends a markdown, and it deepens as risk rises.`}
            />
          </li>
        )}
      </ul>

      <div ref={wrap} className="timeline-wrap">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          className="timeline-svg"
          role="img"
          aria-labelledby="timeline-svg-title timeline-svg-desc"
        >
          <title id="timeline-svg-title">Remaining shelf life and temperature across transit</title>
          <desc id="timeline-svg-desc">
            {`Observed shelf life is ${hours(current.remainingHours)} hours after ${hours(transitTotal - current.transitRemainingHours)} hours of transit. Risk is ${current.riskLevel}. ` +
              (showProjection ? `If conditions hold, it projects to ${hours(projection.atArrival)} hours at arrival.` : '')}
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
              <text x={W - PAD.right + 8} y={yShelf((b.from + b.to) / 2) + 4} className="band-label">
                {b.label}
              </text>
            </g>
          ))}

          {[0, bands.criticalBelowHours, bands.watchAboveHours, bands.normalAboveHours].map((h) => (
            <g key={`tick-${h}`}>
              <line x1={PAD.left - 4} x2={PAD.left} y1={yShelf(h)} y2={yShelf(h)} className="axis" />
              <text x={PAD.left - 8} y={yShelf(h) + 4} className="axis-label" textAnchor="end">
                {h} h
              </text>
            </g>
          ))}

          {threshold && (
            <g>
              <line x1={PAD.left} x2={W - PAD.right} y1={yShelf(threshold.hours)} y2={yShelf(threshold.hours)} className="markdown-line">
                <title>{`Markdown starts below ${threshold.hours} h of shelf life`}</title>
              </line>
              <text x={W - PAD.right - 8} y={yShelf(threshold.hours) - 6} className="markdown-label-svg" textAnchor="end">
                markdown starts ↓
              </text>
            </g>
          )}

          <line x1={arrivalX} x2={arrivalX} y1={shelfTop} y2={shelfTop + shelfH} className="arrival" />
          <text x={arrivalX - 6} y={shelfTop + 12} className="arrival-label" textAnchor="end">
            arrival · {transitTotal} h
          </text>

          {showProjection && <path d={projectedPath} className="projected-line" />}
          {showProjection && projectedEnd && (
            <circle cx={x(projectedEnd.elapsed)} cy={yShelf(projectedEnd.remaining)} r={5} className="projected-end">
              <title>{`Projected at arrival: ${hours(projection.atArrival)} h`}</title>
            </circle>
          )}

          {points.length > 1 && <path d={path} className="shelf-line" />}
          {points.map((p, i) => (
            <circle
              key={`${p.createdAt}-${i}`}
              cx={p.x}
              cy={p.y}
              r={i === points.length - 1 ? 5.5 : 3.5}
              className={`node node-${p.riskLevel.toLowerCase()}`}
            >
              <title>{`${hours(p.remainingHours)} h remaining · ${p.riskLevel} · ${p.temperatureC.toFixed(1)} °C`}</title>
            </circle>
          ))}

          {latest && (
            <text x={Math.min(latest.x + 10, W - PAD.right - 40)} y={latest.y - 10} className="latest-label">
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
          <text x={PAD.left - 8} y={tempTop + 4} className="axis-label" textAnchor="end">
            30°
          </text>
          <text x={PAD.left - 8} y={tempTop + TEMP_H} className="axis-label" textAnchor="end">
            0°
          </text>
          <text x={PAD.left} y={H - 6} className="axis-label">
            0 h transit
          </text>
          <text x={arrivalX} y={H - 6} className="axis-label" textAnchor="end">
            {transitTotal} h
          </text>
        </svg>
      </div>

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
                <td>
                  <RiskBadge level={s.riskLevel} />
                </td>
              </tr>
            ))}
            {showProjection && (
              <tr className="is-projected">
                <td>At arrival</td>
                <td>{current.temperature.toFixed(1)} °C</td>
                <td>{current.humidity.toFixed(0)}%</td>
                <td>{hours(projection.atArrival)} h</td>
                <td>projected</td>
              </tr>
            )}
          </tbody>
        </table>
      </details>
    </section>
  );
}
