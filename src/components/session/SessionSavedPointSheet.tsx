import { useState } from 'react';

const POINT_LABELS = ['Start point', 'Vehicle', 'Gate / access', 'Point of interest'] as const;

export function SessionSavedPointSheet(props: {
  defaultLabel?: string;
  onClose: () => void;
  onSave: (label: string, note: string) => Promise<void>;
}) {
  const [label, setLabel] = useState(props.defaultLabel ?? 'Point of interest');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await props.onSave(label, note.trim());
      navigator.vibrate?.(40);
      props.onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not mark this location.');
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
      <div className="mt-4 grid grid-cols-2 gap-2">
        {POINT_LABELS.map(value => <button key={value} type="button" onClick={() => setLabel(value)} className={`min-h-12 rounded-xl border px-3 text-xs font-black ${label === value ? 'border-teal-300 bg-teal-400 text-gray-950' : 'border-white/15 bg-gray-900 text-gray-200'}`}>{value}</button>)}
      </div>
      <label className="mt-4 grid gap-1.5 text-2xs font-black uppercase tracking-widest text-gray-400">Optional note<textarea rows={2} value={note} onChange={event => setNote(event.target.value)} className="rounded-xl border border-white/15 bg-gray-900 p-3 text-sm font-medium normal-case tracking-normal text-white" /></label>
      {error && <p role="alert" className="mt-3 text-xs font-bold text-red-300">{error}</p>}
      <button type="button" disabled={saving} onClick={() => void save()} className="mt-4 min-h-14 w-full rounded-2xl bg-teal-400 text-sm font-black text-gray-950 disabled:opacity-50">{saving ? 'Saving…' : `Save ${label.toLowerCase()}`}</button>
    </section>
  </>;
}
