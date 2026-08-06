import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Session refresh, and NOTHING ELSE.
 *
 * This middleware keeps the Supabase session cookie fresh so server components
 * see a valid session. It is explicitly **not** the access control: it does
 * not decide who may see what, and no security decision depends on it running.
 *
 * Real protection is `requireOwner()` inside each protected server component
 * and route handler, plus Row Level Security in the database. Middleware can be
 * bypassed by anything addressing a route handler directly, so treating it as
 * a gate would be a mistake — see SECURITY.md § T1.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // Unconfigured: pass through. The pages themselves fail closed.
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Touching getUser() is what triggers the refresh. The result is
  // deliberately unused here — this middleware makes no decisions.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image optimisation. Auth routes are
     * included so the cookie is refreshed on the callback too.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
