import { DEMO_BASELINE } from './config.js';

/**
 * Demo shipment, seeded into the database on first start. Illustrative data only.
 * Model parameters (Q10, ideal temperature, humidity threshold, calibration) live
 * in config.ts. This file holds only shipment-specific facts.
 */
export const DEMO_SHIPMENT = {
  id: '6f1c2a7e-3b4d-4e8f-9a10-42a1042a1042',
  code: 'AS-1042',
  produce: 'Premium Tomatoes',
  origin: 'Hosur Farm Hub',
  destination: 'Coimbatore',
  retailer: 'Coimbatore Fresh Market (demo partner)',
  quantityKg: 1200,
  originalPricePerKg: 100,
  transitHours: 36,
  initialTemperatureC: 4,
  initialHumidityPct: 60,
  baselineShelfLifeHours: DEMO_BASELINE.shelfLifeHours,
};
