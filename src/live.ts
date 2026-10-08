import { useEffect, useRef, useState } from 'react';
import { STREAM_URL } from './api';

export interface ChangeEvent {
  shipmentId: string;
  kind: 'telemetry' | 'reset';
}

export function parseChange(data: string): ChangeEvent | null {
  try {
    const v = JSON.parse(data) as Partial<ChangeEvent>;
    return typeof v.shipmentId === 'string' && (v.kind === 'telemetry' || v.kind === 'reset') ? { shipmentId: v.shipmentId, kind: v.kind } : null;
  } catch {
    return null;
  }
}

/**
 * Calls `onChange` whenever the server announces a change. The message is only a nudge:
 * the caller refetches from the normal API. If the stream is unavailable the pages
 * keep working on their own polling, so this only ever makes updates sooner.
 * EventSource reconnects by itself.
 */
export function useChangeStream(onChange: (event: ChangeEvent) => void): void {
  const handler = useRef(onChange);
  handler.current = onChange;
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const source = new EventSource(STREAM_URL);
    source.addEventListener('change', (e) => {
      const event = parseChange((e as MessageEvent<string>).data);
      if (event) handler.current(event);
    });
    return () => source.close();
  }, []);
}

/** Whether the live-update stream is actually connected right now (for the Status page). */
export function useStreamState(): 'connecting' | 'open' | 'closed' {
  const [state, setState] = useState<'connecting' | 'open' | 'closed'>('connecting');
  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      setState('closed');
      return;
    }
    const source = new EventSource(STREAM_URL);
    source.onopen = () => setState('open');
    source.onerror = () => setState(source.readyState === EventSource.CLOSED ? 'closed' : 'connecting');
    return () => source.close();
  }, []);
  return state;
}
