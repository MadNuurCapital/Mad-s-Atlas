import type { ReactNode } from 'react';

import { BottomNav } from '@/components/shell/BottomNav';
import { Sidebar } from '@/components/shell/Sidebar';

/**
 * Authenticated application shell.
 *
 * PHASE 2 adds the owner guard here — `requireOwner()` runs before anything
 * renders, so an unauthenticated or non-owner request never reaches a screen.
 * Route protection is server-side by design; middleware is a convenience
 * redirect only. See SECURITY.md § T1.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
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
