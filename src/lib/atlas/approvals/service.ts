import 'server-only';

import { hashPayload, newIdempotencyKey, payloadMatchesHash } from '@/lib/atlas/approvals/payload';
import { registerAllTools } from '@/lib/atlas/tools/definitions';
import { getTool } from '@/lib/atlas/tools/registry';
import { logAction } from '@/lib/data/action-log';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { redactError } from '@/lib/validation/redact';
import type { Approval } from '@/types/database';

/**
 * The approval lifecycle.
 *
 * Creation happens server-side with the admin client: `authenticated` has no
 * INSERT grant on `approvals`, so a client cannot fabricate an approval for an
 * action Atlas never proposed.
 *
 * Execution goes through `claim_approval()`, which does the status, ownership,
 * expiry and idempotency checks inside a single atomic UPDATE. That is what
 * makes "executes at most once" true under concurrency rather than merely
 * likely — the disabled button in the UI is cosmetic.
 */

export type CreateApprovalInput = {
  userId: string;
  actionType: string;
  title: string;
  reason: string;
  payload: unknown;
  affected?: string[];
  externalSystem?: string | null;
  expiryMinutes?: number;
};

export async function createApproval(input: CreateApprovalInput): Promise<Approval> {
  const admin = createAdminClient();

  const expiryMinutes = input.expiryMinutes ?? 60;
  const requestedAt = new Date();
  const expiresAt = new Date(requestedAt.getTime() + expiryMinutes * 60_000);

  const { data, error } = await admin
    .from('approvals')
    .insert({
      user_id: input.userId,
      action_type: input.actionType,
      title: input.title,
      reason: input.reason,
      proposed_payload: input.payload as never,
      payload_hash: hashPayload(input.payload),
      affected_data: {
        records: input.affected ?? [],
        external_system: input.externalSystem ?? null,
      } as never,
      status: 'pending',
      idempotency_key: newIdempotencyKey(input.actionType),
      requested_at: requestedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Could not create the approval (${error?.code ?? 'unknown'})`);
  }

  await logAction({
    toolName: input.actionType,
    operationType: 'propose',
    actionSummary: `Proposed: ${input.title}`,
    status: 'success',
    approvalId: (data as unknown as Approval).id,
  });

  return data as unknown as Approval;
}

export type ExecutionOutcome =
  | { ok: true; summary: string }
  | { ok: false; errorCode: string; message: string };

/**
 * Execute an approved action, exactly once.
 *
 * The ordering here is the security property, and each step exists because
 * skipping it opens a specific hole:
 *
 *   1. load the approval (RLS scopes it to the caller)
 *   2. verify the payload still matches the hash recorded at approval time
 *   3. CLAIM it atomically — this is the single-execution guarantee
 *   4. only then make the external call
 *   5. record the outcome
 *
 * Claiming before the external call means a crash mid-flight leaves the
 * approval `executed` rather than replayable. That is the safer failure: a
 * duplicate Gmail draft is worse than a missing one, and the action log
 * records what happened either way.
 */
export async function executeApproval(approvalId: string): Promise<ExecutionOutcome> {
  // Approval execution is a separate server entry point from the voice tool
  // route. Initialise the explicit registry here as well so an approval can
  // resolve the same tool that originally created it.
  registerAllTools();

  const supabase = await createClient();
  const startedAt = Date.now();

  const { data: approval, error: loadError } = await supabase
    .from('approvals')
    .select('*')
    .eq('id', approvalId)
    .maybeSingle();

  if (loadError || !approval) {
    return { ok: false, errorCode: 'not_found', message: 'That approval could not be found.' };
  }

  const record = approval as unknown as Approval;

  // Verified BEFORE the claim: a tampered payload should be refused outright,
  // not consume the one execution the approval is entitled to.
  if (!payloadMatchesHash(record.proposed_payload, record.payload_hash)) {
    await logAction({
      toolName: record.action_type,
      operationType: 'refuse',
      actionSummary: 'Refused execution: payload did not match the approved hash',
      status: 'refused',
      approvalId,
      errorCode: 'payload_mismatch',
    });
    return {
      ok: false,
      errorCode: 'payload_mismatch',
      message:
        'This action has changed since it was approved and will not run. ' +
        'Review it again and approve the new version.',
    };
  }

  const tool = getTool(record.action_type);
  if (!tool) {
    return {
      ok: false,
      errorCode: 'unknown_tool',
      message: `There is no tool called "${record.action_type}".`,
    };
  }

  // The atomic claim. A second caller finds nothing to claim and raises.
  const { error: claimError } = await supabase.rpc('claim_approval', {
    p_approval_id: approvalId,
    p_idempotency_key: record.idempotency_key,
  });

  if (claimError) {
    // One message for every failure mode. Distinguishing "already executed"
    // from "expired" would tell a replaying caller which attempt landed.
    return {
      ok: false,
      errorCode: 'not_claimable',
      message:
        'This action cannot run. It may already have been carried out, or it may have expired.',
    };
  }

  // Claimed. From here the approval is spent whatever happens next.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const parsed = tool.inputSchema.safeParse(record.proposed_payload);
    if (!parsed.success) {
      throw new Error('The approved payload no longer satisfies the tool schema.');
    }

    const result = await tool.execute(
      {
        userId: record.user_id,
        signal: controller.signal,
        idempotencyKey: record.idempotency_key,
      },
      parsed.data,
    );

    const admin = createAdminClient();

    if (!result.ok) {
      await admin
        .from('approvals')
        .update({
          status: 'failed',
          execution_result: { error_code: result.errorCode, message: result.message } as never,
        })
        .eq('id', approvalId);

      await logAction({
        toolName: record.action_type,
        operationType: 'execute',
        actionSummary: `Failed: ${record.title}`,
        status: 'failure',
        approvalId,
        errorCode: result.errorCode,
        durationMs: Date.now() - startedAt,
      });

      return { ok: false, errorCode: result.errorCode, message: result.message };
    }

    await admin
      .from('approvals')
      .update({ execution_result: { summary: result.summary } as never })
      .eq('id', approvalId);

    await logAction({
      toolName: record.action_type,
      operationType: 'execute',
      actionSummary: result.summary,
      status: 'success',
      approvalId,
      durationMs: Date.now() - startedAt,
    });

    return { ok: true, summary: result.summary };
  } catch (error) {
    const redacted = redactError(error);

    const admin = createAdminClient();
    await admin
      .from('approvals')
      .update({
        status: 'failed',
        execution_result: { error: redacted.name, message: redacted.message } as never,
      })
      .eq('id', approvalId);

    await logAction({
      toolName: record.action_type,
      operationType: 'execute',
      actionSummary: `Failed: ${record.title}`,
      status: 'failure',
      approvalId,
      errorCode: redacted.name,
      durationMs: Date.now() - startedAt,
    });

    return {
      ok: false,
      errorCode: 'execution_failed',
      message: 'That action could not be completed. Nothing was retried automatically.',
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Edit an approval.
 *
 * Creates a NEW approval and rejects the original. The old approval can never
 * execute the new payload — its hash would not match even if it somehow
 * reached execution.
 */
export async function editApproval(
  approvalId: string,
  newPayload: unknown,
  userId: string,
): Promise<Approval> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('approvals')
    .select('*')
    .eq('id', approvalId)
    .maybeSingle();

  if (error || !data) throw new Error('That approval could not be found.');
  const original = data as unknown as Approval;

  if (original.status !== 'pending') {
    throw new Error('Only a pending approval can be edited.');
  }

  const admin = createAdminClient();

  const requestedAt = new Date();
  const originalWindow =
    new Date(original.expires_at).getTime() - new Date(original.requested_at).getTime();

  const { data: created, error: createError } = await admin
    .from('approvals')
    .insert({
      user_id: userId,
      action_type: original.action_type,
      title: original.title,
      reason: `${original.reason} (edited before approval)`,
      proposed_payload: newPayload as never,
      payload_hash: hashPayload(newPayload),
      affected_data: original.affected_data as never,
      status: 'pending',
      idempotency_key: newIdempotencyKey(original.action_type),
      requested_at: requestedAt.toISOString(),
      expires_at: new Date(requestedAt.getTime() + originalWindow).toISOString(),
      supersedes_approval_id: original.id,
    })
    .select()
    .single();

  if (createError || !created) {
    throw new Error('Could not create the edited approval.');
  }

  // The original is closed only after the replacement exists, so a failure
  // cannot leave Muhammad with neither.
  await admin
    .from('approvals')
    .update({ status: 'rejected', rejected_at: new Date().toISOString() })
    .eq('id', original.id);

  return created as unknown as Approval;
}
