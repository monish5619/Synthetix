import { openDatabase } from '../../server/db';
import { getShipmentDetail, ingestTelemetry, type ShipmentDetail } from '../../server/pipeline';
import { resetDemoShipment, seedDemoShipment } from '../../server/seed';
import { AMBIENT_SPIKE, NORMAL_READING, type SimulatedReading } from '../../server/simulator';
import { validateTelemetry } from '../../server/validation';

/**
 * Real shipment states, produced by the real pipeline on in-memory databases.
 * UI tests render these instead of hand-written fixtures, so what they assert
 * about is what the API actually returns.
 */
function freshDemo() {
  const db = openDatabase(':memory:');
  const id = seedDemoShipment(db);
  const detail = () => getShipmentDetail(db, id);
  const run = (reading: SimulatedReading): ShipmentDetail => {
    const v = validateTelemetry({ shipmentId: id, ...reading });
    if (!v.ok) throw new Error('scenario failed validation');
    ingestTelemetry(db, v.value);
    return detail();
  };
  return { db, detail, run, reset: () => resetDemoShipment(db) };
}

export function demoStates() {
  // The same journeys a person takes in the app, each from a fresh start.
  const a = freshDemo();
  const baseline = a.detail();
  a.db.close();

  const b = freshDemo();
  const normal = b.run(NORMAL_READING);
  b.db.close();

  const c = freshDemo();
  const spiked = c.run(AMBIENT_SPIKE); // reset → spike, exactly as in the demo
  c.reset();
  const reset = c.detail();
  c.db.close();

  return { baseline, normal, spiked, reset };
}
