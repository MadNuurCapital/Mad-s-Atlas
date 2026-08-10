import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('deployment runtime contracts', () => {
  it('retires the push worker and unschedules only its cron job', () => {
    expect(existsSync('supabase/functions/check-reminders/index.ts')).toBe(false);
    const migration = readFileSync(
      'supabase/migrations/20260810000015_remove_push_reminder_worker.sql',
      'utf8',
    );
    expect(migration).toContain("jobname = 'check_reminders'");
    expect(migration).toContain('cron.unschedule(v_job_id)');
    expect(migration).not.toMatch(/delete\s+from\s+public\.(ideas|idea_steps|reminders)/i);
  });

  it('does not use a DELETE trigger WHEN clause that references NEW', () => {
    const migration = readFileSync(
      'supabase/migrations/20260809000014_atlas_ideas_planner.sql',
      'utf8',
    );
    expect(migration).not.toMatch(/after insert or update or delete[\s\S]{0,200}when\s*\([^)]*new\./i);
    expect(migration).toContain("if tg_op = 'DELETE' then");
  });
});
