import { useEffect } from 'react';

export const REFRESH_INTERVAL_MS = 30_000;

/** Calls `load` once on mount and then every 30 s; plain polling, cleared on unmount. */
export function useAutoRefresh(load: () => Promise<void>): void {
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void load();
    }, REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [load]);
}
