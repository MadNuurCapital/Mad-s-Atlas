'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

const STATUSES = ['success', 'failure', 'refused', 'timeout'] as const;
const OPERATIONS = ['read', 'analyse', 'propose', 'execute', 'refuse'] as const;
const RANGES = [
  { value: '1', label: 'Last 24 hours' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
] as const;

/**
 * Filters live in the URL so a filtered view can be linked to and survives a
 * refresh. The server re-validates every value against a fixed vocabulary —
 * these controls are convenience, not the boundary.
 */
export function HistoryFilters({ toolNames }: { toolNames: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`${pathname}?${next.toString()}`);
  }

  const hasFilters = ['tool', 'status', 'operation', 'days'].some((k) => searchParams.get(k));

  return (
    <div className="mb-6 flex flex-wrap items-end gap-3">
      <Select
        label="Tool"
        value={searchParams.get('tool') ?? ''}
        onChange={(v) => setFilter('tool', v)}
        options={toolNames.map((name) => ({ value: name, label: name }))}
      />
      <Select
        label="Status"
        value={searchParams.get('status') ?? ''}
        onChange={(v) => setFilter('status', v)}
        options={STATUSES.map((s) => ({ value: s, label: s }))}
      />
      <Select
        label="Type"
        value={searchParams.get('operation') ?? ''}
        onChange={(v) => setFilter('operation', v)}
        options={OPERATIONS.map((o) => ({ value: o, label: o }))}
      />
      <Select
        label="Date"
        value={searchParams.get('days') ?? ''}
        onChange={(v) => setFilter('days', v)}
        options={RANGES.map((r) => ({ value: r.value, label: r.label }))}
      />

      {hasFilters ? (
        <button
          type="button"
          onClick={() => router.push(pathname)}
          className="min-h-11 rounded-md px-3 text-sm text-secondary transition-colors hover:text-primary"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="text-2xs text-tertiary">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 block min-h-11 rounded-md border border-line bg-surface-raised px-3 text-sm text-primary capitalize focus:border-accent focus:outline-none"
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
