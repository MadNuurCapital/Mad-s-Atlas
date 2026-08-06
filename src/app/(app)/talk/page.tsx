import type { Metadata } from 'next';

import { Page, Section } from '@/components/ui/Page';
import { VoicePanel } from '@/features/voice/VoicePanel';

export const metadata: Metadata = { title: 'Talk' };
export const dynamic = 'force-dynamic';

export default function TalkPage() {
  return (
    <Page
      title="Talk"
      description="Speak with Atlas in realtime. Push-to-talk by default — the microphone is never live in the background."
    >
      <Section title="Voice">
        <VoicePanel />
      </Section>

      <Section
        title="How this stays private"
        description="The permanent Gemini key never reaches this page. Each session uses a single-use token that is locked to one model and expires in minutes."
      >
        <ul className="space-y-2 text-sm leading-relaxed text-secondary">
          <li>· Audio goes straight from your browser to Gemini and is never stored.</li>
          <li>· A tool call from voice takes the same approval path as one from text.</li>
          <li>· The voice session cannot execute anything itself — it proposes, the server decides.</li>
        </ul>
      </Section>
    </Page>
  );
}
