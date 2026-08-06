import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-surface px-6">
      <div className="max-w-sm text-center">
        <p className="text-sm font-medium text-accent-text">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Nothing here</h1>
        <p className="mt-2 text-sm leading-relaxed text-secondary">
          That page doesn&rsquo;t exist.
        </p>
        <Link
          href="/today"
          className="mt-6 inline-flex min-h-11 items-center rounded-md bg-surface-accent px-4 text-sm font-medium text-accent-text transition-colors hover:bg-forest-700"
        >
          Back to Today
        </Link>
      </div>
    </main>
  );
}
