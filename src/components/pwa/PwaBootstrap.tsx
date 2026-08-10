'use client';

import { useEffect } from 'react';

export function PwaBootstrap() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // Push delivery was retired. Remove only Atlas's legacy worker; do not
    // disturb another application that may share the same browser origin.
    void navigator.serviceWorker.getRegistrations().then(async (registrations) => {
      const atlasWorkers = registrations.filter((registration) => {
        const script = registration.active?.scriptURL
          ?? registration.waiting?.scriptURL
          ?? registration.installing?.scriptURL;
        return script ? new URL(script).pathname === '/sw.js' : false;
      });
      await Promise.all(atlasWorkers.map((registration) => registration.unregister()));
    }).catch(() => undefined);
  }, []);

  return null;
}
