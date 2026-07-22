import { useEffect, useRef, useState } from "react";
import type { Field } from "../db";
import { Modal } from "./Modal";
import { saveFieldNotes } from "../services/permissionMutations";

export function FieldNotesModal({
  field,
  readOnly,
  onClose,
}: {
  field: Field;
  readOnly: boolean;
  onClose: () => void;
}) {
  const [draftNotes, setDraftNotes] = useState(field.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraftNotes(field.notes ?? "");
    setError(null);
  }, [field.id, field.notes]);

  useEffect(() => {
    if (readOnly) return;
    const timer = window.setTimeout(() => textareaRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [field.id, readOnly]);

  async function saveNotes() {
    if (readOnly) {
      onClose();
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await saveFieldNotes(field.id, draftNotes.trim(), new Date().toISOString());
      onClose();
    } catch (e: any) {
      setError(e?.message ? `Save failed: ${e.message}` : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Field Notes" onClose={onClose}>
      <div className="grid gap-4">
        <div className="relative pt-3">
          <div
            aria-hidden="true"
            className="absolute left-1/2 top-3 z-10 h-6 w-32 -translate-x-1/2 -translate-y-1/2 -rotate-1 rounded-sm bg-stone-200/75 shadow-sm dark:bg-stone-700/55"
          />
          <div className="relative overflow-hidden rounded-[10px] border border-stone-200 bg-[#f5f1e8] p-5 pt-7 shadow-[0_16px_34px_rgba(68,64,60,0.14),0_1px_0_rgba(255,255,255,0.8)_inset] dark:border-stone-700 dark:bg-[#24221e] dark:shadow-[0_16px_34px_rgba(0,0,0,0.35)]">
            <div
              aria-hidden="true"
              className="absolute bottom-0 right-0 h-12 w-12 bg-[linear-gradient(135deg,transparent_50%,rgba(87,83,78,0.12)_50%)] dark:bg-[linear-gradient(135deg,transparent_50%,rgba(214,211,209,0.10)_50%)]"
            />

            <div className="relative z-10 mb-4 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-widest text-stone-600 dark:text-stone-400">Field note</div>
                <div className="mt-0.5 truncate text-lg font-black leading-tight text-stone-900 dark:text-stone-100">{field.name}</div>
              </div>
              {readOnly && (
                <span className="shrink-0 rounded-full border border-stone-300 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-stone-500 dark:border-stone-700 dark:text-stone-400">
                  Read only
                </span>
              )}
            </div>
            <textarea
              ref={textareaRef}
              value={draftNotes}
              onChange={(e) => setDraftNotes(e.target.value)}
              readOnly={readOnly}
              rows={9}
              placeholder={readOnly ? "No notes for this field." : "Add quick field notes..."}
              style={{
                backgroundImage: "repeating-linear-gradient(to bottom, transparent 0, transparent 29px, rgba(87, 83, 78, 0.14) 30px)",
              }}
              className="relative z-10 min-h-60 w-full resize-none border-0 bg-transparent px-1 py-1 text-[15px] font-medium leading-[30px] text-stone-900 placeholder:text-stone-500/60 focus:outline-none focus:ring-0 dark:text-stone-100 dark:placeholder:text-stone-400/60"
            />
          </div>
        </div>

        {readOnly && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Shared event fields are read-only on member devices.
          </p>
        )}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-sm text-red-700 dark:text-red-300 font-medium">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest text-gray-500 transition-colors hover:text-gray-800 dark:text-gray-300 dark:hover:text-white"
          >
            Close
          </button>
          {!readOnly && (
            <button
              type="button"
              onClick={saveNotes}
              disabled={saving}
              className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-black uppercase tracking-widest text-white shadow-sm shadow-amber-700/20 transition-colors hover:bg-amber-400 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Note"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
