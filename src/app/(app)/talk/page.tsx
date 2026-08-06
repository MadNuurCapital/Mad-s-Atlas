import { Mic } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/ui/EmptyState';
import { Page } from '@/components/ui/Page';

export const metadata: Metadata = { title: 'Talk' };

export default function TalkPage() {
  return (
    <Page
      title="Talk"
      description="Speak with Atlas in realtime. Push-to-talk by default — the microphone is never live in the background."
    >
      <EmptyState
        icon={Mic}
        title="Voice arrives in Phase 5"
        description="Live transcript, interruption, tool activity, sources and a text fallback will appear here. The permanent Gemini key never reaches this page — sessions use a single-use ephemeral token."
      />
    </Page>
  );
}
