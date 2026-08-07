import { CalendarDays, ExternalLink } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/ui/EmptyState';
import { Card, Page, Section } from '@/components/ui/Page';
import { requireOwner } from '@/lib/auth/owner';
import { getConnectionStatus, getProfile } from '@/lib/data/settings';
import { listEvents } from '@/lib/google/calendar';
import { ATLAS_DEFAULT_TIMEZONE, formatDateTime } from '@/lib/time';

export const metadata: Metadata = { title: 'Calendar' };
export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const { user } = await requireOwner();
  const [connection, profile] = await Promise.all([getConnectionStatus(), getProfile()]);
  const connected = connection?.connectionStatus === 'connected';

  if (!connected) {
    return (
      <Page title="Calendar" description="Your live Google agenda and proposed changes.">
        <ConnectionEmpty
          title={connection ? 'Google Calendar needs reconnecting' : 'Connect Google Calendar'}
          description="Connect Google in Settings to see your agenda. Reads happen automatically; creating an event always waits for your approval."
        />
      </Page>
    );
  }

  const timeZone = profile?.timezone ?? ATLAS_DEFAULT_TIMEZONE;
  const start = new Date();
  const end = new Date(start.getTime() + 7 * 86_400_000);
  const result = await listEvents(user.id, start, end, timeZone);

  if (!result.ok) {
    return (
      <Page title="Calendar" description="Your live Google agenda and proposed changes.">
        <ConnectionEmpty title="Calendar access needs attention" description={result.message} />
      </Page>
    );
  }

  return (
    <Page
      title="Calendar"
      description={`The next seven days from Google Calendar, shown in ${timeZone}. Every write still requires approval.`}
      actions={<SettingsLink />}
    >
      <Section title="Upcoming">
        {result.data.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="Your next seven days are clear"
            description="Google Calendar is connected and returned no upcoming events in this window."
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {result.data.map((event) => (
              <Card as="li" key={event.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-primary">{event.summary}</p>
                    <p className="mt-1 text-xs text-secondary">
                      {event.allDay ? event.start : formatDateTime(new Date(event.start), timeZone)}
                    </p>
                  </div>
                  {event.htmlLink ? (
                    <a
                      href={event.htmlLink}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open ${event.summary} in Google Calendar`}
                      className="grid size-9 shrink-0 place-items-center rounded-full border border-line-subtle text-tertiary transition-colors hover:text-primary"
                    >
                      <ExternalLink aria-hidden className="size-4" />
                    </a>
                  ) : null}
                </div>
                {event.location ? <p className="mt-3 text-2xs text-tertiary">{event.location}</p> : null}
              </Card>
            ))}
          </ul>
        )}
      </Section>
    </Page>
  );
}

function ConnectionEmpty({ title, description }: { title: string; description: string }) {
  return <EmptyState icon={CalendarDays} title={title} description={description} action={<SettingsLink />} />;
}

function SettingsLink() {
  return (
    <Link href="/settings" className="inline-flex min-h-11 items-center rounded-md border border-line px-4 text-sm text-secondary transition-colors hover:text-primary">
      Manage Google access
    </Link>
  );
}
