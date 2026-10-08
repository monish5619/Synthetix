import { VALID_RANGES } from '../../server/config';
import { AMBIENT_SPIKE, NORMAL_READING } from '../../server/simulator';
import type { Reading } from '../api';

/**
 * Starting points for the simulator. These are INPUTS (a temperature, a humidity, a
 * duration), never results: the outcome of every one is computed by the backend model.
 * "Normal" and "Reefer failure" are the server's own scripted scenarios, imported so the
 * two can never drift apart.
 */
export interface Preset {
  id: 'normal' | 'reefer-failure' | 'door-open' | 'traffic-delay';
  label: string;
  /** Two or three words for a tooltip. */
  hint: string;
  reading: Reading;
}

export const PRESETS: readonly Preset[] = [
  { id: 'normal', label: 'Normal', hint: 'Ideal temperature, 2 h', reading: { ...NORMAL_READING } },
  { id: 'reefer-failure', label: 'Reefer failure', hint: 'Cooling stops: hot and humid', reading: { ...AMBIENT_SPIKE } },
  { id: 'door-open', label: 'Door open', hint: 'Warm air in for a short while', reading: { temperature: 14, humidity: 75, transitDuration: 1.5 } },
  { id: 'traffic-delay', label: 'Traffic delay', hint: 'Slightly warm, for a long time', reading: { temperature: 9, humidity: 65, transitDuration: 8 } },
];

/** Slider ends: practical ranges for the controls. The server enforces the real limits. */
export const SLIDER = {
  temperature: { min: 0, max: 45, step: 0.5 },
  humidity: { min: 30, max: 100, step: 1 },
  transitDuration: { min: 0.5, max: VALID_RANGES.exposureHours.max, step: 0.1 },
} as const;

/** Which preset (if any) exactly matches a reading, so the active one can be highlighted. */
export function matchPreset(reading: Reading): Preset['id'] | null {
  return (
    PRESETS.find(
      (p) =>
        p.reading.temperature === reading.temperature &&
        p.reading.humidity === reading.humidity &&
        p.reading.transitDuration === reading.transitDuration,
    )?.id ?? null
  );
}

/** Turns text-box contents into a reading, or says which field is not a usable number. */
export function parseReading(fields: { temperature: string; humidity: string; transitDuration: string }): { ok: true; reading: Reading } | { ok: false; error: string } {
  const entries = [
    ['Temperature', fields.temperature],
    ['Humidity', fields.humidity],
    ['Duration', fields.transitDuration],
  ] as const;
  for (const [name, text] of entries) {
    if (text.trim() === '' || !Number.isFinite(Number(text))) return { ok: false, error: `${name} must be a number.` };
  }
  return {
    ok: true,
    reading: { temperature: Number(fields.temperature), humidity: Number(fields.humidity), transitDuration: Number(fields.transitDuration) },
  };
}
