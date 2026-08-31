import { useState } from 'react';
import type { SurfaceExtent } from '../../db';
import { SURFACE_EXTENT_LABELS } from '../../services/surfaceScatter';

const POINT_LABELS = ['Start point', 'Vehicle', 'Gate / access', 'Point of interest'] as const;
const PATCH_EXTENTS: readonly SurfaceExtent[] = ['small_patch', 'approx_10m', 'approx_25m', 'widespread'];

export function SessionSavedPointSheet(props: {
  defaultLabel?: string;
  onClose: () => void;
  onSave: (label: string, note: string) => Promise<void>;
  onSaveIronPatch: (extent: SurfaceExtent, note: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<'point' | 'iron_patch'>('point');
  const [label, setLabel] = useState(props.defaultLabel ?? 'Point of interest');
  const [extent, setExtent] = useState<SurfaceExtent>('approx_10m');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (kind === 'iron_patch') await props.onSaveIronPatch(extent, note.trim());
      else await props.onSave(label, note.trim());
      navigator.vibrate?.(40);
      props.onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not save this ${kind === 'iron_patch' ? 'patch' : 'location'}.`);
      setSaving(false);
    }
  }

  return <>
    <button type="button" aria-label="Close mark location" onClick={props.onClose} className="fixed inset-0 z-[119] bg-black/55" />
    <section role="dialog" aria-modal="true" aria-labelledby="mark-location-title" className="fixed inset-x-0 bottom-0 z-[120] rounded-t-3xl border-t border-white/15 bg-gray-950 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-white sm:left-1/2 sm:right-auto sm:w-[min(30rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:border-x">
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-3xs font-black uppercase tracking-widest text-teal-300">Current GPS position</p><h2 id="mark-location-title" className="mt-1 text-lg font-black">Mark location</h2></div>
        <button type="button" onClick={props.onClose} aria-label="Close" className="grid min-h-11 min-w-11 place-items-center rounded-full border border-white/15">×</button>
      </div>
      <div className="mt-4 grid grid-cols-2 rounded-xl border border-white/15 bg-gray-900 p-1" aria-label="Location type">
        <button type="button" aria-pressed={kind === 'point'} onClick={() => { setKind('point'); setError(null); }} className={`min-h-11 rounded-lg px-3 text-xs font-black ${kind === 'point' ? 'bg-teal-400 text-gray-950' : 'text-gray-300'}`}>Saved point</button>
        <button type="button" aria-pressed={kind === 'iron_patch'} onClick={() => { setKind('iron_patch'); setError(null); }} className={`min-h-11 rounded-lg px-3 text-xs font-black ${kind === 'iron_patch' ? 'bg-orange-400 text-gray-950' : 'text-gray-300'}`}>Iron / junk area</button>
      </div>
      {kind === 'point' ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {POINT_LABELS.map(value => <button key={value} type="button" onClick={() => setLabel(value)} className={`min-h-12 rounded-xl border px-3 text-xs font-black ${label === value ? 'border-teal-300 bg-teal-400 text-gray-950' : 'border-white/15 bg-gray-900 text-gray-200'}`}>{value}</button>)}
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-2xs font-black uppercase tracking-widest text-gray-400">Approximate spread</p>
          <p className="mt-1 text-2xs font-semibold text-gray-500">A field note, not a measured boundary.</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {PATCH_EXTENTS.map(value => <button key={value} type="button" aria-pressed={extent === value} onClick={() => setExtent(value)} className={`min-h-12 rounded-xl border px-3 text-xs font-black ${extent === value ? 'border-orange-300 bg-orange-400 text-gray-950' : 'border-white/15 bg-gray-900 text-gray-200'}`}>{SURFACE_EXTENT_LABELS[value]}</button>)}
          </div>
        </div>
      )}
      <label className="mt-4 grid gap-1.5 text-2xs font-black uppercase tracking-widest text-gray-400">Optional note<textarea rows={2} value={note} onChange={event => setNote(event.target.value)} className="rounded-xl border border-white/15 bg-gray-900 p-3 text-sm font-medium normal-case tracking-normal text-white" /></label>
      {error && <p role="alert" className="mt-3 text-xs font-bold text-red-300">{error}</p>}
      <button type="button" disabled={saving} onClick={() => void save()} className={`mt-4 min-h-14 w-full rounded-2xl text-sm font-black text-gray-950 disabled:opacity-50 ${kind === 'iron_patch' ? 'bg-orange-400' : 'bg-teal-400'}`}>{saving ? 'Saving…' : kind === 'iron_patch' ? 'Save iron / junk area' : `Save ${label.toLowerCase()}`}</button>
    </section>
  </>;
}
