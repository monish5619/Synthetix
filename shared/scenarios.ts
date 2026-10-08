/**
 * Telemetry request body, as accepted by POST /api/telemetry.
 * Presets below are used by the control-tower buttons. The browser sends them
 * like any other reading, and the server validates and processes them the same way.
 */
export interface TelemetryPayload {
  temperature: number;
  humidity: number;
  transitDuration: number;
}

export const AMBIENT_SPIKE: Omit<TelemetryPayload, 'shipmentId'> = {
  temperature: 22,
  humidity: 80,
  transitDuration: 14,
};

export const NORMAL_READING: Omit<TelemetryPayload, 'shipmentId'> = {
  temperature: 4,
  humidity: 60,
  transitDuration: 2,
};
