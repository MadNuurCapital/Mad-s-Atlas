import type { ZodType } from 'zod';

import {
  AtlasPermissionLevel,
  disabledReason,
  isDisabledCapability,
  type PermissionDecision,
} from '@/lib/atlas/permissions/levels';

/**
 * The tool registry.
 *
 * A tool that is not registered here cannot be invoked, whatever the model
 * emits. Registration is explicit — there is no directory scan, no dynamic
 * import, and no way for a tool to appear at runtime.
 */

export type AtlasToolContext = {
  userId: string;
  /** Aborts the tool when the request is cancelled or times out. */
  signal: AbortSignal;
  /** Stable across retries of the same logical action. */
  idempotencyKey: string;
  conversationId?: string | null;
};

export type AtlasToolResult<TOutput> =
  | { ok: true; output: TOutput; summary: string }
  | { ok: false; errorCode: string; message: string };

export interface AtlasTool<TInput, TOutput> {
  name: string;
  description: string;
  permissionLevel: AtlasPermissionLevel;
  inputSchema: ZodType<TInput>;
  /**
   * Present only on Level 2 tools: renders the human-readable summary and the
   * list of affected records shown on the approval card.
   */
  describeProposal?: (input: TInput) => { title: string; summary: string; affected: string[] };
  execute(context: AtlasToolContext, input: TInput): Promise<AtlasToolResult<TOutput>>;
}

// The registry stores tools with erased generics; `resolveTool` re-narrows on
// the way out. Using `any` here would defeat the validation this whole module
// exists to provide.
type AnyTool = AtlasTool<unknown, unknown>;

const registry = new Map<string, AnyTool>();

export function registerTool<TInput, TOutput>(tool: AtlasTool<TInput, TOutput>): void {
  if (registry.has(tool.name)) {
    throw new Error(`Tool "${tool.name}" is already registered.`);
  }

  // A Level 3 tool must not exist. If one is ever written, fail at startup
  // rather than shipping something that could be invoked.
  if (tool.permissionLevel === AtlasPermissionLevel.Disabled) {
    throw new Error(
      `Tool "${tool.name}" declares permission level 3. Level 3 capabilities are ` +
        'not implemented and must not be registered — see PERMISSIONS.md.',
    );
  }

  registry.set(tool.name, tool as unknown as AnyTool);
}

export function getTool(name: string): AnyTool | undefined {
  return registry.get(name);
}

export function listTools(): AnyTool[] {
  return [...registry.values()];
}

/** Test helper. Never called from application code. */
export function __clearRegistry(): void {
  registry.clear();
}

/* -------------------------------------------------------------------------- */
/*  The decision                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Resolve what should happen for a proposed tool name.
 *
 * Order matters. A disabled capability is checked FIRST so it gets a specific
 * refusal rather than being reported as an unknown tool — Muhammad should be
 * told "Atlas cannot send email", not "no such tool", and the attempt should
 * be logged as a refusal rather than a typo.
 */
export function decidePermission(toolName: string): PermissionDecision {
  if (isDisabledCapability(toolName)) {
    return {
      outcome: 'refuse',
      level: AtlasPermissionLevel.Disabled,
      reason: disabledReason(toolName),
    };
  }

  const tool = registry.get(toolName);
  if (!tool) {
    return {
      outcome: 'unknown_tool',
      reason: `There is no tool called "${toolName}".`,
    };
  }

  if (tool.permissionLevel === AtlasPermissionLevel.RequiresApproval) {
    return { outcome: 'require_approval', level: AtlasPermissionLevel.RequiresApproval };
  }

  return { outcome: 'allow', level: AtlasPermissionLevel.Automatic };
}
