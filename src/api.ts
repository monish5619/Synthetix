/**
 * Base URL for the API. Empty means same-origin, which is the default and the safe choice.
 * A build may point the UI at a separate API origin by setting VITE_API_BASE_URL. That
 * value is public: it ends up in the browser bundle, so it must never contain a secret.
 */
const RAW_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
const API_BASE = validateBase(RAW_BASE);

function validateBase(base: string): string {
  if (base === '') return '';
  // HTTPS everywhere. Plain HTTP to localhost is accepted only in development builds,
  // and the production bundle drops that branch entirely.
  const ok =
    /^https:\/\/[^\s/]+$/.test(base) || (import.meta.env.DEV && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base));
  if (!ok) throw new Error('VITE_API_BASE_URL must be an https origin, or empty for same-origin.');
  return base;
}

/** Every API request goes through here, so the base URL and the request policy live in one place. */
function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(API_BASE + path, { ...init, credentials: 'omit', cache: 'no-store' });
}

import type { ShipmentDetail, TelemetryEventView } from '../server/pipeline';
import type { ScenarioName, SimulatedReading } from '../server/simulator';

export interface ShipmentSummary {
  id: string;
  code: string;
  produce: string;
  status: 'IN_TRANSIT' | 'ARRIVED';
  currentTemperature: number;
  currentHumidity: number;
  remainingHours: number;
  riskLevel: string;
  currentPricePerKg: number;
}

/** Response of a scenario run: the reading the server generated, the persisted event, and the full state. */
export interface ScenarioResult {
  scenario: ScenarioName;
  readings: SimulatedReading;
  event: TelemetryEventView;
  shipment: ShipmentDetail;
}

interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: string[] };
}

/** Throws the server's message. Never shows raw bodies, stacks, or internals. */
async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as ApiErrorBody & Partial<T>;
  if (!response.ok) {
    const message = body.error?.message ?? `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return body as T;
}

export async function fetchShipments(): Promise<ShipmentSummary[]> {
  const body = await readJson<{ shipments: ShipmentSummary[] }>(await apiFetch('/api/shipments'));
  return body.shipments;
}

export async function fetchShipment(id: string): Promise<ShipmentDetail> {
  return readJson<ShipmentDetail>(await apiFetch(`/api/shipments/${id}`));
}

/** Primary action. The server generates the thermal reading. The browser sends no values. */
export async function simulateSpike(shipmentId: string): Promise<ScenarioResult> {
  return readJson<ScenarioResult>(await apiFetch(`/api/shipments/${shipmentId}/simulate-spike`, { method: 'POST' }));
}

export async function simulateNormal(shipmentId: string): Promise<ScenarioResult> {
  return readJson<ScenarioResult>(await apiFetch(`/api/shipments/${shipmentId}/simulate-normal`, { method: 'POST' }));
}

export async function resetShipment(shipmentId: string): Promise<ShipmentDetail> {
  return readJson<ShipmentDetail>(await apiFetch(`/api/shipments/${shipmentId}/reset`, { method: 'POST' }));
}

export interface HealthReport {
  telemetryApi: 'ONLINE';
  database: 'CONNECTED';
  degradationEngine: 'READY' | 'FAILED';
  liquidationEngine: 'READY' | 'FAILED';
  checkedAt: string;
}

export async function fetchHealth(): Promise<HealthReport> {
  return readJson<HealthReport>(await apiFetch('/api/health'));
}

/* ---------- secondary read models ---------- */

export type Urgency = 'NONE' | 'MONITOR' | 'PRIORITY' | 'IMMEDIATE';

export interface MarketplaceListing {
  listingId: string;
  shipmentId: string;
  code: string;
  produce: string;
  origin: string;
  destination: string;
  remainingHours: number;
  riskLevel: 'NORMAL' | 'WATCH' | 'HIGH' | 'CRITICAL';
  originalPricePerKg: number;
  currentPricePerKg: number;
  discountPct: number;
  listingStatus: string;
  availableKg: number;
  urgency: Urgency;
  updatedAt: string;
}

export interface AlertItem {
  id: string;
  shipmentId: string;
  code: string;
  produce: string;
  severity: 'HIGH' | 'CRITICAL';
  remainingHours: number;
  markdownPct: number | null;
  recommendedPricePerKg: number | null;
  recommendedAction: string;
  recipient: string;
  message: string;
  createdAt: string;
}

export interface HistoryEntry {
  id: string;
  recordedAt: string;
  kind: 'NORMAL_TELEMETRY' | 'THERMAL_EXCURSION';
  temperature: number;
  humidity: number;
  exposureHours: number;
  remainingHours: number | null;
  riskLevel: 'NORMAL' | 'WATCH' | 'HIGH' | 'CRITICAL' | null;
  explanation: string | null;
}

export async function fetchMarketplace(): Promise<MarketplaceListing[]> {
  return (await readJson<{ listings: MarketplaceListing[] }>(await apiFetch('/api/marketplace'))).listings;
}

export async function fetchAlerts(): Promise<AlertItem[]> {
  return (await readJson<{ alerts: AlertItem[] }>(await apiFetch('/api/alerts'))).alerts;
}

export async function fetchTelemetryHistory(shipmentId: string): Promise<HistoryEntry[]> {
  return (await readJson<{ entries: HistoryEntry[] }>(await apiFetch(`/api/shipments/${shipmentId}/telemetry-history`))).entries;
}
