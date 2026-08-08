import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createApproval } from '@/lib/atlas/approvals/service';
import { registerAllTools } from '@/lib/atlas/tools/definitions';
import { decidePermission, getTool } from '@/lib/atlas/tools/registry';
import { requireOwnerApi } from '@/lib/auth/owner';
import { logAction } from '@/lib/data/action-log';
import { observeToolOutcome } from '@/lib/data/evolution';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const requestSchema = z.object({
  callId: z.string().trim().min(1).max(200),
  toolName: z.string().trim().min(1).max(128),
  arguments: z.unknown().default({}),
});

/**
 * The only bridge between Gemini Live tool calls and Atlas data.
 *
 * The browser may ask for any name it likes; the explicit registry and
 * permission engine decide what exists, what can run, and what must become an
 * approval. A Live token therefore grants no Atlas capability by itself.
 */
export async function POST(request: Request) {
  const auth = await requireOwnerApi();
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.status === 401 ? 'Not signed in.' : 'This application is private.' },
      { status: auth.status },
    );
  }

  const body = await request.json().catch(() => null);
  const parsedRequest = requestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return NextResponse.json({ ok: false, error: 'That tool request was not valid.' }, { status: 400 });
  }

  registerAllTools();

  const { callId, toolName, arguments: proposedArguments } = parsedRequest.data;
  const decision = decidePermission(toolName);

  if (decision.outcome === 'refuse' || decision.outcome === 'unknown_tool') {
    const message = decision.outcome === 'refuse' ? decision.reason : 'Atlas does not have that capability.';
    await logAction({
      toolName,
      operationType: 'refuse',
      actionSummary: 'Refused an unavailable voice capability',
      status: 'refused',
      errorCode: decision.outcome,
    });

    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }

  const tool = getTool(toolName);
  if (!tool) {
    return NextResponse.json({ ok: false, error: 'Atlas does not have that capability.' }, { status: 404 });
  }

  const parsedArguments = tool.inputSchema.safeParse(proposedArguments);
  if (!parsedArguments.success) {
    await logAction({
      toolName,
      operationType: 'refuse',
      actionSummary: 'Refused invalid voice tool input',
      status: 'refused',
      errorCode: 'invalid_input',
    });
    return NextResponse.json(
      { ok: false, error: 'The request was missing or contained invalid details.' },
      { status: 400 },
    );
  }

  if (decision.outcome === 'require_approval') {
    const proposal = tool.describeProposal?.(parsedArguments.data);
    if (!proposal) {
      return NextResponse.json({ ok: false, error: 'Atlas could not describe that proposal safely.' }, { status: 500 });
    }

    const approval = await createApproval({
      userId: auth.session.user.id,
      actionType: toolName,
      title: proposal.title,
      reason: proposal.summary,
      payload: parsedArguments.data,
      affected: proposal.affected,
      externalSystem: toolName.startsWith('gmail.') ? 'Gmail' : 'Google Calendar',
    });

    return NextResponse.json({
      ok: true,
      status: 'approval_required',
      summary: `${proposal.title}. It is waiting in Approvals and has not been executed.`,
      data: { approvalId: approval.id, approvalsPath: '/approvals' },
    });
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const result = await tool.execute(
      {
        userId: auth.session.user.id,
        signal: controller.signal,
        idempotencyKey: `voice:${callId}`,
      },
      parsedArguments.data,
    );

    await logAction({
      toolName,
      operationType: isReadTool(toolName) ? 'read' : 'execute',
      actionSummary: result.ok
        ? isReadTool(toolName)
          ? 'Read data for a voice request'
          : 'Completed a voice action'
        : 'Voice tool failed',
      status: result.ok ? 'success' : 'failure',
      errorCode: result.ok ? null : result.errorCode,
      durationMs: Date.now() - startedAt,
      metadata: { channel: 'voice' },
    });
    await observeToolOutcome(auth.session.user.id, toolName, result.ok).catch(() => undefined);

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.message }, { status: 422 });
    }

    return NextResponse.json({
      ok: true,
      status: 'completed',
      summary: result.summary,
      data: result.output,
    });
  } catch {
    await logAction({
      toolName,
      operationType: isReadTool(toolName) ? 'read' : 'execute',
      actionSummary: 'Voice tool failed',
      status: 'failure',
      errorCode: controller.signal.aborted ? 'timeout' : 'unexpected_error',
      durationMs: Date.now() - startedAt,
      metadata: { channel: 'voice' },
    });
    return NextResponse.json(
      { ok: false, error: controller.signal.aborted ? 'That took too long. Nothing was retried.' : 'Atlas could not complete that request.' },
      { status: controller.signal.aborted ? 504 : 500 },
    );
  } finally {
    clearTimeout(timeout);
  }
}

function isReadTool(toolName: string): boolean {
  return toolName.endsWith('.list') || toolName.includes('.list_') || toolName.endsWith('.search');
}

export function GET() {
  return NextResponse.json({ error: 'Method not allowed.' }, { status: 405 });
}
