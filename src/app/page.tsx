import { redirect } from 'next/navigation';

/**
 * Root has no content of its own.
 *
 * Phase 2 replaces this with a session check that sends signed-out visitors to
 * /sign-in instead. For now every visit lands on Today.
 */
export default function RootPage() {
  redirect('/today');
}
