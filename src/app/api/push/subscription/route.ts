import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireOwnerApi } from '@/lib/auth/owner';
import { createAdminClient } from '@/lib/supabase/admin';

const subscriptionSchema = z.object({
  endpoint: z.string().url().startsWith('https://').max(2_048),
  keys: z.object({
    p256dh: z.string().min(16).max(512),
    auth: z.string().min(8).max(256),
  }),
});

const removalSchema = z.object({ endpoint: z.string().url().startsWith('https://').max(2_048) });

export async function POST(request: Request) {
  const auth = await requireOwnerApi();
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorised.' }, { status: auth.status });

  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid push subscription.' }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin.from('notification_subscriptions').upsert(
    {
      user_id: auth.session.user.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth_secret: parsed.data.keys.auth,
      user_agent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
      enabled: true,
    },
    { onConflict: 'user_id,endpoint' },
  );
  if (error) return NextResponse.json({ error: 'Could not save this device.' }, { status: 500 });

  await admin
    .from('user_settings')
    .update({ notification_enabled: true })
    .eq('user_id', auth.session.user.id);

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const auth = await requireOwnerApi();
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorised.' }, { status: auth.status });

  const parsed = removalSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid push subscription.' }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin
    .from('notification_subscriptions')
    .delete()
    .eq('user_id', auth.session.user.id)
    .eq('endpoint', parsed.data.endpoint);
  if (error) return NextResponse.json({ error: 'Could not remove this device.' }, { status: 500 });

  const { count } = await admin
    .from('notification_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', auth.session.user.id)
    .eq('enabled', true);
  if (!count) {
    await admin
      .from('user_settings')
      .update({ notification_enabled: false })
      .eq('user_id', auth.session.user.id);
  }

  return NextResponse.json({ ok: true });
}
