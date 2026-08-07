/** The complete, deliberately narrow Google capability set for Atlas. */
export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
] as const;

export const GOOGLE_GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
] as const;

export const GOOGLE_OAUTH_SCOPES = [...GOOGLE_CALENDAR_SCOPES, ...GOOGLE_GMAIL_SCOPES] as const;

export const GOOGLE_OAUTH_SCOPE_STRING = GOOGLE_OAUTH_SCOPES.join(' ');

export function hasEveryScope(granted: string[], required: readonly string[]): boolean {
  const scopeSet = new Set(granted);
  return required.every((scope) => scopeSet.has(scope));
}
