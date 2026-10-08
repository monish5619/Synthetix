import type { ProductProfile } from './model.js';

/**
 * Demo shipment baseline. All figures are illustrative demo data, not a real shipment.
 * Reference profile: 120 h of shelf life at 4 °C / 60 % RH, with Q10 = 2.5.
 */
export const DEMO_SHIPMENT = {
  code: 'SH-2041',
  produce: 'Roma tomatoes',
  origin: 'Hosur Farm Hub',
  destination: 'Coimbatore',
  retailer: 'Coimbatore Fresh Market (demo partner)',
  quantityKg: 1200,
  basePricePerKg: 100,
  transitHours: 36,
  startTempC: 4,
  startHumidityPct: 60,
  profile: {
    produce: 'Roma tomatoes',
    referenceTempC: 4,
    referenceHumidityPct: 60,
    referenceShelfLifeHours: 120,
    q10: 2.5,
  } satisfies ProductProfile,
};
