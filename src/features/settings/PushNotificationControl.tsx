'use client';

import { Bell, BellOff } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore, useTransition } from 'react';

function decodeVapidKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function PushNotificationControl({ vapidPublicKey }: { vapidPublicKey: string }) {
  const supported = useSyncExternalStore(
    () => () => {},
    () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
    () => false,
  );
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!supported) return;

    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setEnabled(Boolean(subscription)))
      .catch(() => setMessage('Atlas could not inspect notifications on this device.'));
  }, [supported]);

  const enable = () => startTransition(async () => {
    setMessage(null);
    if (!vapidPublicKey) {
      setMessage('Add NEXT_PUBLIC_VAPID_PUBLIC_KEY in Netlify before enabling notifications.');
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setMessage('Notification permission was not granted. You can change it in browser settings.');
      return;
    }

    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(vapidPublicKey),
        }));
      const json = subscription.toJSON();
      const response = await fetch('/api/push/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint, keys: json.keys }),
      });
      if (!response.ok) throw new Error('save_failed');
      setEnabled(true);
      setMessage('Atlas notifications are active on this device.');
    } catch {
      setMessage('Atlas could not enable notifications on this device. Try again after refreshing.');
    }
  });

  const disable = () => startTransition(async () => {
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const response = await fetch('/api/push/subscription', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        if (!response.ok) throw new Error('remove_failed');
        await subscription.unsubscribe();
      }
      setEnabled(false);
      setMessage('Notifications are off on this device.');
    } catch {
      setMessage('Atlas could not disable this device. Try again after refreshing.');
    }
  });

  return (
    <div className="flex flex-col gap-3 py-1 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium text-primary">Plan notifications</p>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-tertiary">
          Upcoming, execute and one missed-session check. On iPhone, install Atlas to the Home Screen first.
        </p>
        {message ? <p className="mt-2 text-xs text-secondary" role="status">{message}</p> : null}
      </div>
      <button
        type="button"
        disabled={!supported || pending}
        onClick={enabled ? disable : enable}
        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-line bg-surface-raised px-4 text-sm font-medium text-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {enabled ? <BellOff aria-hidden className="size-4" /> : <Bell aria-hidden className="size-4" />}
        {!supported ? 'Not supported' : pending ? 'Saving…' : enabled ? 'Turn off' : 'Enable'}
      </button>
    </div>
  );
}
