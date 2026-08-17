import React from 'react';
import type { Field } from '../../db';

type SessionStartField = Pick<Field, 'id' | 'name'>;

export function NewSessionStartCard({
  permissionName,
  fields,
  fieldId,
  landUse,
  isStubble,
  notes,
  saving,
  onFieldChange,
  onLandUseChange,
  onStubbleChange,
  onNotesChange,
  onStart,
  onBack,
}: {
  permissionName: string;
  fields: SessionStartField[];
  fieldId: string | null;
  landUse: string;
  isStubble: boolean;
  notes: string;
  saving: boolean;
  onFieldChange: (fieldId: string | null) => void;
  onLandUseChange: (landUse: string) => void;
  onStubbleChange: (isStubble: boolean) => void;
  onNotesChange: (notes: string) => void;
  onStart: () => void;
  onBack: () => void;
}) {
  const selectedField = fields.find(field => field.id === fieldId);
  const hasOptionalDetails = isStubble || !!landUse || !!notes.trim();

  return (
    <section
      aria-labelledby="start-visit-title"
      className="overflow-hidden rounded-3xl border border-emerald-200/80 bg-white shadow-xl shadow-emerald-950/[0.06] dark:border-emerald-900/70 dark:bg-gray-900"
    >
      <div className="relative overflow-hidden bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-800 px-5 pb-6 pt-5 text-white sm:px-7 sm:pb-7 sm:pt-6">
        <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full border-[28px] border-white/[0.04]" />
        <div className="pointer-events-none absolute -bottom-16 right-12 h-36 w-36 rounded-full bg-teal-300/[0.06] blur-xl" />

        <div className="relative flex items-center justify-between gap-4">
          <p className="m-0 text-2xs font-black uppercase tracking-[0.2em] text-emerald-200">Start a visit</p>
          <button
            type="button"
            onClick={onBack}
            className="rounded-xl border border-white/15 bg-white/[0.06] px-3 py-2 text-2xs font-black text-white/75 transition-colors hover:bg-white/10 hover:text-white"
          >
            Back
          </button>
        </div>

        <div className="relative mt-8 flex items-start gap-3">
          <span className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-400 text-emerald-950 shadow-lg shadow-black/20" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12" />
              <path d="m8 7 4-4 4 4" />
              <path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
            </svg>
          </span>
          <div className="min-w-0">
            <h1 id="start-visit-title" className="m-0 break-words text-2xl font-black leading-tight tracking-tight sm:text-3xl">
              {permissionName}
            </h1>
            <p className="mt-2 text-sm font-semibold leading-relaxed text-emerald-100/75">
              Your visit starts now. Trail and recording tools will use GPS when you ask them to.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-4 sm:p-6">
        <div className="rounded-2xl border border-gray-200 bg-gray-50/80 p-4 dark:border-gray-800 dark:bg-gray-950/45">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="m-0 text-2xs font-black uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">Area for this visit</p>
              {fields.length <= 1 && (
                <p className="mt-1.5 text-base font-black text-gray-900 dark:text-gray-100">
                  {selectedField?.name ?? 'Whole permission'}
                </p>
              )}
            </div>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-3xs font-black uppercase tracking-widest text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
              {selectedField ? 'Field' : 'Permission'}
            </span>
          </div>

          {fields.length > 1 && (
            <label className="mt-3 block">
              <span className="sr-only">Area for this visit</span>
              <div className="relative">
                <select
                  value={fieldId ?? ''}
                  onChange={event => onFieldChange(event.target.value || null)}
                  className="min-h-12 w-full appearance-none rounded-xl border border-gray-300 bg-white py-3 pl-3.5 pr-10 text-sm font-bold text-gray-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                >
                  <option value="">Whole permission</option>
                  {fields.map(field => <option key={field.id} value={field.id}>{field.name}</option>)}
                </select>
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400">
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
                </svg>
              </div>
              <span className="mt-2 block text-xs font-medium text-gray-500 dark:text-gray-400">Choose a field for the most useful boundary and Guide context.</span>
            </label>
          )}
        </div>

        <details className="group rounded-2xl border border-gray-200 bg-white open:bg-gray-50/70 dark:border-gray-800 dark:bg-gray-900 dark:open:bg-gray-950/35">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 marker:hidden">
            <div>
              <span className="block text-sm font-black text-gray-800 dark:text-gray-100">Ground condition &amp; note</span>
              <span className="mt-0.5 block text-xs font-medium text-gray-500 dark:text-gray-400">Optional — you can add these during the visit</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {hasOptionalDetails && <span className="h-2 w-2 rounded-full bg-emerald-500" aria-label="Optional details added" />}
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-180">
                <path d="m5 7.5 5 5 5-5" />
              </svg>
            </div>
          </summary>

          <div className="grid gap-4 border-t border-gray-200 px-4 pb-4 pt-4 dark:border-gray-800">
            <div>
              <p className="mb-2 text-2xs font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">Ground today</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => onStubbleChange(!isStubble)} className={`rounded-xl border px-3 py-2 text-xs font-black transition-colors ${isStubble ? 'border-amber-300 bg-amber-100 text-amber-900' : 'border-gray-200 bg-white text-gray-500 hover:border-amber-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400'}`}>Stubble</button>
                <button type="button" onClick={() => onLandUseChange(landUse === 'Ploughed' ? '' : 'Ploughed')} className={`rounded-xl border px-3 py-2 text-xs font-black transition-colors ${landUse === 'Ploughed' ? 'border-orange-300 bg-orange-100 text-orange-900' : 'border-gray-200 bg-white text-gray-500 hover:border-orange-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400'}`}>Ploughed</button>
                <button type="button" onClick={() => onLandUseChange(landUse === 'Pasture' ? '' : 'Pasture')} className={`rounded-xl border px-3 py-2 text-xs font-black transition-colors ${landUse === 'Pasture' ? 'border-emerald-300 bg-emerald-100 text-emerald-900' : 'border-gray-200 bg-white text-gray-500 hover:border-emerald-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400'}`}>Pasture</button>
              </div>
            </div>

            <label>
              <span className="mb-2 block text-2xs font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">Visit note</span>
              <textarea
                value={notes}
                onChange={event => onNotesChange(event.target.value)}
                rows={2}
                placeholder="Anything useful to remember…"
                className="w-full resize-y rounded-xl border border-gray-300 bg-white p-3 text-sm font-medium text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />
            </label>
          </div>
        </details>

        <button
          type="button"
          onClick={onStart}
          disabled={saving}
          className="group flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl bg-emerald-500 px-5 py-4 text-base font-black text-emerald-950 shadow-lg shadow-emerald-900/15 transition-all hover:bg-emerald-400 active:scale-[0.99] disabled:cursor-wait disabled:opacity-60"
        >
          <span>{saving ? 'Starting…' : 'Start detecting'}</span>
          {!saving && (
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5 transition-transform group-hover:translate-x-0.5">
              <path d="M4 10h12M11 5l5 5-5 5" />
            </svg>
          )}
        </button>
      </div>
    </section>
  );
}
