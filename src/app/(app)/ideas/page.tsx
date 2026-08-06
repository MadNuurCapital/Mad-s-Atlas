import { Lightbulb } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/ui/EmptyState';
import { Page } from '@/components/ui/Page';

export const metadata: Metadata = { title: 'Ideas' };

export default function IdeasPage() {
  return (
    <Page
      title="Ideas"
      description="Captured, exploring, planned, building, completed and parked."
    >
      <EmptyState
        icon={Lightbulb}
        title="No ideas captured"
        description="Capture a thought verbatim and Atlas can turn it into a structured plan — or a Claude Code brief you can hand straight to an implementation session."
      />
    </Page>
  );
}
