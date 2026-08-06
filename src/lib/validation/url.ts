/**
 * URL validation for anything Atlas stores or displays as a source.
 *
 * Two jobs: keep obviously-hostile addresses out of the database, and make
 * server-side request forgery impossible if a future feature ever fetches a
 * URL directly. V1 does not fetch arbitrary URLs — research goes through
 * Gemini's grounding — but a source URL is still user-visible and gets stored,
 * so it is validated at the boundary.
 */

/** Hostnames that must never be reachable, whatever the scheme. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  // Cloud instance metadata. Reaching this from a server is how credentials
  // get stolen, so it is named explicitly rather than left to the range checks.
  'metadata.google.internal',
  'metadata.goog',
]);

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain'];

/** Private, loopback, link-local and carrier-grade NAT ranges. */
function isPrivateIPv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;

  const parts = match.slice(1, 5).map(Number);
  const [a, b] = parts as [number, number, number, number];

  if (parts.some((n) => n > 255)) return true; // malformed — reject
  if (a === 10) return true;
  if (a === 127) return true; // loopback
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast and reserved

  return false;
}

function isPrivateIPv6(host: string): boolean {
  const normalised = host.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    normalised === '::1' ||
    normalised === '::' ||
    normalised.startsWith('fc') || // unique local
    normalised.startsWith('fd') ||
    normalised.startsWith('fe80') || // link-local
    // IPv4-mapped addresses can smuggle a private v4 address through.
    normalised.startsWith('::ffff:')
  );
}

export type UrlValidation =
  | { valid: true; url: URL }
  | { valid: false; reason: string };

export function validateExternalUrl(input: string): UrlValidation {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { valid: false, reason: 'Not a valid URL.' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    // Blocks javascript:, data:, file: and gopher: among others.
    return { valid: false, reason: 'Only http and https addresses are allowed.' };
  }

  const host = url.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(host)) {
    return { valid: false, reason: 'That address points at this machine.' };
  }

  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return { valid: false, reason: 'That address points inside a private network.' };
  }

  if (isPrivateIPv4(host) || isPrivateIPv6(host)) {
    return { valid: false, reason: 'That address points inside a private network.' };
  }

  // Credentials in a URL are never legitimate for a cited source and would be
  // stored in plain text.
  if (url.username || url.password) {
    return { valid: false, reason: 'That address contains embedded credentials.' };
  }

  return { valid: true, url };
}

export function isSafeExternalUrl(input: string): boolean {
  return validateExternalUrl(input).valid;
}

/**
 * The hostname, for display.
 *
 * Links are shown with their host visible so Muhammad can see where a click
 * leads before taking it.
 */
export function displayHost(input: string): string {
  const result = validateExternalUrl(input);
  return result.valid ? result.url.hostname.replace(/^www\./, '') : 'unknown source';
}
