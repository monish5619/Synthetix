import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ShipmentDetail } from '../server/pipeline';
import { ActionBar } from '../src/components/ActionBar';
import { Explain } from '../src/components/Explain';
import { Hero } from '../src/components/Hero';
import { Liquidation } from '../src/components/Liquidation';
import { RouteMap } from '../src/components/RouteMap';
import { ShelfGauge } from '../src/components/ShelfGauge';
import { StoryRail, lastLit, storyStages } from '../src/components/StoryRail';
import { Timeline } from '../src/components/Timeline';
import { hours } from '../src/format';
import { routePoint, stretchesOf } from '../src/visual/routePath';
import { ToastRegion } from '../src/ui/Toast';
import { demoStates } from './helpers/states';

let baseline: ShipmentDetail;
let spiked: ShipmentDetail;
let reset: ShipmentDetail;

beforeAll(() => {
  ({ baseline, spiked, reset } = demoStates());
});

const html = renderToStaticMarkup;
const count = (text: string, needle: string) => text.split(needle).length - 1;
/** What a person can read: tags stripped, and tooltip bubbles (hover-only help) removed. */
const visibleText = (markup: string) =>
  markup
    .replace(/<span id="[^"]*" role="tooltip"[^>]*>[\s\S]*?<\/span>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');

describe('real states behind these tests', () => {
  it('baseline is the reference life at normal risk; the spike collapses it to critical', () => {
    expect(baseline.current.remainingHours).toBeCloseTo(120, 5);
    expect(baseline.current.riskLevel).toBe('NORMAL');
    expect(spiked.current.riskLevel).toBe('CRITICAL');
    expect(spiked.current.remainingHours).toBeCloseTo(17.65, 1);
    expect(reset.current.remainingHours).toBeCloseTo(120, 5);
  });
});

describe('radial gauge', () => {
  it('shows the API value and the risk word with its icon — spiked', () => {
    const markup = html(<ShelfGauge state={spiked} holdMs={0} />);
    expect(markup).toContain(`>${spiked.current.remainingHours.toFixed(1)}<`);
    expect(visibleText(markup)).toContain('CRITICAL');
    expect(markup).toContain('risk-badge risk-CRITICAL');
    expect(markup).toContain('<svg'); // the badge's icon, so risk is never colour alone
    expect(markup).toContain('--gauge:var(--color-critical)');
  });

  it('shows the baseline value, risk and colour — baseline', () => {
    const markup = html(<ShelfGauge state={baseline} holdMs={0} />);
    expect(markup).toContain('>120.0<');
    expect(visibleText(markup)).toContain('NORMAL');
    expect(markup).toContain('--gauge:var(--color-safe)');
  });

  it('fills the arc in proportion: full at baseline, mostly empty when spiked', () => {
    const offset = (m: string) => Number(/stroke-dashoffset:([\d.]+)/.exec(m)?.[1]);
    expect(offset(html(<ShelfGauge state={baseline} holdMs={0} />))).toBe(0);
    const spikedOffset = offset(html(<ShelfGauge state={spiked} holdMs={0} />));
    expect(spikedOffset).toBeCloseTo(100 - (spiked.current.remainingHours / spiked.shipment.baselineShelfLifeHours) * 100, 1);
    expect(spikedOffset).toBeGreaterThan(80);
  });

  it('gives screen readers one clear summary, not a number that changes every frame', () => {
    const markup = html(<ShelfGauge state={spiked} holdMs={0} />);
    expect(markup).toContain(`Remaining shelf life ${hours(spiked.current.remainingHours)} hours of ${spiked.shipment.baselineShelfLifeHours}. Risk CRITICAL.`);
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toMatch(/class="gauge-value" aria-hidden="true"/);
  });

  it('marks the risk-band edges taken from the API', () => {
    const markup = html(<ShelfGauge state={spiked} holdMs={0} />);
    for (const edge of [spiked.model.riskBands.criticalBelowHours, spiked.model.riskBands.watchAboveHours, spiked.model.riskBands.normalAboveHours]) {
      expect(markup).toContain(`>${edge}</text>`);
    }
  });
});

