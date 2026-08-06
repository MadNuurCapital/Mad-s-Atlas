import { Sparkles } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/ui/EmptyState';
import { Page } from '@/components/ui/Page';

export const metadata: Metadata = { title: 'Memory' };

export default function MemoryPage() {
  return (
    <Page
      title="Memory"
      description="What Atlas remembers, and what it has only suggested. Nothing becomes permanent without your confirmation."
    >
      <EmptyState
        icon={Sparkles}
        title="Nothing remembered yet"
        description="Confirmed memories appear here alongside suggestions awaiting review. You can search, edit, supersede, export or delete any of it at any time."
      />
    </Page>
  );
}
