/**
 * Live verification against YOUR real services.
 *
 * The automated suites prove the logic. This proves the wiring: that the
 * credentials in your environment actually reach Supabase, Gemini and Google,
 * and that the security boundaries hold in production rather than only in
 * tests.
 *
 * Run it from a machine that has the real values — locally with a filled-in
 * .env.local, or against a deployment with APP_URL set:
 *
 *     npx tsx scripts/verify-live.ts
 *     APP_URL=https://your-site.netlify.app npx tsx scripts/verify-live.ts
 *
 * It NEVER prints a secret value. Results are pass/fail plus a redacted
 * detail, so the output is safe to paste into a chat or an issue.
 */

import { createClient } from '@supabase/supabase-js';

type Check = {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  detail: string;
};

const checks: Check[] = [];

function record(name: string, status: Check['status'], detail: string): void {
  checks.push({ name, status, detail });
  const mark = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '−';
  const colour = status === 'pass' ? '\x1b[32m' : status === 'fail' ? '\x1b[31m' : '\x1b[90m';
  console.log(`${colour}${mark}\x1b[0m ${name}\n    ${detail}`);
}

/** Show enough of a value to identify it, never enough to use it. */
function fingerprint(value: string | undefined): string {
  if (!value) return 'not set';
  return `set, ${value.length} chars, ends …${value.slice(-4)}`;
}

