import { Inbox, MailOpen } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/ui/EmptyState';
import { Card, Page, Section } from '@/components/ui/Page';
import { requireOwner } from '@/lib/auth/owner';
import { getConnectionStatus } from '@/lib/data/settings';
import { searchMessages } from '@/lib/google/gmail';

export const metadata: Metadata = { title: 'Inbox' };
export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const { user } = await requireOwner();
  const connection = await getConnectionStatus();
  const connected = connection?.connectionStatus === 'connected';

  if (!connected) {
    return (
      <Page title="Inbox" description="Important email metadata and short snippets—never stored message bodies.">
        <ConnectionEmpty
          title={connection ? 'Gmail needs reconnecting' : 'Connect Gmail'}
          description="Connect Google in Settings to search your mail. Atlas can prepare a draft after approval, but sending email is not implemented."
        />
      </Page>
    );
  }

  const result = await searchMessages(user.id, 'is:unread newer_than:14d', 10);
  if (!result.ok) {
    return (
      <Page title="Inbox" description="Important email metadata and short snippets—never stored message bodies.">
        <ConnectionEmpty title="Gmail access needs attention" description={result.message} />
      </Page>
    );
  }

  return (
    <Page
      title="Inbox"
      description="Unread mail from the last 14 days. Atlas receives metadata and bounded snippets, never full bodies."
      actions={<SettingsLink />}
    >
      <Section title="Unread">
        {result.data.length === 0 ? (
          <EmptyState icon={MailOpen} title="No recent unread mail" description="Gmail is connected and returned no unread messages from the last 14 days." />
        ) : (
          <ul className="space-y-3">
            {result.data.map((message) => (
              <Card as="li" key={message.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-primary">{message.subject || '(no subject)'}</p>
                    <p className="mt-1 truncate text-xs text-secondary">{message.from}</p>
                  </div>
                  <span className="text-2xs text-tertiary">{message.date}</span>
                </div>
                {message.snippet ? <p className="mt-3 text-sm leading-relaxed text-tertiary">{message.snippet}</p> : null}
              </Card>
            ))}
          </ul>
        )}
      </Section>
    </Page>
  );
}

function ConnectionEmpty({ title, description }: { title: string; description: string }) {
  return <EmptyState icon={Inbox} title={title} description={description} action={<SettingsLink />} />;
}

function SettingsLink() {
  return (
    <Link href="/settings" className="inline-flex min-h-11 items-center rounded-md border border-line px-4 text-sm text-secondary transition-colors hover:text-primary">
      Manage Google access
    </Link>
  );
}
