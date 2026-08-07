import { XCircle } from 'lucide-react';
import type { Metadata } from 'next';

import { Card, Page, Section } from '@/components/ui/Page';
import { GoogleConnectionPanel } from '@/features/settings/GoogleConnectionPanel';
import {
  setDailyBriefingEnabled,
  setMemoryEnabled,
} from '@/features/settings/actions';
import { SettingsToggle } from '@/features/settings/SettingsToggle';
import { requireOwner } from '@/lib/auth/owner';
import { listActionLogs } from '@/lib/data/action-log';
import { getLatestBriefing } from '@/lib/data/briefings';
import {
  getConnectionStatus,
  getProfile,
  getSettings,
  getStoredDataSummary,
} from '@/lib/data/settings';
import { formatRelative } from '@/lib/time';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line-subtle py-2.5 last:border-0">
      <span className="text-sm text-secondary">{label}</span>
      <span className="text-right text-sm font-medium text-primary">{value}</span>
    </div>
  );
}

export default async function SettingsPage() {
  const session = await requireOwner();

  const [profile, settings, connection, stored, recentAccess, latestBriefing] = await Promise.all([
    getProfile(),
    getSettings(),
    getConnectionStatus(),
    getStoredDataSummary(),
    listActionLogs({ limit: 8 }),
    getLatestBriefing(),
  ]);

  return (
    <Page title="Settings" description="Profile, connections, privacy and data controls.">
      {/* Google first: a broken connection is the most likely reason to open
          this screen, and it breaks scheduled work silently. */}
      <Section title="Google connection">
        <Card>
          <GoogleConnectionPanel connection={connection} />
          {connection?.lastRefreshedAt ? (
            <p className="mt-4 text-2xs text-tertiary">
              Last renewed {formatRelative(new Date(connection.lastRefreshedAt))}
            </p>
          ) : null}
        </Card>
      </Section>

      <Section title="Profile">
        <Card>
          <Row label="Signed in as" value={session.email} />
          <Row label="Preferred name" value={profile?.preferred_name ?? 'not set'} />
          <Row label="Timezone" value={profile?.timezone ?? 'Asia/Singapore'} />
        </Card>
      </Section>

      <Section
        title="Atlas intelligence"
        description="Control what Atlas prepares proactively and what it remembers between conversations."
      >
        <Card>
          <SettingsToggle
            label="Daily briefing"
            description={`Prepare your agenda, priorities and pending items every morning at ${(profile?.briefing_time ?? '09:00').slice(0, 5)} Singapore time.`}
            enabled={Boolean(
              profile?.briefing_enabled && settings?.proactive_briefings_enabled,
            )}
            action={setDailyBriefingEnabled}
          />
          <SettingsToggle
            label="Memory"
            description="Let Atlas retrieve confirmed memories and automatically remember stable facts, goals, decisions, commitments, projects and plans you agree on together."
            enabled={Boolean(settings?.memory_enabled)}
            action={setMemoryEnabled}
          />
          <Row
            label="Latest generated briefing"
            value={
              latestBriefing?.generated_at
                ? formatRelative(new Date(latestBriefing.generated_at))
                : 'Not generated yet'
            }
          />
        </Card>
      </Section>

      <Section
        title="Privacy"
        description="Everything Atlas holds about you, counted live from the database."
      >
        <Card>
          {stored.map((item) => (
            <Row key={item.label} label={`${item.label} — ${item.count}`} value={item.retention} />
          ))}
        </Card>

        <p className="mt-3 text-2xs leading-relaxed text-tertiary">
          Audio and email bodies read zero because no code path writes them — not because
          something cleans them up afterwards.
        </p>
      </Section>

      <Section
        title="Recent data access"
        description="The last few things Atlas did on your behalf."
      >
        <Card>
          {recentAccess.length === 0 ? (
            <p className="text-sm text-tertiary">Nothing recorded yet.</p>
          ) : (
            recentAccess.map((entry) => (
              <Row
                key={entry.id}
                label={entry.action_summary}
                value={formatRelative(new Date(entry.created_at))}
              />
            ))
          )}
        </Card>
      </Section>

      <Section title="Memory and retention">
        <Card>
          <Row
            label="Conversation retention"
            value={`${settings?.conversation_retention_days ?? 30} days`}
          />
          <Row label="Approval expiry" value={`${settings?.approval_expiry_minutes ?? 60} minutes`} />
          <Row
            label="Meeting preparation"
            value={`${settings?.meeting_prep_lead_minutes ?? 30} minutes before`}
          />
          <Row
            label="Browser notifications"
            value={settings?.notification_enabled ? 'Enabled' : 'Off — permission not granted'}
          />
        </Card>
      </Section>

      <Section title="What Atlas will never do" description="Not settings. Absent capabilities.">
        <Card>
          <ul className="space-y-2 text-sm leading-relaxed text-secondary">
            {[
              'Send an email — the code does not exist and the permission is not requested',
              'Delete a Gmail message',
              'Make a payment, purchase or investment',
              'Publish anything publicly',
              'Connect to Atlas DART, Academy or Investments',
              'Listen in the background or store audio',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <XCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-tertiary" />
                {item}
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      <Section title="Your data">
        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <p className="text-sm font-medium text-primary">Export everything</p>
            <p className="mt-1.5 text-sm leading-relaxed text-tertiary">
              One file with every memory, task, reminder, idea, approval and log entry. Tokens and
              push credentials are excluded by construction — they are never selected.
            </p>
          </Card>

          <Card>
            <p className="text-sm font-medium text-critical">Delete all Atlas data</p>
            <p className="mt-1.5 text-sm leading-relaxed text-tertiary">
              Removes every record in a single transaction. Irreversible. Revoke Google separately
              at myaccount.google.com/permissions — only Google can clear their side.
            </p>
          </Card>
        </div>
      </Section>
    </Page>
  );
}
