import { Inbox } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/ui/EmptyState';
import { Page } from '@/components/ui/Page';

export const metadata: Metadata = { title: 'Inbox' };

export default function InboxPage() {
  return (
    <Page
      title="Inbox"
      description="Important and action-required email, searched and summarised. Atlas can prepare a draft — it can never send one."
    >
      <EmptyState
        icon={Inbox}
        title="Gmail is not connected"
        description="Connect Google in Settings to search and summarise your mail. Full message bodies are never stored, and email sending is not implemented at all."
      />
    </Page>
  );
}
