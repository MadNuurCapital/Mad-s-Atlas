import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Session refresh, and nothing else.
 *
 * Access control remains in `requireOwner()` plus Row Level Security. The proxy
 * only keeps the Supabase cookie current. `getClaims()` validates the JWT and,
 * with asymmetric signing keys, uses cached JWKS instead of requiring an Auth
 * server round-trip on every navigation.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;

  try {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    });

    await supabase.auth.getClaims();
  } catch {
    // A temporary Auth/JWKS outage must not crash Netlify's edge runtime.
    // Authorisation is still enforced by requireOwner() and database RLS.
  }
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
