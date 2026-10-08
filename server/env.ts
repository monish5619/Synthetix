/**
 * Environment configuration, validated once at startup. Every variable is read here
 * and nowhere else. Errors name the variable but never echo its value, so a bad
 * secret cannot end up in a log line.
 *
 * Only server-side variables live here. Anything prefixed VITE_ is public, because Vite
 * embeds it in the browser bundle. Never put a secret in a VITE_ variable.
 */

export type NodeEnv = 'development' | 'production' | 'test';

export interface AppEnv {
  nodeEnv: NodeEnv;
  port: number;
  databasePath: string;
  allowedOrigins: readonly string[];
  demoMode: boolean;
}

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvError';
  }
}

const NODE_ENVS: readonly NodeEnv[] = ['development', 'production', 'test'];

export function readEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const nodeEnv = (source.NODE_ENV ?? 'development') as NodeEnv;
  if (!NODE_ENVS.includes(nodeEnv)) {
    throw new EnvError('NODE_ENV must be one of: development, production, test.');
  }
  const production = nodeEnv === 'production';

  const port = parsePort(source.PORT);
  const databasePath = (source.DATABASE_PATH ?? 'data/agrosense.db').trim();
  if (databasePath === '' || databasePath.includes('\0')) {
    throw new EnvError('DATABASE_PATH must be a non-empty file path.');
  }

  const allowedOrigins = parseOrigins(source.ALLOWED_ORIGINS ?? '', production);
  const demoMode = parseBoolean('DEMO_MODE', source.DEMO_MODE, !production);

  return { nodeEnv, port, databasePath, allowedOrigins, demoMode };
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 8787;
  if (!/^\d+$/.test(raw.trim())) throw new EnvError('PORT must be an integer between 1 and 65535.');
  const port = Number(raw.trim());
  if (port < 1 || port > 65535) throw new EnvError('PORT must be an integer between 1 and 65535.');
  return port;
}

function parseBoolean(name: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = raw.trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new EnvError(`${name} must be "true" or "false".`);
}

/**
 * Comma-separated list of origins allowed to call the API cross-origin. Each entry must
 * be an exact origin (scheme, host, optional port, no path, no wildcard). In production
 * only https is accepted. The default is empty: same-origin only.
 */
function parseOrigins(raw: string, production: boolean): readonly string[] {
  const entries = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const entry of entries) {
    if (entry === '*') throw new EnvError('ALLOWED_ORIGINS must list exact origins. Wildcards are not allowed.');
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new EnvError('ALLOWED_ORIGINS contains an entry that is not a valid URL.');
    }
    const secure = url.protocol === 'https:';
    if (!secure && (production || url.protocol !== 'http:')) {
      throw new EnvError('ALLOWED_ORIGINS entries must use https in production.');
    }
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
      throw new EnvError('ALLOWED_ORIGINS entries must be bare origins with no path, query, or credentials.');
    }
  }
  return entries.map((e) => new URL(e).origin);
}
