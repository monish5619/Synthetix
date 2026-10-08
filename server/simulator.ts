/**
 * Simulated telemetry for the demo. The server generates these readings. The
 * browser only asks for a scenario by name and never supplies the values.
 *
 * Software only: no sensors or hardware are involved.
 */
export interface SimulatedReading {
  temperature: number;
  humidity: number;
  transitDuration: number;
}

/**
 * Ambient thermal spike during transit. 30 °C and 85 % RH for 6.3 h.
 * Stress = 2.5^((30 − 4) / 10) ≈ 10.83. Humidity factor = 1 + 0.02 × 25 = 1.5.
 * Added ageing = 6.3 × 10.83 × 1.5 ≈ 102.35 h, leaving ≈ 17.65 h.
 * The 6.3 h duration is the scenario input. The model coefficients are not tuned for it.
 */
export const AMBIENT_SPIKE: SimulatedReading = {
  temperature: 30,
  humidity: 85,
  transitDuration: 6.3,
};

/** A normal reading: ideal temperature and humidity over a 2 h interval. */
export const NORMAL_READING: SimulatedReading = {
  temperature: 4,
  humidity: 60,
  transitDuration: 2,
};

export const SCENARIOS = {
  'ambient-spike': AMBIENT_SPIKE,
  'normal-reading': NORMAL_READING,
} as const;

export type ScenarioName = keyof typeof SCENARIOS;
