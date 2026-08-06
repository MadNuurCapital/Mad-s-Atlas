/**
 * Automated portion of the security audit checklist.
 *
 *   npx tsx scripts/security-check.ts
 *
 * Covers the checks a machine can do reliably: secret patterns in the working
 * tree AND in git history, `NEXT_PUBLIC_` misuse, server-only import guards,
 * and dependency advisories. The remaining items in SECURITY.md need a running
 * database or a browser and live in the test suites.
 *
 * Exits non-zero on any finding, so it can gate a deploy.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

type Finding = { severity: 'critical' | 'warning'; check: string; detail: string };

const findings: Finding[] = [];

function critical(check: string, detail: string): void {
  findings.push({ severity: 'critical', check, detail });
}
function warning(check: string, detail: string): void {
  findings.push({ severity: 'warning', check, detail });
}

function sh(command: string): string {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    // grep exits 1 when it finds nothing, which is the good case here.
    return '';
  }
}

/**
 * Patterns for real credentials. Deliberately specific: a loose pattern that
 * fires on every occurrence of the word "key" gets ignored, and an ignored
 * check protects nothing.
 */
const SECRET_PATTERNS: Array<{ name: string; regex: string }> = [
  { name: 'Supabase secret key', regex: 'sb_secret_[A-Za-z0-9_-]{10,}' },
  { name: 'Supabase legacy service_role JWT', regex: 'eyJ[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}' },
  { name: 'Google API key', regex: 'AIza[0-9A-Za-z_-]{35}' },
  { name: 'Google OAuth client secret', regex: 'GOCSPX-[A-Za-z0-9_-]{20,}' },
  { name: 'Private key block', regex: '-----BEGIN [A-Z ]*PRIVATE KEY-----' },
];

console.log('\n  Mad’s Atlas — security check\n');

/* -------------------------------------------------------------------------- */
/*  1. Secrets in the working tree                                             */
/* -------------------------------------------------------------------------- */

for (const { name, regex } of SECRET_PATTERNS) {
  const hits = sh(
    `git grep -nIE '${regex}' -- ':!*.lock' ':!package-lock.json' ':!scripts/security-check.ts' || true`,
  ).trim();
  if (hits) critical('secrets in tree', `${name}:\n      ${hits.split('\n').join('\n      ')}`);
}

/* -------------------------------------------------------------------------- */
/*  2. Secrets anywhere in git history                                         */
/* -------------------------------------------------------------------------- */
// A secret removed in a later commit is still a leaked secret. Anything found
// here must be ROTATED — deleting the commit is not sufficient once pushed.

// Test files are excluded. They contain deliberately secret-shaped fixtures,
// and history cannot be rewritten once pushed — so leaving them in would keep
// this check permanently red, which is the surest way to get it ignored. Real
// credentials never belong in a test, and the working-tree scan above still
// covers those paths.
for (const { name, regex } of SECRET_PATTERNS) {
  const hits = sh(
    `git log -p --all -- . ':!tests/' ':!scripts/security-check.ts' | grep -cE '${regex}' || true`,
  ).trim();
  if (hits && hits !== '0') {
    critical(
      'secrets in git history',
      `${name}: ${hits} occurrence(s). ROTATE the credential — removing the ` +
        'commit does not un-leak it.',
    );
  }
}

/* -------------------------------------------------------------------------- */
/*  3. .env files that should never be tracked                                 */
/* -------------------------------------------------------------------------- */

const tracked = sh('git ls-files').split('\n');
for (const file of tracked) {
  if (/^\.env($|\.)/.test(file) && file !== '.env.example') {
    critical('tracked env file', `${file} is committed. Remove it and rotate everything in it.`);
  }
}

/* -------------------------------------------------------------------------- */
/*  4. NEXT_PUBLIC_ misuse                                                     */
/* -------------------------------------------------------------------------- */
// A secret behind this prefix is compiled into the browser bundle permanently.

