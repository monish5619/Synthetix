/**
 * Telemetry presets used by the control-tower buttons. The browser sends these
 * to the ingest API exactly like any other telemetry event; the server validates
 * them and runs the same pipeline it would for real readings.
 */
export interface TelemetryPayload {
  temperatureC: number;
  humidityPct: number;
  intervalHours: number;
  source: 'SIMULATOR' | 'MANUAL';
}

export const AMBIENT_SPIKE: TelemetryPayload = {
  temperatureC: 22,
  humidityPct: 80,
  intervalHours: 1.5,
  source: 'SIMULATOR',
};

export const NORMAL_READING: TelemetryPayload = {
  temperatureC: 4,
  humidityPct: 60,
  intervalHours: 2,
  source: 'SIMULATOR',
};
