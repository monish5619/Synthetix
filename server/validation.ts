/** Validated telemetry request, using the field names from the public API. */
export interface TelemetryRequest {
  shipmentId: string;
  temperature: number;
  humidity: number;
  transitDuration: number;
}

export type ValidationResult =
  | { ok: true; value: TelemetryRequest }
  | { ok: false; errors: string[] };

export const TEMPERATURE_RANGE = { min: -40, max: 60 } as const;
export const HUMIDITY_RANGE = { min: 0, max: 100 } as const;
export const TRANSIT_DURATION_RANGE = { min: 0, max: 24 } as const;

const FIELDS = ['shipmentId', 'temperature', 'humidity', 'transitDuration'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates an untrusted telemetry body. Never throws.
 * Rejects missing or unknown fields, non-numbers (including NaN and Infinity,
 * which cannot arrive as JSON numbers but can after overflow, e.g. 1e999),
 * out-of-range values, and negative durations.
 */
export function validateTelemetry(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, errors: ['Request body must be a JSON object.'] };
  }
  const input = body as Record<string, unknown>;
  const errors: string[] = [];

  for (const key of Object.keys(input)) {
    if (!(FIELDS as readonly string[]).includes(key)) errors.push(`Unknown field "${key}".`);
  }

  const { shipmentId } = input;
  if (shipmentId === undefined) {
    errors.push('shipmentId is required.');
  } else if (typeof shipmentId !== 'string' || !UUID.test(shipmentId)) {
    errors.push('shipmentId must be a valid shipment id.');
  }

  const temperature = readNumber(input, 'temperature', TEMPERATURE_RANGE, errors);
  const humidity = readNumber(input, 'humidity', HUMIDITY_RANGE, errors);
  const transitDuration = readNumber(input, 'transitDuration', TRANSIT_DURATION_RANGE, errors);

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { shipmentId: shipmentId as string, temperature, humidity, transitDuration },
  };
}

function readNumber(
  input: Record<string, unknown>,
  key: string,
  range: { min: number; max: number },
  errors: string[],
): number {
  const value = input[key];
  if (value === undefined) {
    errors.push(`${key} is required.`);
    return NaN;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${key} must be a finite number.`);
    return NaN;
  }
  if (value < range.min || value > range.max) {
    errors.push(`${key} must be between ${range.min} and ${range.max}.`);
  }
  return value;
}
