import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Sign in' };

/**
 * The only unauthenticated route.
 *
 * PHASE 2 wires the Google OAuth button. The copy is deliberate: this is a
 * private application, and a stranger who lands here should understand
 * immediately that there is no account for them to create.
 */
export default function SignInPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-surface px-6">
      <div className="w-full max-w-sm text-center">
        <span
          aria-hidden
          className="mx-auto grid size-12 place-items-center rounded-xl bg-surface-accent text-lg font-semibold text-accent-text"
        >
          A
        </span>

        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Mad&rsquo;s Atlas</h1>
        <p className="mt-2 text-sm leading-relaxed text-secondary">
          A private personal AI. Access is limited to a single authorised account.
        </p>

        <div className="mt-8 rounded-lg border border-dashed border-line bg-surface-raised/40 px-5 py-8">
          <p className="text-sm text-tertiary">
            Google sign-in is wired up in Phase 2.
          </p>
        </div>

        <p className="mt-6 text-2xs leading-relaxed text-tertiary">
          Sign-in requests from any other account are rejected before an account is created.
        </p>
      </div>
    </main>
  );
}
