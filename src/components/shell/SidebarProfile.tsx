import { ChevronRight } from 'lucide-react';

import { getProfile } from '@/lib/data/settings';

export function SidebarProfileFallback() {
  return <SidebarProfileIdentity preferredName="Mad" muted />;
}

export async function SidebarProfile() {
  const profile = await getProfile();
  return <SidebarProfileIdentity preferredName={profile?.preferred_name ?? 'Mad'} />;
}

function SidebarProfileIdentity({
  preferredName,
  muted = false,
}: {
  preferredName: string;
  muted?: boolean;
}) {
  return (
    <div
      className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2 text-left"
      aria-label={`${preferredName}'s profile`}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full border border-accent/25 bg-gradient-to-br from-gold-300/30 to-forest-700 text-sm font-medium text-primary">
        {preferredName.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className={muted ? 'block truncate text-sm text-secondary' : 'block truncate text-sm font-medium text-primary'}>
          {preferredName}
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-[0.68rem] text-tertiary">
          <span aria-hidden className="size-1.5 rounded-full bg-positive" /> Atlas owner
        </span>
      </span>
      <ChevronRight aria-hidden className="size-4 text-tertiary" />
    </div>
  );
}
