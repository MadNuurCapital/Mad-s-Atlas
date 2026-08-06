import type { Metadata } from 'next';

import { SignInButton } from '@/features/auth/SignInButton';

export const metadata: Metadata = { title: 'Sign in' };

/** The only unauthenticated route. */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="grid min-h-dvh place-items-center bg-surface px-6">
      <div className="w-full max-w-sm text-center">
        <span
          aria-hidden
          className="mx-auto grid size-12 place-items-center rounded-xl bg-surface-accent text-lg font-semibold text-accent-text ring-1 ring-gold-500/25"
        >
          A
        </span>

        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Mad&rsquo;s Atlas</h1>
        <p className="mt-2 text-sm leading-relaxed text-secondary">
          A private personal AI. Access is limited to a single authorised account.
        </p>

        {error ? (
          <p
            role="alert"
            className="mt-6 rounded-md border border-line bg-surface-raised px-4 py-3 text-sm text-secondary"
          >
            {messageFor(error)}
          </p>
        ) : null}

        <div className="mt-8">
          <SignInButton />
        </div>

        <p className="mt-6 text-2xs leading-relaxed text-tertiary">
          Atlas asks for calendar and Gmail access so it can read your agenda and
          prepare drafts. It cannot send email.
        </p>
      </div>
    </main>
  );
}

/**
 * Every message is deliberately vague about *why* access was refused. Telling
 * a stranger that an address is "not the owner" confirms the application
 * exists and that some other address would work.
 */
function messageFor(code: string): string {
  switch (code) {
    case 'not-owner':
      return 'This application is private.';
    case 'declined':
      return 'Sign-in was cancelled.';
    case 'missing-code':
    case 'exchange-failed':
      return 'Sign-in could not be completed. Please try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
