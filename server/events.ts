import type { Request, Response } from 'express';

/**
 * Minimal server-sent events: one stream, and a tiny "something changed" message
 * after each successful telemetry write. The message carries no readings; clients
 * refetch from the normal API, so there is one source of truth and nothing to
 * keep in sync. In-process only, which is right for a single-server deployment.
 */
const clients = new Set<Response>();
const HEARTBEAT_MS = 25_000;

export interface ChangeEvent {
  shipmentId: string;
  kind: 'telemetry' | 'reset';
}

export function openStream(req: Request, res: Response): void {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\n: connected\n\n');
  clients.add(res);
  // Comment lines keep proxies from closing an idle connection.
  const beat = setInterval(() => res.write(': keep-alive\n\n'), HEARTBEAT_MS);
  beat.unref();
  req.on('close', () => {
    clearInterval(beat);
    clients.delete(res);
  });
}

/** Tells every connected client that a shipment changed. Never throws into the caller's transaction. */
export function publishChange(event: ChangeEvent): void {
  const frame = `event: change\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try {
      res.write(frame);
    } catch {
      clients.delete(res);
    }
  }
}

export const connectedClients = () => clients.size;