describe('the seven-step chain', () => {
  it('names the seven steps in order', () => {
    expect(storyStages(spiked).map((s) => s.step)).toEqual(['Telemetry', 'Model', 'Ageing', 'Risk', 'Price', 'Alert', 'Rescue']);
  });

  it('keeps labels to two words and has no sentences', () => {
    for (const s of storyStages(spiked)) {
      expect(s.label.split(' ').length).toBeLessThanOrEqual(2);
      expect(`${s.value} ${s.label}`).not.toMatch(/[!?]|\.\s|\.$/); // decimals are fine; sentences are not
    }
  });

  it('lights nothing it cannot prove: baseline has no readings, risk or alerts', () => {
    const lit = (st: ShipmentDetail) => storyStages(st).filter((s) => s.lit).map((s) => s.key);
    expect(lit(baseline)).toEqual([]);
    expect(lit(reset)).toEqual([]); // and resetting really clears the stored events
  });

  it('lights every step after the spike, from stored records', () => {
    const stages = storyStages(spiked);
    expect(stages.every((s) => s.lit)).toBe(true);
    const by = Object.fromEntries(stages.map((s) => [s.key, s.value]));
    expect(by.telemetry).toBe(`${spiked.telemetry.at(-1)!.temperature.toFixed(1)} °C`);
    expect(by.model).toBe(`×${spiked.latestModelRun!.temperatureStress.toFixed(2)}`);
    expect(by.ageing).toBe(`${hours(spiked.current.cumulativeEquivalentAge)} h`);
    expect(by.risk).toBe('CRITICAL');
    expect(by.price).toBe('Repriced');
    expect(by.alert).toBe(`${spiked.alerts.length} sent`);
    expect(by.rescue).toBe(`${spiked.recommendations[0]!.sellByHours} h`);
  });

  it('does not repeat what the liquidation card owns: markdown, price, reason', () => {
    const text = storyStages(spiked).map((s) => `${s.value} ${s.label}`).join(' ');
    expect(text).not.toMatch(/%|₹/);
    expect(text).not.toContain(String(spiked.recommendations[0]!.markdownPct));
    expect(text).not.toContain(spiked.recommendations[0]!.reason);
  });

  it('links to where the detail lives instead of repeating it', () => {
    const markup = html(<StoryRail state={spiked} revealed={Infinity} />);
    expect(markup).toContain('href="#/telemetry"');
    expect(markup).toContain('href="#/marketplace"');
    expect(markup).toContain('href="#/alerts"');
  });

  it('plays in order: a step shows only once the reveal reaches it', () => {
    const markup = html(<StoryRail state={spiked} revealed={2} />);
    expect(count(markup, 'is-lit')).toBe(2);
    expect(count(markup, 'is-dark')).toBe(5);
    expect(lastLit(storyStages(spiked), 2)).toBe(1);
    expect(markup).toContain('aria-current="step"');
  });
});

