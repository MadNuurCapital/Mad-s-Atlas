import { Suspense, type ReactNode } from 'react';

import { BottomNav } from '@/components/shell/BottomNav';
import { PwaBootstrap } from '@/components/pwa/PwaBootstrap';
import { Sidebar } from '@/components/shell/Sidebar';
import { SidebarProfile, SidebarProfileFallback } from '@/components/shell/SidebarProfile';
import { requireOwner } from '@/lib/auth/owner';

/**
 * Authenticated application shell.
 *
 * `requireOwner()` runs before anything renders, so an unauthenticated or
 * non-owner request never reaches a screen. This is server-side by design —
 * the request proxy only refreshes the session and is not a gate, and a client-side
 * redirect is decoration rather than protection. See SECURITY.md § T1.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireOwner();

  return (
    <div className="atlas-safe-inline atlas-safe-top flex min-h-dvh bg-transparent">
      <PwaBootstrap />
      <Sidebar
        profile={
          <Suspense fallback={<SidebarProfileFallback />}>
            <SidebarProfile />
          </Suspense>
        }
      />

      <div className="relative flex min-w-0 flex-1 flex-col overflow-x-clip">
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 right-0 h-[34rem] w-[44rem] max-w-full bg-[radial-gradient(circle_at_top_right,rgb(39_107_78/0.14),transparent_64%)]"
        />
        {/* Bottom nav is fixed, so reserve room for it on small screens. */}
        <main className="relative flex-1 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-0">
          {children}
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
