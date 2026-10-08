/**
 * Vercel serverless entry for every /api/* request. It reuses the existing Express app
 * unchanged. The database lives in the function's writable temp directory, set by
 * DATABASE_PATH, and the demo shipment is re-seeded on each cold start.
 */
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';
import { readEnv } from '../server/env.js';
import { seedFleet } from '../server/fleet.js';
import { seedDemoShipment } from '../server/seed.js';

const env = readEnv();
const db = openDatabase(env.databasePath);
seedDemoShipment(db);
if (env.demoMode) seedFleet(db);

export default createApp(db, {
  allowedOrigins: env.allowedOrigins,
  demoMode: env.demoMode,
  ingestApiKey: env.ingestApiKey,
  rateLimitPerMinute: env.rateLimitPerMinute,
});
