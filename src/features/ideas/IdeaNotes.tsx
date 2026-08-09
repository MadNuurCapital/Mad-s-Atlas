'use client';

import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { addNoteAction, deleteNoteAction, editNoteAction } from '@/features/ideas/actions';
import { formatRelative } from '@/lib/time';
import type { IdeaNote } from '@/types/database';

export function IdeaNotes({ ideaId, notes }: { ideaId: string; notes: IdeaNote[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function run(action: (formData: FormData) => Promise<{ ok: boolean; message?: string; error?: string }>, formData: FormData) {
    formData.set('ideaId', ideaId);
    startTransition(async () => {
      const result = await action(formData);
      setMessage(result.ok ? result.message ?? 'Saved.' : result.error ?? 'Could not save.');
      if (result.ok) setEditing(null);
      router.refresh();
    });
  }

  return (
    <div>
      <form action={(formData) => run(addNoteAction, formData)} className="flex gap-2">
        <input name="content" required maxLength={8000} placeholder="Add a note to this Idea…" className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface-inset px-3 text-sm text-primary outline-none placeholder:text-tertiary focus:border-accent" />
        <button type="submit" disabled={pending} className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-line text-accent-text disabled:opacity-50">
          <Plus aria-hidden className="size-4" /><span className="sr-only">Add note</span>
        </button>
      </form>
      {notes.length ? (
        <ul className="mt-4 space-y-2">
          {notes.map((note) => (
            <li key={note.id} className="rounded-xl border border-line-subtle bg-surface-raised p-4">
              {editing === note.id ? (
                <form action={(formData) => { formData.set('noteId', note.id); run(editNoteAction, formData); }}>
                  <textarea name="content" defaultValue={note.content} required maxLength={8000} rows={3} className="w-full rounded-lg border border-line bg-surface-inset p-3 text-sm text-primary outline-none focus:border-accent" />
                  <div className="mt-2 flex gap-2">
                    <button type="submit" disabled={pending} className="min-h-9 rounded-lg bg-surface-accent px-3 text-xs text-accent-text">Save</button>
                    <button type="button" onClick={() => setEditing(null)} className="grid size-9 place-items-center text-tertiary"><X aria-hidden className="size-4" /></button>
                  </div>
                </form>
              ) : (
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-secondary">{note.content}</p>
                    <p className="mt-2 text-2xs text-tertiary">{formatRelative(new Date(note.updated_at))}</p>
                  </div>
                  <button type="button" onClick={() => setEditing(note.id)} className="grid size-10 place-items-center rounded-lg text-tertiary hover:text-primary" aria-label="Edit note"><Pencil aria-hidden className="size-3.5" /></button>
                  <button type="button" onClick={() => { if (!window.confirm('Delete this note?')) return; const fd = new FormData(); fd.set('noteId', note.id); run(deleteNoteAction, fd); }} className="grid size-10 place-items-center rounded-lg text-tertiary hover:text-critical" aria-label="Delete note"><Trash2 aria-hidden className="size-3.5" /></button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="mt-4 text-sm text-tertiary">No notes yet. Notes stay with this Idea and do not enter global Memory.</p>}
      {message ? <p aria-live="polite" className="mt-2 text-xs text-secondary">{message}</p> : null}
    </div>
  );
}
