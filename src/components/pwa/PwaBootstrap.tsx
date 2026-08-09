'use client';

import { useEffect } from 'react';

export function PwaBootstrap() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // Settings shows actionable errors when the owner explicitly enables
      // notifications. Background registration stays intentionally quiet.
    });
  }, []);

  return null;
}
