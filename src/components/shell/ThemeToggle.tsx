'use client';

import { Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';

type Theme = 'dark' | 'light';

const STORAGE_KEY = 'atlas-theme';
const CHANGE_EVENT = 'atlas-theme-change';

/**
 * The theme lives on `<html data-theme>`, applied by the inline script in
 * layout.tsx before first paint.
 *
 * That makes the DOM the source of truth, not React — so it is read with
 * `useSyncExternalStore` rather than mirrored into state inside an effect.
 * The effect approach triggers a cascading render on every mount and, more
 * importantly, would let React's copy drift from the attribute the script set.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

function getSnapshot(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/** During SSR there is no DOM. Rendering a placeholder avoids a mismatch. */
function getServerSnapshot(): null {
  return null;
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggle() {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;

    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private browsing can block storage. The toggle still works for this
      // session; it just will not be remembered.
    }

    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  if (theme === null) {
    return <div className="h-9" aria-hidden />;
  }

  const isLight = theme === 'light';

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex min-h-9 w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-secondary transition-colors hover:bg-surface-overlay hover:text-primary"
    >
      {isLight ? (
        <Moon aria-hidden className="size-4 text-tertiary" />
      ) : (
        <Sun aria-hidden className="size-4 text-tertiary" />
      )}
      {isLight ? 'Dark theme' : 'Light theme'}
    </button>
  );
}
