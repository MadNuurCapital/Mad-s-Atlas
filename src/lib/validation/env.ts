import { z } from 'zod';

/**
 * Environment contract for Mad's Atlas.
 *
 * Two rules govern this file:
 *
 *  1. Validation failures print the variable NAME and never its VALUE. An error
 *     message that helpfully echoes a leaked key is worse than no message.
 *  2. Server-only values are read through `serverEnv()`, which throws if it is
 *     ever reached from the browser. `NEXT_PUBLIC_*` values are referenced
 *     literally below because Next inlines them at build time — a computed
 *     lookup like `process.env[name]` silently yields undefined in the bundle.
 *
 * See .env.example for the annotated contract and SECURITY.md § Key management.
 */

const nonEmpty = (label: string) => z.string().trim().min(1, `${label} is required`);

const httpUrl = (label: string) =>
  z
    .string()
    .trim()
    .url(`${label} must be a valid URL`)
    .refine((v) => /^https?:\/\//.test(v), `${label} must start with http:// or https://`)
    .refine((v) => !v.endsWith('/'), `${label} must not have a trailing slash`);

/* -------------------------------------------------------------------------- */
/*  Public — safe to ship to the browser                                       */
/* -------------------------------------------------------------------------- */

const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: httpUrl('NEXT_PUBLIC_APP_URL'),
  NEXT_PUBLIC_SUPABASE_URL: httpUrl('NEXT_PUBLIC_SUPABASE_URL'),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: nonEmpty('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
});

export type PublicEnv = z.infer<typeof publicSchema>;

/* -------------------------------------------------------------------------- */
/*  Server-only — must never reach the browser                                 */
/* -------------------------------------------------------------------------- */

const serverSchema = z.object({
  ATLAS_OWNER_EMAIL: z
    .string()
    .trim()
    .min(1, 'ATLAS_OWNER_EMAIL is required')
    .refine((v) => v.includes('@'), 'ATLAS_OWNER_EMAIL must be an email address'),
  ATLAS_TIMEZONE: z.string().trim().default('Asia/Singapore'),

  SUPABASE_SECRET_KEY: nonEmpty('SUPABASE_SECRET_KEY'),
  SUPABASE_DB_URL: z.string().trim().default(''),

  GEMINI_API_KEY: nonEmpty('GEMINI_API_KEY'),
  GEMINI_LIVE_MODEL: z.string().trim().default('gemini-3.1-flash-live-preview'),
  GEMINI_TEXT_MODEL: z.string().trim().default('gemini-3.6-flash'),
  GEMINI_EMBEDDING_MODEL: z.string().trim().default('gemini-embedding-001'),

  GOOGLE_CLIENT_ID: nonEmpty('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: nonEmpty('GOOGLE_CLIENT_SECRET'),
  GOOGLE_REDIRECT_URI: z.string().trim().default(''),

  // 32 random bytes, base64-encoded: `openssl rand -base64 32`.
  // Length is validated here so a truncated key fails at boot rather than at
  // the first attempt to decrypt a Google token months later.
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .trim()
    .min(1, 'TOKEN_ENCRYPTION_KEY is required')
    .refine((v) => {
      try {
        return Buffer.from(v, 'base64').length === 32;
      } catch {
        return false;
      }
    }, 'TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)'),

  SENTRY_DSN: z.string().trim().default(''),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type ServerEnv = z.infer<typeof serverSchema>;

/* -------------------------------------------------------------------------- */
/*  Failure reporting — names only, never values                               */
/* -------------------------------------------------------------------------- */

export class EnvironmentError extends Error {
  readonly variables: string[];

  constructor(scope: string, issues: z.core.$ZodIssue[]) {
    const lines = issues.map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`);
    super(
      `Invalid ${scope} environment configuration:\n${lines.join('\n')}\n\n` +
        'See .env.example. Values are never printed — check the named variables.',
    );
    this.name = 'EnvironmentError';
    this.variables = issues.map((i) => String(i.path[0] ?? ''));
  }
}

/* -------------------------------------------------------------------------- */
/*  Accessors                                                                  */
/* -------------------------------------------------------------------------- */

let cachedPublic: PublicEnv | undefined;
let cachedServer: ServerEnv | undefined;

/**
 * Public configuration. Safe on both server and client.
 *
 * Each variable is referenced literally so Next's build-time inlining works —
 * this is why the object below is written out longhand rather than looped.
 */
export function publicEnv(): PublicEnv {
  if (cachedPublic) return cachedPublic;

  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });

  if (!parsed.success) throw new EnvironmentError('public', parsed.error.issues);

  cachedPublic = parsed.data;
  return cachedPublic;
}

/**
 * Server-only configuration.
 *
 * Throws if reached from the browser. That should be impossible — the modules
 * that call this import 'server-only' — but a runtime guard costs nothing and
 * turns a silent leak into a loud failure.
 */
export function serverEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error(
      'serverEnv() was called in the browser. Server-only configuration must ' +
        'never be read from client code.',
    );
  }

  if (cachedServer) return cachedServer;

  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) throw new EnvironmentError('server', parsed.error.issues);

  cachedServer = parsed.data;
  return cachedServer;
}

/**
 * Non-throwing readiness probe for /api/health.
 *
 * Reports WHICH groups are configured, never what they contain.
 */
export function environmentReadiness(): {
  ok: boolean;
  missing: string[];
} {
  const missing: string[] = [];

  const pub = publicSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  if (!pub.success) missing.push(...pub.error.issues.map((i) => String(i.path[0] ?? '')));

  if (typeof window === 'undefined') {
    const srv = serverSchema.safeParse(process.env);
    if (!srv.success) missing.push(...srv.error.issues.map((i) => String(i.path[0] ?? '')));
  }

  return { ok: missing.length === 0, missing: [...new Set(missing)] };
}

/** Reset caches. Test helper only. */
export function __resetEnvCache(): void {
  cachedPublic = undefined;
  cachedServer = undefined;
}
