/**
 * Input guards shared by the API and the engines. Each one throws a RangeError or
 * TypeError with a fixed message. Nothing user-supplied is echoed back.
 */
import { createHash } from 'node:crypto';
import { LIQUIDATION_MAX_MARKDOWN_PCT } from './config.js';

export const MAX_PRICE_PER_KG = 100_000;

/** Prices are positive, finite, and bounded. NaN and Infinity are rejected explicitly. */
export function assertPricePerKg(value: unknown, name = 'price'): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number.`);
  if (value <= 0 || value > MAX_PRICE_PER_KG) throw new RangeError(`${name} must be greater than 0 and at most ${MAX_PRICE_PER_KG}.`);
  return value;
}

/** Markdown is an integer percentage from 0 to the policy maximum. */
export function assertMarkdownPct(value: unknown, name = 'markdown percentage'): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number.`);
  if (!Number.isInteger(value) || value < 0 || value > LIQUIDATION_MAX_MARKDOWN_PCT) {
    throw new RangeError(`${name} must be a whole number from 0 to ${LIQUIDATION_MAX_MARKDOWN_PCT}.`);
  }
  return value;
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

/** Idempotency keys are opaque tokens of 8 to 128 safe characters. */
export function isValidIdempotencyKey(raw: string): boolean {
  return IDEMPOTENCY_KEY.test(raw);
}

/** Stable hash of a request body, so a reused key with a different body can be detected. */
export function hashRequest(scope: string, body: unknown): string {
  const canonical = JSON.stringify(sortKeys(body));
  return createHash('sha256').update(scope).update('\0').update(canonical).digest('hex');
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/**
 * Recognises database failures without exposing them: a closed connection, a locked
 * file, or a database that cannot be opened. Anything else is an internal error.
 */
export function isDatabaseUnavailable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { code?: unknown; message?: unknown };
  if (e.code === 'ERR_INVALID_STATE' && typeof e.message === 'string' && e.message.includes('database is not open')) {
    return true;
  }
  return typeof e.message === 'string' && /database is locked|unable to open database/i.test(e.message);
}
