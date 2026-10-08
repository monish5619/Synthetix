import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RiskBadge } from '../src/components/RiskBadge';
import { RISK_LEVELS, RISK_VISUAL } from '../src/risk';
import { RISK_ORDER, type RiskLevel } from '../server/config';

const html = (level: RiskLevel) => renderToStaticMarkup(<RiskBadge level={level} />);

describe('risk is never colour alone', () => {
  it('covers exactly the engine risk levels', () => {
    expect([...RISK_LEVELS].sort()).toEqual(Object.keys(RISK_ORDER).sort());
    expect(Object.keys(RISK_VISUAL).sort()).toEqual(Object.keys(RISK_ORDER).sort());
  });

  it.each(RISK_LEVELS)('%s renders an icon AND its written label', (level) => {
    const markup = html(level);
    expect(markup).toContain('<svg');
    expect(markup).toContain(`>${level}</span>`);
    expect(markup).toContain(`risk-${level}`);
  });

  it('every level has a different icon shape, so greyscale still tells them apart', () => {
    const icons = RISK_LEVELS.map((l) => RISK_VISUAL[l].icon);
    expect(new Set(icons).size).toBe(RISK_LEVELS.length);
    const shapes = RISK_LEVELS.map((l) => /<svg.*<\/svg>/.exec(html(l))?.[0]);
    expect(new Set(shapes).size).toBe(RISK_LEVELS.length);
  });

  it('every level has its own colour token', () => {
    const tones = RISK_LEVELS.map((l) => RISK_VISUAL[l].tone);
    expect(new Set(tones).size).toBe(RISK_LEVELS.length);
  });

  it('hides the decorative icon from screen readers, leaving the label to be read', () => {
    const markup = html('CRITICAL');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('CRITICAL');
  });

  it('uses the engine wording: NORMAL, WATCH, HIGH, CRITICAL', () => {
    expect(RISK_LEVELS.map((l) => RISK_VISUAL[l].label)).toEqual(['NORMAL', 'WATCH', 'HIGH', 'CRITICAL']);
  });
});
