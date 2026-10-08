import { useCallback, useEffect, useRef, useState } from 'react';

export interface PollState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  syncedAt: Date | null;
  reload: () => void;
}

/**
 * Loads data and refreshes it on an interval. A failed refresh keeps the last good
 * data on screen and shows the error, so a brief outage never blanks the page.
 */
export function usePoll<T>(load: () => Promise<T>, intervalMs = 5000): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const loader = useRef(load);
  loader.current = load;

  const run = useCallback(() => {
    loader
      .current()
      .then((next) => {
        setData(next);
        setError(null);
        setSyncedAt(new Date());
      })
      .catch((err: unknown) => setError(err instanceof TypeError ? 'Could not reach the AgroSense server.' : err instanceof Error ? err.message : 'Something went wrong.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    run();
    const timer = window.setInterval(run, intervalMs);
    return () => window.clearInterval(timer);
  }, [run, intervalMs]);

  return { data, error, loading, syncedAt, reload: run };
}