describe('route map', () => {
  it('puts the truck where the stored transit hours say it is', () => {
    const markup = html(<RouteMap state={spiked} />);
    const elapsed = spiked.shipment.transitTotalHours - spiked.current.transitRemainingHours;
    const p = routePoint(elapsed / spiked.shipment.transitTotalHours);
    expect(markup).toContain(`translate(${p.x}px, ${p.y}px) rotate(${p.angle}deg)`);
    expect(markup).toContain('class="truck"');
  });

  it('colours one stretch per stored model run, and labels the temperature scale from data', () => {
    const markup = html(<RouteMap state={spiked} />);
    expect(count(markup, 'class="route-heat"')).toBe(stretchesOf(spiked.snapshots, spiked.shipment.transitTotalHours).length);
    expect(markup).toContain('color-mix(in srgb, var(--color-critical)');
    expect(visibleText(markup)).toContain(`${spiked.model.idealTemperatureC.toFixed(0)} °C`);
    expect(visibleText(markup)).toContain(`${spiked.telemetry.at(-1)!.temperature.toFixed(0)} °C`);
  });

  it('shows where shelf life ends only when it really ends in transit', () => {
    const elapsed = spiked.shipment.transitTotalHours - spiked.current.transitRemainingHours;
    expect(visibleText(html(<RouteMap state={spiked} />))).toContain(`Shelf life ends at ${hours(elapsed + spiked.current.remainingHours)} h`);
    expect(visibleText(html(<RouteMap state={baseline} />))).not.toContain('Shelf life ends');
  });

  it('explains what basis the end-of-shelf-life marker uses, so it is not mistaken for the projection', () => {
    const markup = html(<RouteMap state={spiked} />);
    expect(markup).toContain('aria-label="About where shelf life ends"');
    expect(markup).toContain('counted hour for hour against transit time');
    expect(markup).toContain('projects what happens if today');
  });

  it('has no road coloured before any reading exists, and uses no map service', () => {
    const markup = html(<RouteMap state={baseline} />);
    expect(count(markup, 'class="route-heat"')).toBe(0);
    expect(markup).not.toMatch(/https?:\/\/|<img|<iframe/i);
  });

  it('is described for screen readers', () => {
    expect(html(<RouteMap state={spiked} />)).toContain('Shelf life runs out before arrival.');
  });
});

describe('shelf-life chart', () => {
  it('distinguishes observed from projected, and keeps every stored point', () => {
    const markup = html(<Timeline state={spiked} />);
    expect(markup).toContain('class="shelf-line"');
    expect(markup).toContain('class="projected-line"');
    expect(markup).toContain('class="projected-end"');
    expect(count(markup, 'class="node node-')).toBe(spiked.snapshots.length);
    const legend = visibleText(markup);
    expect(legend).toContain('Observed');
    expect(legend).toContain('Projected');
  });

  it('draws the markdown threshold at the policy edge, with a tooltip that explains it', () => {
    const markup = html(<Timeline state={spiked} />);
    expect(markup).toContain('class="markdown-line"');
    expect(visibleText(markup)).toContain(`Markdown starts below ${spiked.model.riskBands.normalAboveHours} h`);
    expect(markup).toContain(`Below ${spiked.model.riskBands.normalAboveHours} h of shelf life the liquidation policy recommends a markdown`);
  });

  it('explains the projection with the real latest reading', () => {
    const markup = html(<Timeline state={spiked} />);
    expect(markup).toContain(`the latest reading (${spiked.current.temperature.toFixed(1)} °C, ${spiked.current.humidity.toFixed(0)}% RH)`);
  });

  it('puts the projected arrival value in the accessible description and the table', () => {
    const markup = html(<Timeline state={spiked} />);
    expect(markup).toContain('projects to');
    expect(markup).toContain('class="is-projected"');
  });

  it('still projects at baseline, from the same formula', () => {
    expect(html(<Timeline state={baseline} />)).toContain('class="projected-line"');
  });
});

describe('no duplicated facts on the Control Tower page', () => {
  const page = () => {
    const rec = spiked.recommendations[0]!;
    const markup = [
      html(<Hero state={spiked} holdMs={0} />),
      html(<StoryRail state={spiked} revealed={Infinity} />),
      html(<ActionBar busy={null} run={null} onSpike={() => {}} onNormal={() => {}} onReset={() => {}} onRetry={() => {}} />),
      html(<Timeline state={spiked} />),
      html(<Liquidation state={spiked} />),
      html(<Explain state={spiked} />),
    ].join('');
    return { text: visibleText(markup), rec };
  };

  it('states the markdown percentage once', () => {
    const { text, rec } = page();
    expect(count(text, `${rec.markdownPct}%`)).toBe(1);
  });

  it('states the new price once', () => {
    const { text, rec } = page();
    expect(count(text, `₹${rec.recommendedPricePerKg}`)).toBe(1);
  });

  it('states the liquidation reason once', () => {
    const { text, rec } = page();
    expect(count(text, rec.reason)).toBe(1);
  });

  it('states the sell window once', () => {
    const { text, rec } = page();
    expect(count(text, `${rec.sellByHours} h`)).toBe(1);
  });

  it('keeps secondary explanations behind ⓘ tooltips, which have accessible names', () => {
    const markup = html(<Hero state={spiked} holdMs={0} />) + html(<Liquidation state={spiked} />) + html(<Timeline state={spiked} />);
    expect(count(markup, 'class="info-tip"')).toBeGreaterThanOrEqual(5);
    expect(markup).toContain('aria-label="About arrival margin"');
    expect(markup).toContain('aria-label="About markdown"');
    expect(markup).toContain('aria-label="About the projection"');
  });
});

