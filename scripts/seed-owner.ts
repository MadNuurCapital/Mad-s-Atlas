/**
 * Seed the owner allowlist.
 *
 *   npx tsx scripts/seed-owner.ts
 *
 * This is what makes the application Muhammad's and nobody else's. Safe to run
 * repeatedly: it upserts and re-enables, so it also serves as the recovery
 * path if the row is ever disabled.
 *
 * It never prints the secret key, and never prints the full email address.
 */

import { createClient } from '@supabase/supabase-js';

function fail(message: string): never {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

/** owner@example.com -> o***r@example.com */
function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  if (local.length <= 2) return `${local[0] ?? '*'}***@${domain}`;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const ownerEmail = process.env.ATLAS_OWNER_EMAIL?.trim();

  if (!url) fail('NEXT_PUBLIC_SUPABASE_URL is not set.');
  if (!secretKey) fail('SUPABASE_SECRET_KEY is not set.');
  if (!ownerEmail) fail('ATLAS_OWNER_EMAIL is not set.');
  if (!ownerEmail.includes('@')) fail('ATLAS_OWNER_EMAIL does not look like an email address.');

  const supabase = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await supabase
    .schema('private')
    .from('allowed_users')
    .upsert({ email: ownerEmail, enabled: true }, { onConflict: 'email' });

  if (error) {
    // Print the code, never the payload — the payload contains the address.
    fail(`Could not update the allowlist (${error.code ?? 'unknown'}): ${error.message}`);
  }

  console.log(`\n  ✓ Owner allowlist updated: ${maskEmail(ownerEmail)} (enabled)\n`);
  console.log('  Next: enable the Before User Created hook so the allowlist is');
  console.log('  actually enforced — Dashboard → Authentication → Hooks →');
  console.log('  Before User Created → private.check_user_allowed');
  console.log('  See SUPABASE_SETUP.md § 10.\n');
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : 'Unexpected failure.');
});
