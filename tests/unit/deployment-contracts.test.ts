import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('deployment runtime contracts', () => {
  it('uses CommonJS-compatible rrule interop in Supabase Edge Functions', () => {
    const source = readFileSync('supabase/functions/_shared/recurrence.ts', 'utf8');
    expect(source).toContain("import rrule from 'npm:rrule@2.8.1'");
    expect(source).not.toMatch(/import\s*\{\s*RRule\s*\}\s*from\s*['"]npm:rrule/);
  });

  it('never delivers plan notifications for completed or archived Ideas', () => {
    const source = readFileSync('supabase/functions/check-reminders/index.ts', 'utf8');
    const activeIdeaFilters = source.match(/\.in\('ideas\.status', \['planned', 'in_progress'\]\)/g);
    expect(activeIdeaFilters).toHaveLength(3);
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
