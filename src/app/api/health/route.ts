import { NextResponse } from 'next/server';

import { environmentReadiness } from '@/lib/validation/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Liveness and readiness.
 *
 * Deliberately says as little as possible. It reports WHETHER configuration is
 * complete, never what it contains — no versions, no hostnames, no key
 * fragments, not even the names of missing variables in production, because an
 * unauthenticated caller learns something from those too.
 *
 * A degraded response is still HTTP 200: the process is alive, which is what a
 * liveness probe asks. Configuration problems surface in `status`.
 */
export function GET() {
  const readiness = environmentReadiness();
  const isProduction = process.env.NODE_ENV === 'production';

  return NextResponse.json(
    {
      status: readiness.ok ? 'ok' : 'degraded',
      service: 'mads-atlas',
      timestamp: new Date().toISOString(),
      // Outside production, name the missing variables — it saves a great deal
      // of time locally. In production, only the count.
      ...(readiness.ok
        ? {}
        : isProduction
          ? { configuration: { complete: false, missingCount: readiness.missing.length } }
          : { configuration: { complete: false, missing: readiness.missing } }),
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  );
}
