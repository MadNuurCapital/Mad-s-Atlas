import type { Metadata } from 'next';

import { Card, Page, Section } from '@/components/ui/Page';

export const metadata: Metadata = { title: 'Settings' };

const GROUPS = [
  { name: 'Profile', detail: 'Name, timezone and how Atlas addresses you.' },
  { name: 'Google connection', detail: 'Connected account, granted scopes and reconnection.' },
  { name: 'Gemini configuration', detail: 'Which models are configured and reachable.' },
  { name: 'Voice', detail: 'Default voice, push-to-talk and hands-free.' },
  { name: 'Privacy', detail: 'What is stored, for how long, and who can see it.' },
  { name: 'Memory', detail: 'Enable memory, review suggestions, set retention.' },
  { name: 'Notifications', detail: 'Browser push, off until you grant permission.' },
  { name: 'Briefing', detail: 'Daily briefing time and whether it runs at all.' },
  { name: 'Meeting preparation', detail: 'How long before an event Atlas prepares you.' },
  { name: 'Data retention', detail: 'Conversation and log retention windows.' },
  { name: 'Export', detail: 'Download everything Atlas holds about you.' },
  { name: 'Delete all data', detail: 'Remove every trace. Irreversible.' },
];

export default function SettingsPage() {
  return (
    <Page
      title="Settings"
      description="Profile, connections, privacy and data controls."
    >
      <Section>
        <ul className="grid gap-3 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <Card as="li" key={group.name}>
              <p className="text-sm font-medium text-primary">{group.name}</p>
              <p className="mt-1 text-sm leading-relaxed text-tertiary">{group.detail}</p>
            </Card>
          ))}
        </ul>
      </Section>
    </Page>
  );
}
