'use client';

import { CalendarDays, CheckCircle2, Mail, RefreshCw, Unplug } from 'lucide-react';
import { useState } from 'react';

import { beginGoogleOAuth } from '@/features/auth/google-oauth';
import {
  GOOGLE_CALENDAR_SCOPES,
  GOOGLE_GMAIL_SCOPES,
  hasEveryScope,
} from '@/lib/google/scopes';
import type { ConnectionStatus } from '@/lib/data/settings';

export function GoogleConnectionPanel({ connection }: { connection: ConnectionStatus | null }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = connection?.connectionStatus === 'connected';
  const calendarReady = Boolean(connected && hasEveryScope(connection?.grantedScopes ?? [], GOOGLE_CALENDAR_SCOPES));
  const gmailReady = Boolean(connected && hasEveryScope(connection?.grantedScopes ?? [], GOOGLE_GMAIL_SCOPES));

  async function connect() {
    setPending(true);
    setError(null);
    try {
      const { error: oauthError } = await beginGoogleOAuth('/settings?google=connected');
      if (oauthError) throw oauthError;
    } catch {
      setError('Could not open Google authorization. Please try again.');
      setPending(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            {connected ? (
              <CheckCircle2 aria-hidden className="size-4 text-positive" />
            ) : (
              <Unplug aria-hidden className="size-4 text-caution" />
            )}
            <p className="text-sm font-medium text-primary">
              {connected ? 'Google account connected' : connection ? 'Google needs reconnecting' : 'Google is not connected'}
            </p>
          </div>
          {connection?.email ? <p className="mt-1 text-xs text-tertiary">{connection.email}</p> : null}
        </div>

        <button
          type="button"
          onClick={connect}
          disabled={pending}
          className="flex min-h-11 items-center gap-2 rounded-md bg-surface-accent px-4 text-sm font-medium text-accent-text transition-colors hover:bg-forest-700 disabled:opacity-60"
        >
          <RefreshCw aria-hidden className={`size-4 ${pending ? 'animate-spin' : ''}`} />
          {pending ? 'Opening Google…' : connection ? 'Reconnect Google' : 'Connect Google'}
        </button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Capability
          icon={CalendarDays}
          title="Google Calendar"
          ready={calendarReady}
          description="Read your agenda and create events directly when you ask Atlas."
        />
        <Capability
          icon={Mail}
          title="Gmail"
          ready={gmailReady}
          description="Search metadata and snippets; Atlas can draft after approval, never send."
        />
      </div>

      {connected && (!calendarReady || !gmailReady) ? (
        <p className="mt-4 rounded-md bg-accent-muted px-3 py-2.5 text-sm leading-relaxed text-secondary">
          The account exists, but its granted permissions are incomplete or were not recorded by an older sign-in. Reconnect once and approve Calendar and Gmail access.
        </p>
      ) : null}

      {!connected && connection ? (
        <p className="mt-4 rounded-md bg-accent-muted px-3 py-2.5 text-sm leading-relaxed text-secondary">
          If reconnection is needed roughly every seven days, publish the Google OAuth consent screen to Production instead of Testing.
        </p>
      ) : null}

      {error ? <p role="alert" className="mt-3 text-sm text-critical">{error}</p> : null}
    </div>
  );
}

function Capability({
  icon: Icon,
  title,
  ready,
  description,
}: {
  icon: typeof CalendarDays;
  title: string;
  ready: boolean;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-line-subtle bg-surface-inset/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-medium text-primary">
          <Icon aria-hidden className="size-4 text-accent-text" />
          {title}
        </span>
        <span className={ready ? 'text-2xs font-medium text-positive' : 'text-2xs font-medium text-caution'}>
          {ready ? 'Ready' : 'Permission needed'}
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-tertiary">{description}</p>
    </div>
  );
}