const SENSITIVE_NAMES = [
  'SECRET',
  'PRIVATE',
  'GEMINI_API_KEY',
  'CLIENT_SECRET',
  'TOKEN_ENCRYPTION',
  'DB_URL',
  'SERVICE_ROLE',
];

const publicVars = sh("git grep -hoE 'NEXT_PUBLIC_[A-Z0-9_]+' -- ':!*.md' || true")
  .split('\n')
  .map((v) => v.trim())
  .filter(Boolean);

for (const name of new Set(publicVars)) {
  // VAPID's public key is public by design — it is half of a keypair.
  if (name === 'NEXT_PUBLIC_VAPID_PUBLIC_KEY') continue;
  if (SENSITIVE_NAMES.some((s) => name.includes(s))) {
    critical('NEXT_PUBLIC_ misuse', `${name} is exposed to the browser by its prefix.`);
  }
}

/* -------------------------------------------------------------------------- */
/*  5. server-only guards on privileged modules                                */
/* -------------------------------------------------------------------------- */

const MUST_BE_SERVER_ONLY = [
  'src/lib/supabase/admin.ts',
  'src/lib/crypto/tokens.ts',
  'src/lib/auth/owner.ts',
  'src/lib/google/store-tokens.ts',
];

for (const path of MUST_BE_SERVER_ONLY) {
  try {
    const source = readFileSync(path, 'utf8');
    if (!source.includes("import 'server-only'")) {
      critical(
        'missing server-only guard',
        `${path} handles privileged data but does not import 'server-only'. ` +
          'Without it, a client import fails at runtime instead of at build time.',
      );
    }
  } catch {
    warning('missing file', `${path} not found — update this list if it moved.`);
  }
}

/* -------------------------------------------------------------------------- */
/*  6. Dependency advisories                                                   */
/* -------------------------------------------------------------------------- */

try {
  const audit = execSync('npm audit --json --audit-level=high', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const parsed = JSON.parse(audit) as {
    metadata?: { vulnerabilities?: Record<string, number> };
  };
  const vulns = parsed.metadata?.vulnerabilities ?? {};
  const high = (vulns.high ?? 0) + (vulns.critical ?? 0);
  if (high > 0) {
    critical('dependency advisories', `${high} high or critical advisories. Run: npm audit`);
  }
} catch {
  // npm audit exits non-zero when it finds something; re-read without the gate.
  const audit = sh('npm audit --json || true');
  try {
    const parsed = JSON.parse(audit) as { metadata?: { vulnerabilities?: Record<string, number> } };
    const vulns = parsed.metadata?.vulnerabilities ?? {};
    const high = (vulns.high ?? 0) + (vulns.critical ?? 0);
    if (high > 0) {
      critical('dependency advisories', `${high} high or critical advisories. Run: npm audit`);
    }
  } catch {
    warning('dependency advisories', 'Could not parse npm audit output.');
  }
}

/* -------------------------------------------------------------------------- */
/*  Report                                                                     */
/* -------------------------------------------------------------------------- */

const criticals = findings.filter((f) => f.severity === 'critical');
const warnings = findings.filter((f) => f.severity === 'warning');

if (findings.length === 0) {
  console.log('  ✓ No issues found.\n');
  console.log('  Not covered here — these need a database or a browser:');
  console.log('    • RLS coverage and cross-user isolation  → npm run test:integration');
  console.log('    • Secrets absent from browser traffic     → npm run test:e2e');
  console.log('    • Prompt-injection suite                  → npm run test\n');
  process.exit(0);
}

for (const f of criticals) {
  console.error(`  ✗ [${f.check}] ${f.detail}`);
}
for (const f of warnings) {
  console.warn(`  ! [${f.check}] ${f.detail}`);
}

console.error(`\n  ${criticals.length} critical, ${warnings.length} warning\n`);
process.exit(criticals.length > 0 ? 1 : 0);
