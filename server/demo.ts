import type { ProductProfile } from './model.js';

/**
 * Demo shipment, seeded into the database on first start. Illustrative data only.
 * Reference profile: 120 h of shelf life at 4 °C / 60 % RH, Q10 = 2.5.
 */
export const DEMO_SHIPMENT = {
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
  profile: {
    produce: 'Premium Tomatoes',
    referenceTempC: 4,
    referenceHumidityPct: 60,
    referenceShelfLifeHours: 120,
    q10: 2.5,
  } satisfies ProductProfile,
};
