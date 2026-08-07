'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireOwner } from '@/lib/auth/owner';
import { runAndStoreResearch } from '@/lib/atlas/research/service';
import { logAction } from '@/lib/data/action-log';

export type ResearchActionResult =
  | { ok: true; reportId: string }
  | { ok: false; error: string };

const querySchema = z.string().trim().min(3).max(1000);

export async function runResearch(query: string): Promise<ResearchActionResult> {
  const { user } = await requireOwner();
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) {
    return { ok: false, error: 'Enter a research question of at least three characters.' };
  }

  const startedAt = Date.now();
  try {
    const outcome = await runAndStoreResearch(user.id, parsed.data);

    await logAction({
      toolName: 'research.current_web',
      operationType: 'analyse',
      actionSummary: 'Completed grounded web research',
      status: 'success',
      durationMs: Date.now() - startedAt,
      metadata: { source_count: outcome.sources.length, unverified: outcome.unverified },
    });

    revalidatePath('/research');
    return { ok: true, reportId: outcome.reportId };
  } catch {
    await logAction({
      toolName: 'research.current_web',
      operationType: 'analyse',
      actionSummary: 'Grounded web research failed',
      status: 'failure',
      errorCode: 'research_failed',
      durationMs: Date.now() - startedAt,
    });
    return { ok: false, error: 'Atlas could not complete that research. Please try again.' };
  }
}
