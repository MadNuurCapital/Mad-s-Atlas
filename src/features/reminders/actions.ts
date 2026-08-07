'use server';

import { revalidatePath } from 'next/cache';

import { requireOwner } from '@/lib/auth/owner';
import { logAction } from '@/lib/data/action-log';
import { createReminder } from '@/lib/data/reminders';
import { createReminderSchema, formatValidationError } from '@/lib/validation/schemas';

export type ReminderActionResult =
  | { ok: true }
  | { ok: false; error: string; fields?: Record<string, string> };

export async function addReminder(formData: FormData): Promise<ReminderActionResult> {
  await requireOwner();
  const parsed = createReminderSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('description') || undefined,
    remind_at: formData.get('remind_at'),
    timezone: formData.get('timezone') || 'Asia/Singapore',
    delivery_channel: 'in_app',
  });

  if (!parsed.success) {
    const { message, fields } = formatValidationError(parsed.error);
    return { ok: false, error: message, fields };
  }

  try {
    await createReminder({
      title: parsed.data.title,
      description: parsed.data.description,
      remindAt: parsed.data.remind_at,
      timezone: parsed.data.timezone,
      deliveryChannel: 'in_app',
    });
    await logAction({ toolName: 'reminders.create', operationType: 'execute', actionSummary: 'Created a reminder', status: 'success' });
    revalidatePath('/reminders');
    revalidatePath('/today');
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not save that reminder. Please try again.' };
  }
}
