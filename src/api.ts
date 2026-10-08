import type { ShipmentDetail } from '../server/pipeline';
import type { TelemetryPayload } from '../shared/scenarios';

export interface ShipmentSummary {
  id: string;
  code: string;
  produce: string;
  status: 'IN_TRANSIT' | 'ARRIVED';
  currentTemperature: number;
  currentHumidity: number;
  remainingShelfLifeHours: number;
  riskLevel: string;
  currentPricePerKg: number;
}

interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: string[] };
}

/** Throws a readable message from the server's standard error shape. Never shows raw bodies. */
async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as ApiErrorBody & Partial<T>;
  if (!response.ok) {
    const message = body.error?.message ?? `Request failed (${response.status}).`;
    const details = body.error?.details?.length ? ` ${body.error.details.join(' ')}` : '';
    throw new Error(message + details);
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

export async function sendTelemetry(
  shipmentId: string,
  payload: Omit<TelemetryPayload, 'shipmentId'>,
): Promise<ShipmentDetail> {
  const body = await readJson<{ shipment: ShipmentDetail }>(
    await fetch('/api/telemetry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shipmentId, ...payload }),
    }),
  );
  return body.shipment;
}

export async function resetShipment(shipmentId: string): Promise<ShipmentDetail> {
  return readJson<ShipmentDetail>(await fetch(`/api/shipments/${shipmentId}/reset`, { method: 'POST' }));
}
