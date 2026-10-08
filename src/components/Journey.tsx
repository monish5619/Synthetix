import type { ShipmentDetail } from '../../server/pipeline';
import { hours } from '../format';

const W = 1000;
const H = 118;
const X0 = 46;
const X1 = W - 46;
const TRACK_Y = 56;

/**
 * The physical journey: origin to destination, to scale in transit hours. Each stretch is
 * coloured by the temperature recorded across it. The marker shows where the shelf life
 * would run out if the produce were held at ideal temperature from here.
 */
export function Journey({ state }: { state: ShipmentDetail }) {
  const { shipment, current, snapshots, model } = state;
  const total = shipment.transitTotalHours;
  const elapsedNow = total - current.transitRemainingHours;
  const x = (h: number) => X0 + (Math.min(Math.max(h, 0), total) / total) * (X1 - X0);
  const threshold = model.idealTemperatureC + model.excursionAboveIdealC;

  // Stretches between consecutive model runs, each carrying the temperature measured over it.
  const stretches = snapshots.slice(1).map((s, i) => {
    const from = total - snapshots[i].transitRemainingHours;
    const to = total - s.transitRemainingHours;
    return { from, to, hot: s.temperatureC > threshold, temperature: s.temperatureC };
  });

  const runsOutAt = elapsedNow + current.remainingHours;
  const runsOutInTransit = runsOutAt < total;
  const arrivalX = x(total);
  const nowX = x(elapsedNow);
  const endX = x(runsOutAt);

  return (
    <div className="journey" aria-label="Journey from origin to destination">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="journey-title journey-desc">
        <title id="journey-title">Transit route</title>
        <desc id="journey-desc">
          {`${hours(elapsedNow)} of ${total} transit hours have passed. Shelf life ${runsOutInTransit ? 'runs out before arrival' : 'lasts past arrival'}.`}
        </desc>

        <text x={X0} y={18} className="journey-label">
          {shipment.origin}
        </text>
        <text x={X1} y={18} className="journey-label" textAnchor="end">
          {shipment.destination}
        </text>

        <line x1={X0} x2={X1} y1={TRACK_Y} y2={TRACK_Y} className="journey-base" />

        {stretches.map((s, i) => (
          <line
            key={i}
            x1={x(s.from)}
            x2={x(s.to)}
            y1={TRACK_Y}
            y2={TRACK_Y}
            className={s.hot ? 'stretch stretch-hot' : 'stretch stretch-cold'}
          >
            <title>{`${s.temperature.toFixed(1)} °C over ${hours(s.to - s.from)} h`}</title>
          </line>
        ))}

        {/* Where the produce is now */}
        <circle cx={nowX} cy={TRACK_Y} r={7} className="journey-now" />
        <text x={nowX} y={TRACK_Y + 26} className="journey-tag" textAnchor="middle">
          now · {hours(elapsedNow)} h
        </text>

        {/* Where shelf life runs out, if held at ideal temperature from here */}
        {runsOutInTransit ? (
          <g>
            <line x1={endX} x2={endX} y1={TRACK_Y - 16} y2={TRACK_Y + 16} className="journey-end" />
            <text x={endX} y={TRACK_Y - 24} className="journey-tag is-end" textAnchor="middle">
              shelf life ends · {hours(runsOutAt)} h
            </text>
          </g>
        ) : null}

        <line x1={arrivalX} x2={arrivalX} y1={TRACK_Y - 14} y2={TRACK_Y + 14} className="journey-arrival" />
        <text x={arrivalX} y={TRACK_Y + 26} className="journey-tag" textAnchor="end">
          arrival · {total} h
        </text>

        <text x={X0} y={H - 6} className="journey-foot">
          Colour shows the temperature over each stretch: teal is within range, ember is a thermal excursion.
        </text>
      </svg>
    </div>
  );
}
