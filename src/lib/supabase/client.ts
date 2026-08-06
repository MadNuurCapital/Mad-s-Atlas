'use client';

import { createBrowserClient } from '@supabase/ssr';

import { publicEnv } from '@/lib/validation/env';
import type { Database } from '@/types/database';

/**
 * Browser Supabase client.
 *
 * Uses the publishable key, which carries no privileges beyond what Row Level
 * Security allows. Every query from here is subject to RLS — that is the point.
 */
export function createClient() {
  const env = publicEnv();

  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
