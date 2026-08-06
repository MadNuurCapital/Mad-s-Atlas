'use client';

import { Search } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import type { MemoryCategory } from '@/types/database';

/** Search and category filter, kept in the URL so a view can be linked to. */
export function MemorySearch({ categories }: { categories: MemoryCategory[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <form
      className="mb-6 flex flex-wrap gap-2"
      action={(formData) => setParam('q', String(formData.get('q') ?? ''))}
    >
      <div className="relative min-w-0 flex-1">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-tertiary"
        />
        <input
          name="q"
          defaultValue={searchParams.get('q') ?? ''}
          placeholder="Search memories"
          className="min-h-11 w-full rounded-md border border-line bg-surface-raised pr-3 pl-9 text-sm text-primary placeholder:text-tertiary focus:border-accent focus:outline-none"
        />
      </div>

      <select
        value={searchParams.get('category') ?? ''}
        onChange={(event) => setParam('category', event.target.value)}
        className="min-h-11 rounded-md border border-line bg-surface-raised px-3 text-sm text-primary capitalize focus:border-accent focus:outline-none"
      >
        <option value="">All categories</option>
        {categories.map((category) => (
          <option key={category} value={category}>
            {category.replace('_', ' ')}
          </option>
        ))}
      </select>
    </form>
  );
}
