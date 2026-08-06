import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import { publicEnv, serverEnv } from '@/lib/validation/env';
import type { Database } from '@/types/database';

/**
 * Admin Supabase client. ⚠ BYPASSES ROW LEVEL SECURITY ENTIRELY.
 *
 * The `import 'server-only'` above is the real control: importing this module
 * from a client component is a BUILD ERROR, not a runtime surprise. That is
 * deliberate — a build failure here has caught a secret leak.
 *
 * Legitimate uses, and no others:
 *   • writing token columns in connected_accounts
 *   • appending to action_logs and tool_runs
 *   • scheduled maintenance run from server context
 *   • scripts/seed-owner.ts
 *
 * If you are reaching for this to "just make a query work", the real problem is
 * a missing or wrong RLS policy. Fix that instead.
 */
export function createAdminClient() {
  const pub = publicEnv();
  const env = serverEnv();

  return createSupabaseClient<Database>(pub.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      // No session persistence or refresh: this client is not a user.
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
