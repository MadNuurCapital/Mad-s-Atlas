import { NextResponse } from 'next/server';
import { z } from 'zod';

import { completeIdeaStep } from '@/lib/atlas/planner/service';
import { requireOwnerApi } from '@/lib/auth/owner';
import { createClient } from '@/lib/supabase/server';

const requestSchema = z.object({
  stepId: z.string().uuid(),
  action: z.literal('done'),
});

export async function POST(request: Request) {
  const auth = await requireOwnerApi();
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorised.' }, { status: auth.status });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid step action.' }, { status: 400 });

  const supabase = await createClient();
  const { data: step } = await supabase
    .from('idea_steps')
    .select('idea_id')
    .eq('id', parsed.data.stepId)
    .maybeSingle();
  if (!step) return NextResponse.json({ error: 'Plan step not found.' }, { status: 404 });

  const result = await completeIdeaStep(step.idea_id, parsed.data.stepId);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 409 });
  return NextResponse.json({ ok: true, summary: result.summary });
}
