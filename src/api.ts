import type { ShipmentState } from '../server/pipeline';
import type { TelemetryPayload } from '../shared/scenarios';

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as { error?: string; details?: string[] } & T;
  if (!response.ok) {
    const detail = body.details?.length ? ` ${body.details.join(' ')}` : '';
    throw new Error(`${body.error ?? `Request failed (${response.status}).`}${detail}`);
  }
  return body as T;
}

export async function fetchShipment(): Promise<ShipmentState> {
  return readJson<ShipmentState>(await fetch('/api/shipment'));
}

export async function sendTelemetry(shipmentId: string, payload: TelemetryPayload): Promise<ShipmentState> {
  return readJson<ShipmentState>(
    await fetch(`/api/shipments/${shipmentId}/telemetry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  );
}

export async function resetShipment(shipmentId: string): Promise<ShipmentState> {
  return readJson<ShipmentState>(await fetch(`/api/shipments/${shipmentId}/reset`, { method: 'POST' }));
}
