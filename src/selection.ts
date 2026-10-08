import { useEffect, useState } from 'react';
import { DEMO_SHIPMENT } from '../server/demo';

/**
 * Which shipment the Control Tower and Telemetry pages show.
 * By default the demo shipment, found by its code (not by position: a reset recreates
 * it, so it is not reliably first). A fleet card can pick another with `?s=<id>`.
 */
export function selectedIdFromHash(hash: string): string | null {
  const query = hash.split('?')[1];
  if (!query) return null;
  const id = new URLSearchParams(query).get('s');
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

export function pickShipment<T extends { id: string; code: string }>(list: readonly T[], selectedId: string | null): T | undefined {
  return (
    list.find((s) => s.id === selectedId) ?? list.find((s) => s.code === DEMO_SHIPMENT.code) ?? list[0]
  );
}

/** The link that opens a given shipment on the Control Tower. */
export const controlTowerLink = (id: string) => `#/?s=${id}`;

/** The selected shipment id from the address bar, kept current as it changes. */
export function useSelectedShipmentId(): string | null {
  const [id, setId] = useState(() => selectedIdFromHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setId(selectedIdFromHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return id;
}
