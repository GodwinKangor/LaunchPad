'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from './api-client';

export interface PollState<T> {
  data: T | null;
  error: ApiError | null;
  /** True until the first response (or error) arrives. */
  loading: boolean;
  refresh: () => Promise<void>;
}

/** Polls a JSON endpoint. Pauses while the tab is hidden and refreshes when it becomes visible again. */
export function usePoll<T>(path: string, intervalMs: number): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'error', 'Unexpected error.'));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, intervalMs]);

  return { data, error, loading, refresh };
}

/** Re-renders on an interval so relative timestamps stay fresh. */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
