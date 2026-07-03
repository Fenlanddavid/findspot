import React from 'react';
import { v4 as uuid } from 'uuid';
import { db } from '../db';
import type { UndugSignalDirection, UndugSignalStability, UndugSignalConditions } from '../db';

type Props = {
  sessionId?: string | null;
  permissionId?: string | null;
  onSaved: (signalId: string, openCount: number) => void;
  onClose: () => void;
};

function toggle<T>(current: T | undefined, value: T): T | undefined {
  return current === value ? undefined : value;
}

type GPSFix = { lat: number; lng: number; accuracy: number };

function SignalMarkerIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M10 2.25c-2.42 0-4.4 1.9-4.4 4.25 0 3.15 3.35 6.35 4.05 6.98.2.18.5.18.7 0 .7-.63 4.05-3.83 4.05-6.98 0-2.35-1.98-4.25-4.4-4.25Z" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="10" cy="6.6" r="1.35" fill="currentColor" />
      <path d="M5.1 14.5c1.22.78 2.9 1.25 4.9 1.25s3.68-.47 4.9-1.25M7.65 12.85c.68.26 1.48.4 2.35.4s1.67-.14 2.35-.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function UndugSignalSheet({ sessionId, permissionId, onSaved, onClose }: Props) {
  const [fix, setFix] = React.useState<GPSFix | null>(null);
  const [gpsError, setGpsError] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const hasFixRef = React.useRef(false);

  const [direction, setDirection] = React.useState<UndugSignalDirection | undefined>();
  const [stability, setStability] = React.useState<UndugSignalStability | undefined>();
  const [conditions, setConditions] = React.useState<UndugSignalConditions | undefined>();
  const [vdi, setVdi] = React.useState('');
  const [notes, setNotes] = React.useState('');

  // Watch position continuously — keep best (lowest accuracy value) fix
  React.useEffect(() => {
    if (!('geolocation' in navigator)) {
      setGpsError(true);
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        hasFixRef.current = true;
        setGpsError(false);
        const acc = Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : Infinity;
        setFix(f => {
          if (!f || acc < f.accuracy) {
            return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: acc };
          }
          return f;
        });
      },
      () => { if (!hasFixRef.current) setGpsError(true); },
      { enableHighAccuracy: true, maximumAge: 0 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  async function handleSave() {
    if (!fix || isSaving) return;
    // Debounce: isSaving gate prevents duplicate records
    setIsSaving(true);
    try {
      const id = uuid();
      await db.undugSignals.add({
        id,
        createdAt: Date.now(),
        lat: fix.lat,
        lng: fix.lng,
        gpsAccuracy: fix.accuracy < Infinity ? fix.accuracy : undefined,
        sessionId: sessionId ?? undefined,
        permissionId: permissionId ?? undefined,
        direction,
        stability,
        conditions,
        vdi: vdi.trim() || undefined,
        notes: notes.trim() || undefined,
        status: 'open',
      });
      const openCount = permissionId
        ? await db.undugSignals.where('[permissionId+status]').equals([permissionId, 'open']).count()
        : 0;
      onSaved(id, openCount);
    } finally {
      setIsSaving(false);
    }
  }

  const canSave = !!fix && !isSaving;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/45 z-[119] backdrop-blur-[2px]" onClick={onClose} />

      {/* Sheet */}
      <div className="fixed inset-x-0 bottom-0 z-[120] bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800 rounded-t-3xl shadow-[0_-18px_60px_rgba(15,23,42,0.28)] animate-in slide-in-from-bottom-4 duration-200 pb-[env(safe-area-inset-bottom)] sm:left-1/2 sm:right-auto sm:w-[min(32rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:border-x sm:border-b-0">
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-gray-200 dark:bg-gray-800" />
        </div>

        <div className="max-h-[82vh] overflow-y-auto">
          {/* Header */}
          <div className="mx-4 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3 shadow-sm dark:border-emerald-900/70 dark:bg-emerald-950/20">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-white dark:bg-gray-950 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-700 dark:text-emerald-300 shrink-0 shadow-sm">
                <SignalMarkerIcon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-black uppercase tracking-widest text-gray-900 dark:text-white">Log Signal</h2>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-snug">Mark a target you chose not to dig.</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full border border-emerald-200 bg-white/80 dark:bg-gray-950 dark:border-emerald-900 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-white dark:hover:bg-gray-900 leading-none flex items-center justify-center shrink-0"
              aria-label="Close"
            >
              ✕
            </button>
            </div>
          </div>

          {/* GPS status pill */}
          <div className={`mx-4 mt-4 rounded-xl px-3 py-2.5 flex items-center justify-between gap-3 border ${
            fix
              ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800'
              : gpsError
                ? 'bg-red-50 border-red-200 dark:bg-red-950/40 dark:border-red-800'
                : 'bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-800'
          }`}>
            <div className="flex items-center gap-2 min-w-0">
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                fix ? 'bg-emerald-400' : gpsError ? 'bg-red-400' : 'bg-amber-400 animate-pulse'
              }`} />
              <span className={`text-xs font-black uppercase tracking-widest ${
                fix ? 'text-emerald-700 dark:text-emerald-300' : gpsError ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'
              }`}>
                {fix ? 'GPS locked' : gpsError ? 'GPS unavailable' : 'Waiting for GPS'}
              </span>
            </div>
            {fix && (
              <span className="shrink-0 rounded-full bg-white/80 dark:bg-gray-950/70 border border-emerald-100 dark:border-emerald-900 px-2 py-0.5 text-2xs font-black text-emerald-700 dark:text-emerald-300">
                ±{fix.accuracy < 100 ? Math.round(fix.accuracy) : '>100'}m
              </span>
            )}
          </div>

          <div className="mx-4 mt-4 rounded-2xl border border-gray-200 bg-gray-50/80 p-3 dark:border-gray-800 dark:bg-gray-900/45">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-2xs font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">Signal reading</span>
              <span className="text-3xs font-bold uppercase tracking-widest text-gray-400 dark:text-gray-600">Optional</span>
            </div>

            {/* VDI */}
            <div className="space-y-1">
              <label className="text-2xs font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">VDI</label>
              <input
                type="text"
                inputMode="decimal"
                value={vdi}
                onChange={e => setVdi(e.target.value)}
                placeholder="e.g. 78"
                className="w-full bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl px-3 py-2.5 text-sm font-bold text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
              />
            </div>

            {/* Direction */}
            <div className="mt-4 space-y-1.5">
              <span className="text-2xs font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">Direction</span>
              <div className="grid grid-cols-2 gap-2">
                {(['one-way', 'two-way'] as UndugSignalDirection[]).map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDirection(v => toggle(v, d))}
                    className={`min-h-10 rounded-xl text-xs font-black border transition-all ${
                      direction === d
                        ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm'
                        : 'bg-white dark:bg-gray-950 border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:border-emerald-300 dark:hover:border-emerald-700'
                    }`}
                  >
                    {d === 'one-way' ? 'One-way' : 'Two-way'}
                  </button>
                ))}
              </div>
            </div>

            {/* Stability */}
            <div className="mt-4 space-y-1.5">
              <span className="text-2xs font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">Stability</span>
              <div className="grid grid-cols-3 gap-2">
                {(['repeatable', 'inconsistent', 'broken'] as UndugSignalStability[]).map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStability(v => toggle(v, s))}
                    className={`min-h-10 rounded-xl px-1 text-2xs font-black border transition-all ${
                      stability === s
                        ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm'
                        : 'bg-white dark:bg-gray-950 border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:border-emerald-300 dark:hover:border-emerald-700'
                    }`}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Conditions */}
            <div className="mt-4 space-y-1.5">
              <span className="text-2xs font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">Conditions</span>
              <div className="grid grid-cols-3 gap-2">
                {(['dry', 'wet', 'ploughed'] as UndugSignalConditions[]).map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setConditions(v => toggle(v, c))}
                    className={`min-h-10 rounded-xl text-xs font-black border transition-all ${
                      conditions === c
                        ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm'
                        : 'bg-white dark:bg-gray-950 border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:border-emerald-300 dark:hover:border-emerald-700'
                    }`}
                  >
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="mx-4 mt-4 space-y-1">
            <label className="text-2xs font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any details worth noting…"
              rows={3}
              className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-3 py-2.5 text-xs text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 resize-none"
            />
          </div>

          {/* Save / Cancel */}
          <div className="sticky bottom-0 mt-4 flex gap-3 border-t border-gray-100 bg-white/95 px-4 py-3 backdrop-blur dark:border-gray-900 dark:bg-gray-950/95">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-3 rounded-xl text-xs font-black uppercase tracking-widest bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className={`flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                canSave
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white active:scale-95 shadow-lg shadow-emerald-600/20'
                  : 'bg-gray-100 dark:bg-gray-900 text-gray-400 dark:text-gray-600 cursor-not-allowed'
              }`}
            >
              {isSaving ? 'Saving…' : canSave ? 'Save signal' : 'Waiting for GPS…'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
