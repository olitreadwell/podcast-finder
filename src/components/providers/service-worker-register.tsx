'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker in production only. Dev and e2e stay
 * unregistered so hot reload and test runs never serve stale assets.
 *
 * @returns null
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Registration failure is non-fatal: the app works without a worker.
    });
  }, []);

  return null;
}
