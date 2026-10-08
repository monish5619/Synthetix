import type { CSSProperties } from 'react';
import type { ShipmentDetail } from '../../server/pipeline';
import { hours } from '../format';
import { InfoTip } from '../ui/InfoTip';
import { ROUTE_D, ROUTE_VIEW, heatPct, routeEnd, routePoint, routeStart, stretchesOf } from '../visual/routePath';

const heatColour = (pct: number) => `color-mix(in srgb, var(--color-critical) ${pct}%, var(--color-accent))`;

/**
 * The physical journey, drawn from the shipment's own transit hours. A thick road
 * is coloured, stretch by stretch, by the temperature the stored readings recorded
 * there (cool teal to hot red); the road not yet driven stays plain. The truck sits
 * at the point reached and moves when the stored state moves.
 * It is a diagram: no map service, no external requests.
 */
export function RouteMap({ state }: { state: ShipmentDetail }) {
  const { shipment, current, snapshots, model } = state;
  const total = shipment.transitTotalHours;
  const elapsed = Math.max(0, total - current.transitRemainingHours);
  const frac = total > 0 ? Math.min(1, elapsed / total) : 0;
  const truck = routePoint(frac);
  const stretches = stretchesOf(snapshots, total);

  const ideal = model.idealTemperatureC;
  const hottest = Math.max(ideal + model.excursionAboveIdealC, ...snapshots.map((s) => s.temperatureC));

  const endsAt = elapsed + current.remainingHours;
  const endsInTransit = total > 0 && endsAt < total;
  const endPoint = routePoint(total > 0 ? endsAt / total : 0);

  const truckStyle = { transform: `translate(${truck.x}px, ${truck.y}px) rotate(${truck.angle}deg)` } as CSSProperties;

  return (
    <div className="route">
      <svg
        className="route-svg"
        viewBox={`0 0 ${ROUTE_VIEW.w} ${ROUTE_VIEW.h}`}
        role="img"
        aria-labelledby="route-title route-desc"
      >
        <title id="route-title">Transit route</title>
        <desc id="route-desc">
          {`${hours(elapsed)} of ${total} transit hours have passed on the way from ${shipment.origin} to ${shipment.destination}. ` +
            (endsInTransit ? 'Shelf life runs out before arrival.' : 'Shelf life lasts past arrival.')}
        </desc>

        <path d={ROUTE_D} pathLength={100} className="route-bed" />
        {stretches.map((s, i) => {
          const length = (s.to - s.from) * 100;
          return (
            <path
              key={i}
              d={ROUTE_D}
              pathLength={100}
              className="route-heat"
              strokeDasharray={`${length} 200`}
              strokeDashoffset={-s.from * 100}
              style={{ stroke: heatColour(heatPct(s.temperatureC, ideal, hottest)) }}
            >
              <title>{`${s.temperatureC.toFixed(1)} °C over ${hours((s.to - s.from) * total)} h`}</title>
            </path>
          );
        })}
        <path d={ROUTE_D} pathLength={100} className="route-lane" />

        <circle cx={routeStart.x} cy={routeStart.y} r={9} className="route-pin" />
        <circle cx={routeEnd.x} cy={routeEnd.y} r={11} className="route-pin route-pin-end" />
        <circle cx={routeEnd.x} cy={routeEnd.y} r={4} className="route-pin-core" />

        {endsInTransit && (
          <g transform={`translate(${endPoint.x} ${endPoint.y})`}>
            <path d="M0 -13 L11 0 L0 13 L-11 0 Z" className="route-ends" />
            <title>{`Shelf life runs out at ${hours(endsAt)} h`}</title>
          </g>
        )}

        <g className="truck" style={truckStyle}>
          <g className="truck-bob">
            <rect x={-20} y={-22} width={24} height={16} rx={2.5} className="truck-box" />
            <path d="M6 -19 H14 L21 -11 V-6 H6 Z" className="truck-cab" />
            <circle cx={-11} cy={-4} r={3.8} className="truck-wheel" />
            <circle cx={13} cy={-4} r={3.8} className="truck-wheel" />
          </g>
        </g>
      </svg>

      <div className="route-meta">
        <span className="route-end-name">{shipment.origin}</span>
        <span className="route-now">
          <strong>{hours(elapsed)}</strong> of {total} h
        </span>
        <span className="route-end-name is-dest">{shipment.destination}</span>
      </div>

      <div className="route-legend">
        <span className="heat-key">
          <span className="heat-label">{ideal.toFixed(0)} °C</span>
          <span className="heat-bar" aria-hidden="true" />
          <span className="heat-label">{hottest.toFixed(0)} °C</span>
        </span>
        {endsInTransit && (
          <span className="route-ends-chip">
            <span className="route-ends-key" aria-hidden="true" />
            Shelf life ends at {hours(endsAt)} h
            <InfoTip
              about="where shelf life ends"
              text="Remaining shelf life counted hour for hour against transit time, the same basis as the arrival margin. The chart below projects what happens if today's conditions continue."
            />
          </span>
        )}
      </div>
    </div>
  );
}
