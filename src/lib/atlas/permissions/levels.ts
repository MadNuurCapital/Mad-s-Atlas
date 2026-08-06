/**
 * The permission model.
 *
 * The invariant this file exists to enforce: **the model proposes, the server
 * decides.** A permission level is a property of the tool, declared in the
 * registry and resolved here. It is never read from model output, and a system
 * prompt is not a permission boundary.
 *
 * See PERMISSIONS.md for the full matrix and the reasoning behind each level.
 */

export const AtlasPermissionLevel = {
  /** Read or analyse. Runs immediately. Nothing leaves the system. */
  Automatic: 1,
  /** External or lasting effect. Creates an approval record and stops. */
  RequiresApproval: 2,
  /** Not implemented. No code path exists. */
  Disabled: 3,
} as const;

export type AtlasPermissionLevel =
  (typeof AtlasPermissionLevel)[keyof typeof AtlasPermissionLevel];

/**
 * Level 3 — the complete list.
 *
 * These are NOT tools with a flag set to "off". They are absent from the
 * registry entirely, so there is nothing to invoke even if a compromised model
 * emitted the name. This array exists so a request for one can be refused with
 * a specific explanation and logged, rather than falling through to a generic
 * "unknown tool".
 */
export const DISABLED_CAPABILITIES: Readonly<Record<string, string>> = Object.freeze({
  'gmail.send': 'Sending email is not implemented. Atlas can prepare a draft for your approval.',
  'gmail.delete': 'Deleting Gmail messages is not implemented.',
  'gmail.archive_bulk': 'Bulk archiving is not implemented.',
  'calendar.execute_delete':
    'Deleting calendar events is not implemented. Atlas can propose a deletion for you to action.',
  'payments.execute': 'Atlas cannot make payments.',
  'investments.execute': 'Atlas cannot execute investments.',
  'purchases.execute': 'Atlas cannot purchase anything.',
  'publish.public': 'Atlas cannot publish public content.',
  'os.control': 'Atlas cannot control the operating system.',
  'passwords.access': 'Atlas cannot access passwords.',
  'data.share_external': 'Atlas cannot share your data externally.',
  'atlas_dart.connect': 'Atlas has no connection to Atlas DART.',
  'atlas_academy.connect': 'Atlas has no connection to Atlas Academy.',
  'atlas_investments.connect': 'Atlas has no connection to Atlas Investments.',
  'financial.transaction': 'Atlas cannot execute financial transactions.',
});

export function isDisabledCapability(name: string): boolean {
  return Object.hasOwn(DISABLED_CAPABILITIES, name);
}

export function disabledReason(name: string): string {
  return DISABLED_CAPABILITIES[name] ?? 'That capability is not implemented.';
}

/* -------------------------------------------------------------------------- */
/*  Permission decisions                                                       */
/* -------------------------------------------------------------------------- */

export type PermissionDecision =
  | { outcome: 'allow'; level: 1 }
  | { outcome: 'require_approval'; level: 2 }
  | { outcome: 'refuse'; level: 3; reason: string }
  | { outcome: 'unknown_tool'; reason: string };

/**
 * Sensitivity levels that force a memory save up to Level 2.
 *
 * The classifier's suggestion is advisory; the escalation is decided
 * server-side, and when in doubt it escalates.
 */
const ESCALATING_SENSITIVITIES = new Set(['personal', 'sensitive', 'highly_sensitive']);

export type MemoryEscalationContext = {
  sensitivity?: string;
  ambiguous?: boolean;
  likelyToChange?: boolean;
  importantToDecisions?: boolean;
};

/**
 * Does a memory save need approval?
 *
 * Level 1 only when the memory is plainly normal AND none of the escalating
 * conditions apply. Anything else waits for Muhammad.
 */
export function memoryRequiresApproval(context: MemoryEscalationContext): boolean {
  if (context.sensitivity && ESCALATING_SENSITIVITIES.has(context.sensitivity)) return true;
  return Boolean(context.ambiguous || context.likelyToChange || context.importantToDecisions);
}
