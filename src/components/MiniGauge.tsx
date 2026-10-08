import type { CSSProperties } from 'react';
import type { RiskLevel } from '../../server/config';
import { hours } from '../format';
import { RISK_VISUAL } from '../risk';
import { GAUGE, arcPath, fractionOf } from '../visual/gauge';

/** A small version of the shelf-life gauge: the arc is the share of reference life left. */
export function MiniGauge({ remaining, baseline, level }: { remaining: number; baseline: number; level: RiskLevel }) {
  const offset = Math.round((100 - fractionOf(remaining, baseline) * 100) * 100) / 100;
  const style = { '--gauge': `var(${RISK_VISUAL[level].tone})` } as CSSProperties;
  return (
    <div className="mini-gauge" style={style} role="img" aria-label={`${hours(remaining)} hours of ${baseline} left`}>
      <svg viewBox={`0 0 ${GAUGE.size} ${GAUGE.size}`} aria-hidden="true" focusable="false">
        <path d={arcPath()} pathLength={100} className="mini-track" />
        <path d={arcPath()} pathLength={100} className="mini-fill" strokeDasharray="100 100" style={{ strokeDashoffset: offset }} />
      </svg>
      <span className="mini-value" aria-hidden="true">
        {hours(remaining)}
        <small>h</small>
      </span>
    </div>
  );
}