describe('reset and actions', () => {
  it('Reset demo is a real secondary button that calls the reset handler', () => {
    const markup = html(<ActionBar busy={null} run={null} onSpike={() => {}} onNormal={() => {}} onReset={() => {}} onRetry={() => {}} />);
    expect(markup).toMatch(/<button type="button" class="btn btn-secondary"[^>]*>Reset demo<\/button>/);
    expect(markup).not.toContain('btn-tertiary');
  });

  it('reports a reset in progress and locks the buttons meanwhile', () => {
    const markup = html(<ActionBar busy="reset" run={null} onSpike={() => {}} onNormal={() => {}} onReset={() => {}} onRetry={() => {}} />);
    expect(markup).toContain('Resetting…');
    expect(markup).toContain('aria-busy="true"');
    expect(count(markup, 'disabled')).toBe(3);
  });

  it('announces a failed action as an alert and a success politely', () => {
    const toasts = [
      { id: 1, kind: 'success' as const, text: 'Demo reset' },
      { id: 2, kind: 'error' as const, text: 'Reset failed' },
    ];
    const markup = html(<ToastRegion toasts={toasts} onDismiss={() => {}} />);
    expect(markup).toMatch(/role="status"[^>]*>[\s\S]*Demo reset/);
    expect(markup).toMatch(/role="alert"[^>]*>[\s\S]*Reset failed/);
    expect(count(markup, 'aria-label="Dismiss message"')).toBe(2);
  });
});

describe('every number comes from the API', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
    });
  const code = (file: string) =>
    readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('no source file hard-codes the demo result', () => {
    const offenders: string[] = [];
    for (const file of walk(resolve(__dirname, '../src'))) {
      const text = code(file);
      if (/\b17\.(65|7)\b|₹\s?65\b|\b35\s?%/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('the hero text is the formatted API value, whatever it is', () => {
    const custom = structuredClone(spiked);
    custom.current.remainingHours = 41.3;
    custom.current.riskLevel = 'WATCH';
    const markup = html(<ShelfGauge state={custom} holdMs={0} />);
    expect(markup).toContain('>41.3<');
    expect(visibleText(markup)).toContain('WATCH');
    expect(markup).not.toContain('17.7');
  });
});

describe('motion is optional', () => {
  const css = readFileSync(resolve(__dirname, '../src/styles.css'), 'utf8');

  it('animates the truck, the road and the gauge — and the reduced-motion rule covers all animation', () => {
    expect(css).toMatch(/\.truck-bob \{[^}]*animation:/);
    expect(css).toMatch(/\.route-lane \{[^}]*animation:/);
    expect(css).toMatch(/\.gauge-fill \{[^}]*transition:/);
    const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(block).toMatch(/\*,\s*\*::before,\s*\*::after/);
    expect(block).toMatch(/animation-duration: 0\.001ms !important/);
    expect(block).toMatch(/transition-duration: 0\.001ms !important/);
  });

  it('closed tooltips take no space, so they can never widen the page on a phone', () => {
    // Regression: visibility:hidden bubbles still counted toward scroll width (417px on a 375px screen).
    expect(css).toMatch(/\.tip-bubble \{[^}]*display: none/);
    expect(css).not.toMatch(/\.tip-bubble \{[^}]*visibility: hidden/);
    expect(css).toMatch(/\.tip-bubble\[data-open\] \{[^}]*display: block/);
  });

  it('uses no external map or animation library', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['express', 'react', 'react-dom']);
  });
});