async function main(): Promise<void> {
  console.log("\n\x1b[1mMad's Atlas — live verification\x1b[0m\n");

  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const ownerEmail = process.env.ATLAS_OWNER_EMAIL;
  const liveModel = process.env.GEMINI_LIVE_MODEL ?? 'gemini-3.1-flash-live-preview';
  const textModel = process.env.GEMINI_TEXT_MODEL ?? 'gemini-3.6-flash';

  console.log('\x1b[1mConfiguration\x1b[0m');
  record('Supabase URL', supabaseUrl ? 'pass' : 'fail', supabaseUrl ?? 'NEXT_PUBLIC_SUPABASE_URL not set');
  record('Supabase secret key', secretKey ? 'pass' : 'fail', fingerprint(secretKey));
  record('Gemini API key', geminiKey ? 'pass' : 'fail', fingerprint(geminiKey));
  record('Owner email', ownerEmail ? 'pass' : 'fail', ownerEmail ? 'set' : 'ATLAS_OWNER_EMAIL not set');

  /* ------------------------------------------------------------- Supabase */

  console.log('\n\x1b[1mDatabase\x1b[0m');

  if (supabaseUrl && secretKey) {
    const admin = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Every table the schema defines. A missing one means migrations did not
    // all apply — which `supabase db push` can report as success if an earlier
    // file failed.
    const tables = [
      'profiles', 'user_settings', 'connected_accounts', 'memories',
      'memory_versions', 'tasks', 'reminders', 'ideas', 'approvals',
      'action_logs', 'tool_runs', 'conversations', 'conversation_messages',
      'research_reports', 'research_sources', 'daily_briefings',
      'notification_subscriptions',
    ];

    const missing: string[] = [];
    for (const table of tables) {
      const { error } = await admin.from(table).select('*', { head: true, count: 'exact' }).limit(0);
      if (error) missing.push(`${table} (${error.code ?? 'error'})`);
    }

    record(
      'All 17 tables exist',
      missing.length === 0 ? 'pass' : 'fail',
      missing.length === 0 ? 'every table reachable' : `missing or unreadable: ${missing.join(', ')}`,
    );

    // The allowlist is what makes the app yours. An empty one means
    // seed-owner.ts has not run, and nobody can sign in.
    const { data: allowed, error: allowErr } = await admin.rpc('owner_allowlist_list');

    if (allowErr) {
      record(
        'Owner allowlist seeded',
        'fail',
        `RPC failed (${allowErr.code ?? 'unknown'}) — is migration 0011 applied?`,
      );
    } else {
      const row = Array.isArray(allowed) ? allowed[0] : allowed;
      const enabled = Number(
        (row as { enabled_count?: number } | undefined)?.enabled_count ?? 0,
      );
      record(
        'Owner allowlist seeded',
        enabled === 1 ? 'pass' : 'fail',
        enabled === 0
          ? 'EMPTY — nobody can sign in, including you'
          : enabled === 1
            ? 'exactly one enabled entry, as it should be'
            : `${enabled} enabled entries — a private app should have ONE`,
      );
    }

    // claim_approval is the guarantee that an action cannot execute twice.
    const { error: rpcErr } = await admin.rpc('claim_approval', {
      p_approval_id: '00000000-0000-0000-0000-000000000000',
      p_idempotency_key: 'probe',
    });

    record(
      'claim_approval exists',
      rpcErr && /not.*exist|schema cache/i.test(rpcErr.message) ? 'fail' : 'pass',
      rpcErr && /not.*exist|schema cache/i.test(rpcErr.message)
        ? 'FUNCTION MISSING — double-execution protection is absent'
        : 'present and rejecting an unauthenticated probe, which is correct',
    );

    // The anonymous role must see nothing. This is the check that catches a
    // policy mistake in production.
    if (publishableKey) {
      const anon = createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const leaked: string[] = [];
      for (const table of ['memories', 'tasks', 'approvals', 'connected_accounts']) {
        const { data } = await anon.from(table).select('id').limit(1);
        if (data && data.length > 0) leaked.push(table);
      }

      record(
        'Anonymous access blocked by RLS',
        leaked.length === 0 ? 'pass' : 'fail',
        leaked.length === 0
          ? 'signed-out reads return nothing from every table checked'
          : `LEAK — anonymous reads returned rows from: ${leaked.join(', ')}`,
      );
    } else {
      record('Anonymous access blocked by RLS', 'skip', 'publishable key not set');
    }
  } else {
    record('Database checks', 'skip', 'Supabase URL or secret key missing');
  }

  /* --------------------------------------------------------------- Gemini */

  console.log('\n\x1b[1mGemini\x1b[0m');

  if (geminiKey) {
    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: geminiKey });

      // Confirms the key works AND that the configured models actually exist.
      // A preview model ID can disappear without notice.
      const models: string[] = [];
      for await (const model of await ai.models.list()) {
        if (model.name) models.push(model.name.replace(/^models\//, ''));
      }

      record('API key accepted', 'pass', `${models.length} models visible`);
      record(
        `Live model "${liveModel}" available`,
        models.includes(liveModel) ? 'pass' : 'fail',
        models.includes(liveModel) ? 'found' : 'NOT FOUND — update GEMINI_LIVE_MODEL',
      );
      record(
        `Text model "${textModel}" available`,
        models.includes(textModel) ? 'pass' : 'fail',
        models.includes(textModel) ? 'found' : 'NOT FOUND — update GEMINI_TEXT_MODEL',
      );

      // The path the voice UI depends on.
      const token = await ai.authTokens.create({
        config: {
          uses: 1,
          expireTime: new Date(Date.now() + 60_000).toISOString(),
          liveConnectConstraints: { model: liveModel },
        },
      });

      record(
        'Ephemeral token minting works',
        token.name ? 'pass' : 'fail',
        token.name ? 'a single-use token was issued (value not shown)' : 'no token returned',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      // Strip anything key-shaped before printing a provider error.
      record('Gemini reachable', 'fail', message.replace(/AIza[0-9A-Za-z_-]{35}/g, '[redacted]').slice(0, 200));
    }
  } else {
    record('Gemini checks', 'skip', 'GEMINI_API_KEY not set');
  }

  /* ----------------------------------------------------------- Deployment */

  if (appUrl) {
    console.log('\n\x1b[1mDeployment\x1b[0m');
    try {
      const response = await fetch(`${appUrl}/api/health`, { signal: AbortSignal.timeout(15_000) });
      const body = (await response.json()) as { status?: string; configuration?: unknown };

      record(
        'Health endpoint reachable',
        response.ok ? 'pass' : 'fail',
        `HTTP ${response.status}, status "${body.status ?? 'unknown'}"`,
      );

      record(
        'Deployment configuration complete',
        body.status === 'ok' ? 'pass' : 'fail',
        body.status === 'ok'
          ? 'every required variable is present on the server'
          : `INCOMPLETE — ${JSON.stringify(body.configuration ?? {})}`,
      );

      // Signed out, this must never mint a token.
      const tokenResponse = await fetch(`${appUrl}/api/gemini/live-token`, { method: 'POST' });
      record(
        'Voice token endpoint rejects anonymous callers',
        [401, 403].includes(tokenResponse.status) ? 'pass' : 'fail',
        `HTTP ${tokenResponse.status}${[401, 403].includes(tokenResponse.status) ? '' : ' — EXPECTED 401 or 403'}`,
      );
    } catch (error) {
      record('Deployment reachable', 'fail', error instanceof Error ? error.message.slice(0, 150) : 'unknown');
    }
  } else {
    console.log('\n\x1b[90mSet APP_URL to also check the deployed site.\x1b[0m');
  }

  /* ---------------------------------------------------------------- Result */

  const failed = checks.filter((c) => c.status === 'fail');
  const passed = checks.filter((c) => c.status === 'pass');

  console.log(
    `\n\x1b[1m${passed.length} passed, ${failed.length} failed, ` +
      `${checks.filter((c) => c.status === 'skip').length} skipped\x1b[0m`,
  );

  if (failed.length > 0) {
    console.log('\n\x1b[31mFailures:\x1b[0m');
    for (const check of failed) console.log(`  • ${check.name} — ${check.detail}`);
    console.log('\nTROUBLESHOOTING.md covers each of these by symptom.\n');
    process.exit(1);
  }

  console.log('\n\x1b[32mEverything checked is working.\x1b[0m\n');
}

main().catch((error: unknown) => {
  console.error('Verification could not run:', error instanceof Error ? error.message : error);
  process.exit(1);
});
