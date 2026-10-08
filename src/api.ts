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
  const body = await readJson<{ shipments: ShipmentSummary[] }>(await fetch('/api/shipments'));
  return body.shipments;
}

export async function fetchShipment(id: string): Promise<ShipmentDetail> {
  return readJson<ShipmentDetail>(await fetch(`/api/shipments/${id}`));
}

/** Primary action. The server generates the thermal reading. The browser sends no values. */
export async function simulateSpike(shipmentId: string): Promise<ScenarioResult> {
  return readJson<ScenarioResult>(await fetch(`/api/shipments/${shipmentId}/simulate-spike`, { method: 'POST' }));
}

export async function simulateNormal(shipmentId: string): Promise<ScenarioResult> {
  return readJson<ScenarioResult>(await fetch(`/api/shipments/${shipmentId}/simulate-normal`, { method: 'POST' }));
}

export async function resetShipment(shipmentId: string): Promise<ShipmentDetail> {
  return readJson<ShipmentDetail>(await fetch(`/api/shipments/${shipmentId}/reset`, { method: 'POST' }));
}

export interface HealthReport {
  telemetryApi: 'ONLINE';
  database: 'CONNECTED';
  degradationEngine: 'READY' | 'FAILED';
  liquidationEngine: 'READY' | 'FAILED';
  checkedAt: string;
}

export async function fetchHealth(): Promise<HealthReport> {
  return readJson<HealthReport>(await fetch('/api/health'));
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
  return (await readJson<{ listings: MarketplaceListing[] }>(await fetch('/api/marketplace'))).listings;
}

export async function fetchAlerts(): Promise<AlertItem[]> {
  return (await readJson<{ alerts: AlertItem[] }>(await fetch('/api/alerts'))).alerts;
}

export async function fetchTelemetryHistory(shipmentId: string): Promise<HistoryEntry[]> {
  return (await readJson<{ entries: HistoryEntry[] }>(await fetch(`/api/shipments/${shipmentId}/telemetry-history`))).entries;
}
