/**
 * Redaction, applied before anything reaches a log sink.
 *
 * `action_logs` is retained for a year and is the record Muhammad reads to
 * understand what Atlas did. It must contain no API keys, no OAuth tokens, no
 * passwords, no full email bodies and no memory content.
 *
 * The patterns below are deliberately specific. A rule broad enough to catch
 * "anything that looks secret" also catches ordinary text, and a redactor that
 * mangles normal summaries gets removed.
 */

const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Provider credentials.
  { pattern: /sb_secret_[A-Za-z0-9_-]{6,}/g, replacement: '[redacted:supabase-secret]' },
  { pattern: /sb_publishable_[A-Za-z0-9_-]{6,}/g, replacement: '[redacted:supabase-key]' },
  { pattern: /AIza[0-9A-Za-z_-]{35}/g, replacement: '[redacted:google-api-key]' },
  { pattern: /GOCSPX-[A-Za-z0-9_-]{10,}/g, replacement: '[redacted:google-client-secret]' },
  { pattern: /ya29\.[A-Za-z0-9_-]{20,}/g, replacement: '[redacted:google-access-token]' },
  { pattern: /1\/\/[A-Za-z0-9_-]{30,}/g, replacement: '[redacted:google-refresh-token]' },
  // JWTs — three base64url segments.
  {
    pattern: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    replacement: '[redacted:jwt]',
  },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[redacted:private-key]' },
  // Bearer headers.
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi, replacement: 'Bearer [redacted]' },
  // Anything that names itself a secret in a key=value pair.
  {
    pattern: /\b(api[_-]?key|secret|password|token|authorization)\s*[=:]\s*\S+/gi,
    replacement: '$1=[redacted]',
  },
];

/** Summaries are capped: a log entry is a description, not a payload dump. */
const MAX_SUMMARY_LENGTH = 500;

export function redactForLog(value: string): string {
  let output = value;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    output = output.replace(pattern, replacement);
  }

  if (output.length > MAX_SUMMARY_LENGTH) {
    output = `${output.slice(0, MAX_SUMMARY_LENGTH)}… [truncated]`;
  }

  return output;
}

/**
 * Redact a structured object for logging.
 *
 * Keys whose NAME suggests a secret are dropped entirely rather than
 * pattern-matched: the name is the more reliable signal, and a value that
 * happens not to match any pattern is not thereby safe.
 */
const SENSITIVE_KEY = /(token|secret|password|key|authorization|cookie|credential)/i;

export function redactObject(input: unknown, depth = 0): unknown {
  if (depth > 6) return '[redacted:too-deep]';

  if (typeof input === 'string') return redactForLog(input);
  if (input === null || typeof input !== 'object') return input;

  if (Array.isArray(input)) {
    return input.slice(0, 50).map((item) => redactObject(item, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key)) {
      output[key] = '[redacted]';
      continue;
    }
    output[key] = redactObject(value, depth + 1);
  }
  return output;
}

/**
 * Turn an unknown error into something safe to store.
 *
 * Provider messages can embed request URLs with credentials in the query
 * string, so the message is redacted rather than trusted.
 */
export function redactError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: redactForLog(error.message) };
  }
  return { name: 'UnknownError', message: '[redacted:non-error-thrown]' };
}
