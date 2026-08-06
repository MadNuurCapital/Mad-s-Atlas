import type { ReactNode } from 'react';

import { BottomNav } from '@/components/shell/BottomNav';
import { Sidebar } from '@/components/shell/Sidebar';
import { requireOwner } from '@/lib/auth/owner';

/**
 * Authenticated application shell.
 *
 * `requireOwner()` runs before anything renders, so an unauthenticated or
 * non-owner request never reaches a screen. This is server-side by design —
 * middleware only refreshes the session and is not a gate, and a client-side
 * redirect is decoration rather than protection. See SECURITY.md § T1.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireOwner();

  return (
    <div className="flex min-h-dvh bg-surface">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Bottom nav is fixed, so reserve room for it on small screens. */}
        <main className="flex-1 pb-20 lg:pb-0">{children}</main>
      </div>

      <BottomNav />
    </div>
  );
}
