import type { TelemetryPayload } from '../shared/scenarios.js';

export type ValidationResult =
  | { ok: true; value: TelemetryPayload }
  | { ok: false; errors: string[] };

const SOURCES = ['SIMULATOR', 'MANUAL'] as const;

/** Validates an untrusted telemetry body. Never throws. */
export function validateTelemetry(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, errors: ['Body must be a JSON object.'] };
  }
  const input = body as Record<string, unknown>;
  const errors: string[] = [];

  const temperatureC = readNumber(input, 'temperatureC', -40, 60, errors);
  const humidityPct = readNumber(input, 'humidityPct', 0, 100, errors);

  let intervalHours = NaN;
  const rawInterval = input.intervalHours;
  if (typeof rawInterval !== 'number' || !Number.isFinite(rawInterval)) {
    errors.push('intervalHours must be a finite number.');
  } else if (rawInterval <= 0 || rawInterval > 24) {
    errors.push('intervalHours must be greater than 0 and at most 24.');
  } else {
    intervalHours = rawInterval;
  }

  let source: TelemetryPayload['source'] = 'MANUAL';
  if (input.source !== undefined) {
    if (typeof input.source === 'string' && (SOURCES as readonly string[]).includes(input.source)) {
      source = input.source as TelemetryPayload['source'];
    } else {
      errors.push(`source must be one of ${SOURCES.join(', ')}.`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { temperatureC, humidityPct, intervalHours, source } };
}

function readNumber(
  input: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  errors: string[],
): number {
  const value = input[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${key} must be a finite number.`);
    return NaN;
  }
  if (value < min || value > max) {
    errors.push(`${key} must be between ${min} and ${max}.`);
  }
  return value;
}
