import { useEffect, useId, useRef, useState } from 'react';
import type { TelemetryPreview } from '../../server/preview';
import { previewReading, type Reading } from '../api';
import { hours, multiplier } from '../format';
import { PRESETS, SLIDER, matchPreset, parseReading } from '../simulator/presets';
import { InfoTip } from '../ui/InfoTip';
import { RiskBadge } from './RiskBadge';

interface Props {
  shipmentId: string;
  disabled: boolean;
  /** Commits through the real pipeline. Resolves when the server has answered. */
  onCommit: (reading: Reading) => Promise<void>;
}

type Fields = { temperature: string; humidity: string; transitDuration: string };
const toFields = (r: Reading): Fields => ({
  temperature: String(r.temperature),
  humidity: String(r.humidity),
  transitDuration: String(r.transitDuration),
});

/**
 * Try a reading before committing it. "Preview" asks the server what the real model would
 * do and writes nothing. "Commit" sends the reading through the real telemetry pipeline.
 * No part of the model runs in the browser: every figure shown comes from the server.
 */
export function SimulatorPanel({ shipmentId, disabled, onCommit }: Props) {
  const [fields, setFields] = useState<Fields>(() => toFields(PRESETS[0]!.reading));
  const [preview, setPreview] = useState<TelemetryPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<'preview' | 'commit' | null>(null);
  const ids = { t: useId(), h: useId(), d: useId() };
  /** A preview only describes the reading and shipment state it was made for. */
  const forKey = useRef('');

  const parsed = parseReading(fields);
  const active = parsed.ok ? matchPreset(parsed.reading) : null;
  const key = (r: Reading) => `${shipmentId}|${r.temperature}|${r.humidity}|${r.transitDuration}`;

  // Editing anything makes the old preview stale, so it is cleared rather than left misleading.
  useEffect(() => {
    if (!parsed.ok || forKey.current !== key(parsed.reading)) setPreview(null);
  });

  const set = (patch: Partial<Fields>) => {
    setFields((f) => ({ ...f, ...patch }));
    setError(null);
  };

  const runPreview = async () => {
    if (!parsed.ok) return setError(parsed.error);
    setWorking('preview');
    setError(null);
    try {
      const result = await previewReading(shipmentId, parsed.reading);
      forKey.current = key(parsed.reading);
      setPreview(result);
    } catch (err) {
      setPreview(null);
      setError(err instanceof TypeError ? 'Could not reach the AgroSense server.' : err instanceof Error ? err.message : 'Preview failed.');
    } finally {
      setWorking(null);
    }
  };

  const runCommit = async () => {
    if (!parsed.ok) return setError(parsed.error);
    setWorking('commit');
    setError(null);
    try {
      await onCommit(parsed.reading);
      setPreview(null); // the committed result is on the page now; the preview is spent
    } catch {
      // The page reports a failed commit itself; nothing was changed.
    } finally {
      setWorking(null);
    }
  };

  const busy = disabled || working !== null;

  return (
    <section className="sim" aria-labelledby="sim-title">
      <header className="sim-head">
        <h2 id="sim-title" className="card-title">
          Telemetry simulator
        </h2>
        <InfoTip about="the simulator" text="Preview asks the real model what a reading would do and saves nothing. Commit sends it through the real telemetry pipeline." />
      </header>

      <div className="sim-presets" role="group" aria-label="Presets">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`chip-btn ${active === p.id ? 'is-active' : ''}`}
            aria-pressed={active === p.id}
            title={p.hint}
            onClick={() => set(toFields(p.reading))}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="sim-controls">
        <Control
          id={ids.t}
          label="Temperature"
          unit="°C"
          value={fields.temperature}
          slider={SLIDER.temperature}
          onChange={(v) => set({ temperature: v })}
        />
        <Control
          id={ids.h}
          label="Humidity"
          unit="% RH"
          value={fields.humidity}
          slider={SLIDER.humidity}
          onChange={(v) => set({ humidity: v })}
        />
        <Control
          id={ids.d}
          label="Duration"
          unit="h"
          value={fields.transitDuration}
          slider={SLIDER.transitDuration}
          onChange={(v) => set({ transitDuration: v })}
        />
      </div>

      <div className="sim-actions">
        <button type="button" className="btn btn-secondary" disabled={busy} aria-busy={working === 'preview'} onClick={runPreview}>
          {working === 'preview' ? 'Previewing…' : 'Preview impact'}
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} aria-busy={working === 'commit'} onClick={runCommit}>
          {working === 'commit' ? 'Committing…' : 'Commit telemetry'}
        </button>
      </div>

      {error && (
        <p className="notice is-error" role="alert">
          {error}
        </p>
      )}

      {preview && <PreviewResult preview={preview} />}
    </section>
  );
}

function Control({
  id,
  label,
  unit,
  value,
  slider,
  onChange,
}: {
  id: string;
  label: string;
  unit: string;
  value: string;
  slider: { min: number; max: number; step: number };
  onChange: (value: string) => void;
}) {
  const n = Number(value);
  return (
    <div className="sim-control">
      <label htmlFor={id}>{label}</label>
      <div className="sim-field">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step={slider.step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="sim-unit">{unit}</span>
      </div>
      <input
        type="range"
        aria-label={`${label} slider`}
        min={slider.min}
        max={slider.max}
        step={slider.step}
        value={Number.isFinite(n) ? Math.min(slider.max, Math.max(slider.min, n)) : slider.min}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** The five things a person needs to see, exactly as the server returned them. */
function PreviewResult({ preview }: { preview: TelemetryPreview }) {
  const rows: Array<[string, string]> = [
    ['Temperature multiplier', multiplier(preview.model.temperatureStress)],
    ['Humidity multiplier', multiplier(preview.model.humidityFactor)],
    ['Ageing contribution', `+${preview.model.equivalentAgeIncrement.toFixed(2)} h`],
    ['Projected shelf life', `${hours(preview.after.remainingHours)} h`],
  ];
  return (
    <div className="sim-result" role="status" aria-live="polite">
      <p className="sim-result-title">
        Preview · nothing saved
        <InfoTip about="the preview" text="Calculated by the server with the real model. The database was not changed." />
      </p>
      <dl className="sim-chips">
        {rows.map(([k, v]) => (
          <div key={k} className="sim-chip">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        <div className="sim-chip">
          <dt>Projected risk</dt>
          <dd>
            <RiskBadge level={preview.after.riskLevel} />
          </dd>
        </div>
        <div className="sim-chip">
          <dt>Automatic markdown</dt>
          <dd>{preview.liquidation.wouldReprice ? 'Would trigger' : 'Not triggered'}</dd>
        </div>
      </dl>
    </div>
  );
}
