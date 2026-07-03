// ─── Undug Signal Log ──────────────────────────────────────────────────────────
// Permission-scoped revisit list and detail sheet for un-dug signals.
// UndugSignalLogSection: embeds in PermissionActivityColumn.
// UndugSignalDetailSheet: full-screen bottom sheet for a single signal.

import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { UndugSignal, UndugSignalDirection, UndugSignalStability, UndugSignalConditions, UndugSignalDugNothingCause } from '../db';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(epochMs: number): string {
  const diffS = Math.floor((Date.now() - epochMs) / 1000);
  if (diffS < 60) return 'just now';
  const diffM = Math.floor(diffS / 60);
  if (diffM < 60) return `${diffM}m ago`;
  const diffH = Math.floor(diffM / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return new Date(epochMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function chipSummary(s: UndugSignal): string {
  const parts: string[] = [];
  if (s.direction) parts.push(s.direction === 'one-way' ? 'One-way' : 'Two-way');
  if (s.stability) parts.push(s.stability.charAt(0).toUpperCase() + s.stability.slice(1));
  if (s.vdi) parts.push(`VDI ${s.vdi}`);
  if (s.conditions) parts.push(s.conditions.charAt(0).toUpperCase() + s.conditions.slice(1));
  return parts.join(' · ');
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistanceM(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

function toggle<T>(current: T | undefined, value: T): T | undefined {
  return current === value ? undefined : value;
}

const DUG_NOTHING_CAUSES: { value: UndugSignalDugNothingCause; label: string }[] = [
  { value: 'iron', label: 'Iron' },
  { value: 'ground-noise', label: 'Ground noise' },
  { value: 'could-not-locate', label: "Couldn't locate" },
  { value: 'other', label: 'Other' },
];

function SignalMarkerIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M10 2.25c-2.42 0-4.4 1.9-4.4 4.25 0 3.15 3.35 6.35 4.05 6.98.2.18.5.18.7 0 .7-.63 4.05-3.83 4.05-6.98 0-2.35-1.98-4.25-4.4-4.25Z" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="10" cy="6.6" r="1.35" fill="currentColor" />
      <path d="M5.1 14.5c1.22.78 2.9 1.25 4.9 1.25s3.68-.47 4.9-1.25M7.65 12.85c.68.26 1.48.4 2.35.4s1.67-.14 2.35-.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function signalChips(signal: UndugSignal): string[] {
  const chips: string[] = [];
  if (signal.direction) chips.push(signal.direction === 'one-way' ? 'One-way' : 'Two-way');
  if (signal.stability) chips.push(signal.stability.charAt(0).toUpperCase() + signal.stability.slice(1));
  if (signal.conditions) chips.push(signal.conditions.charAt(0).toUpperCase() + signal.conditions.slice(1));
  if (signal.vdi) chips.push(`VDI ${signal.vdi}`);
  return chips;
}

// ─── Signal row ────────────────────────────────────────────────────────────────

function SignalRow({
  signal,
  currentPos,
  onTap,
}: {
  signal: UndugSignal;
  currentPos: { lat: number; lng: number } | null;
  onTap: () => void;
}) {
  const summary = chipSummary(signal);
  const chips = signalChips(signal);
  const dist =
    currentPos && signal.lat != null && signal.lng != null
      ? haversineM(currentPos.lat, currentPos.lng, signal.lat, signal.lng)
      : null;

  return (
    <button
      type="button"
      onClick={onTap}
      className="w-full text-left flex items-center justify-between gap-3 bg-white dark:bg-gray-900/70 hover:bg-emerald-50/60 dark:hover:bg-emerald-950/20 border border-gray-200 dark:border-gray-800 hover:border-emerald-200 dark:hover:border-emerald-800 rounded-xl px-3 py-3 transition-all group shadow-sm"
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900 flex items-center justify-center text-emerald-700 dark:text-emerald-300 shrink-0 group-hover:scale-[1.03] transition-transform">
          <SignalMarkerIcon className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <div className="text-xs text-gray-800 dark:text-gray-100 font-black truncate">
              {summary || 'Signal logged'}
            </div>
            {dist !== null && (
              <span className="shrink-0 text-[9px] font-black text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900 rounded-full px-1.5 py-0.5">
                {formatDistanceM(dist)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-2xs text-gray-400 dark:text-gray-500">{relativeTime(signal.createdAt)}</span>
            {chips.slice(0, 3).map(chip => (
              <span key={chip} className="hidden sm:inline text-[9px] font-bold text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-950 border border-gray-100 dark:border-gray-800 rounded px-1.5 py-0.5">
                {chip}
              </span>
            ))}
          </div>
        </div>
      </div>
      <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="shrink-0 text-gray-300 dark:text-gray-600 group-hover:text-emerald-500 transition-colors">
        <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

// ─── Detail sheet ──────────────────────────────────────────────────────────────

export function UndugSignalDetailSheet({
  signal,
  onClose,
  onConvertToFind,
}: {
  signal: UndugSignal;
  onClose: () => void;
  /** Called by step-5 resolution: navigate to find-recording flow */
  onConvertToFind?: (signal: UndugSignal) => void;
}) {
  const [mode, setMode] = React.useState<'view' | 'edit' | 'dug-nothing'>('view');
  const [isSaving, setIsSaving] = React.useState(false);

  // Edit state
  const [direction, setDirection] = React.useState<UndugSignalDirection | undefined>(signal.direction);
  const [stability, setStability] = React.useState<UndugSignalStability | undefined>(signal.stability);
  const [conditions, setConditions] = React.useState<UndugSignalConditions | undefined>(signal.conditions);
  const [vdi, setVdi] = React.useState(signal.vdi ?? '');
  const [notes, setNotes] = React.useState(signal.notes ?? '');

  // Dug-nothing cause selection
  const [selectedCause, setSelectedCause] = React.useState<UndugSignalDugNothingCause | undefined>();

  async function handleSaveEdit() {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await db.undugSignals.update(signal.id, {
        direction,
        stability,
        conditions,
        vdi: vdi.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      setMode('view');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDismiss() {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await db.undugSignals.update(signal.id, { status: 'dismissed', resolvedAt: Date.now() });
      onClose();
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDugNothing() {
    if (!selectedCause || isSaving) return;
    setIsSaving(true);
    try {
      await db.undugSignals.update(signal.id, {
        status: 'dug-nothing',
        resolvedAt: Date.now(),
        dugNothingCause: selectedCause,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  }

  const summary = chipSummary(signal);

  return (
    <>
      <div className="fixed inset-0 bg-black/45 z-[119] backdrop-blur-[2px]" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-[120] bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800 rounded-t-2xl shadow-[0_-18px_60px_rgba(15,23,42,0.28)] animate-in slide-in-from-bottom-4 duration-200 pb-[env(safe-area-inset-bottom)]">
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-gray-200 dark:bg-gray-800" />
        </div>

        <div className="px-4 pb-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-700 dark:text-emerald-300 shrink-0">
                <SignalMarkerIcon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-black uppercase tracking-widest text-gray-900 dark:text-white">Signal Detail</h2>
                <p className="text-2xs text-gray-500 dark:text-gray-400 mt-0.5">{relativeTime(signal.createdAt)}</p>
              </div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full border border-gray-200 dark:border-gray-800 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-900 leading-none flex items-center justify-center shrink-0" aria-label="Close">✕</button>
          </div>

          {mode === 'view' && (
            <>
              {/* Summary chips */}
              {summary && (
                <div className="flex flex-wrap gap-1.5">
                  {signalChips(signal).map(chip => (
                    <span key={chip} className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 px-2 py-1 text-2xs font-bold text-gray-600 dark:text-gray-300">
                      {chip}
                    </span>
                  ))}
                </div>
              )}
              {signal.notes && (
                <div className="text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 rounded-xl px-3 py-2 border border-gray-200 dark:border-gray-800">{signal.notes}</div>
              )}
              {signal.gpsAccuracy != null && (
                <div className="text-2xs text-gray-400 dark:text-gray-500">GPS ±{Math.round(signal.gpsAccuracy)}m</div>
              )}

              {/* Action buttons */}
              <div className="space-y-2 pt-1">
                {onConvertToFind && (
                  <button
                    type="button"
                    onClick={() => onConvertToFind(signal)}
                    className="w-full py-3 rounded-xl text-xs font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-lg shadow-emerald-600/20"
                  >
                    Dug — found something
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setMode('dug-nothing')}
                  className="w-full py-3 rounded-xl text-xs font-black uppercase tracking-widest bg-gray-100 dark:bg-gray-900 hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 transition-all"
                >
                  Dug — nothing there
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setMode('edit')}
                    className="flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:border-emerald-300 dark:hover:border-emerald-700 text-gray-600 dark:text-gray-300 transition-all"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={handleDismiss}
                    disabled={isSaving}
                    className="flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-all disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </>
          )}

          {mode === 'dug-nothing' && (
            <>
              <p className="text-xs font-bold text-gray-600 dark:text-gray-300">Why nothing found?</p>
              <div className="grid grid-cols-2 gap-2">
                {DUG_NOTHING_CAUSES.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSelectedCause(v => toggle(v, value))}
                    className={`py-2.5 rounded-xl text-xs font-semibold border transition-all ${
                      selectedCause === value
                        ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm'
                        : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:border-emerald-300 dark:hover:border-emerald-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setMode('view')}
                  className="flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-widest bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 transition-all"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleDugNothing}
                  disabled={!selectedCause || isSaving}
                  className={`flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                    selectedCause && !isSaving
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20'
                      : 'bg-gray-100 dark:bg-gray-900 text-gray-400 dark:text-gray-600 cursor-not-allowed'
                  }`}
                >
                  Confirm
                </button>
              </div>
            </>
          )}

          {mode === 'edit' && (
            <>
              {/* VDI */}
              <div className="space-y-1">
                <label className="text-2xs font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">VDI</label>
                <input type="text" inputMode="decimal" value={vdi} onChange={e => setVdi(e.target.value)} placeholder="e.g. 78"
                  className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-2 text-xs text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-emerald-500" />
              </div>
              {/* Direction */}
              <div className="space-y-1.5">
                <span className="text-2xs font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">Direction</span>
                <div className="flex gap-2">
                  {(['one-way', 'two-way'] as UndugSignalDirection[]).map(d => (
                    <button key={d} type="button" onClick={() => setDirection(v => toggle(v, d))}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${direction === d ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm' : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:border-emerald-300 dark:hover:border-emerald-700'}`}>
                      {d === 'one-way' ? 'One-way' : 'Two-way'}
                    </button>
                  ))}
                </div>
              </div>
              {/* Stability */}
              <div className="space-y-1.5">
                <span className="text-2xs font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">Stability</span>
                <div className="flex gap-2 flex-wrap">
                  {(['repeatable', 'inconsistent', 'broken'] as UndugSignalStability[]).map(s => (
                    <button key={s} type="button" onClick={() => setStability(v => toggle(v, s))}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${stability === s ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm' : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:border-emerald-300 dark:hover:border-emerald-700'}`}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              {/* Conditions */}
              <div className="space-y-1.5">
                <span className="text-2xs font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">Conditions</span>
                <div className="flex gap-2">
                  {(['dry', 'wet', 'ploughed'] as UndugSignalConditions[]).map(c => (
                    <button key={c} type="button" onClick={() => setConditions(v => toggle(v, c))}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${conditions === c ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm' : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:border-emerald-300 dark:hover:border-emerald-700'}`}>
                      {c.charAt(0).toUpperCase() + c.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              {/* Notes */}
              <div className="space-y-1">
                <label className="text-2xs font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                  className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-2 text-xs text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-emerald-500 resize-none" />
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setMode('view')}
                  className="flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-widest bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 transition-all">
                  Cancel
                </button>
                <button type="button" onClick={handleSaveEdit} disabled={isSaving}
                  className="flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-lg shadow-emerald-600/20 disabled:opacity-50">
                  {isSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Signal log section ────────────────────────────────────────────────────────

export function UndugSignalLogSection({
  permissionId,
  onConvertToFind,
}: {
  permissionId: string | undefined;
  /** Wired in step 5: opens the find-recording flow pre-populated with signal data */
  onConvertToFind?: (signal: UndugSignal) => void;
}) {
  const [selectedSignal, setSelectedSignal] = React.useState<UndugSignal | null>(null);
  const [currentPos, setCurrentPos] = React.useState<{ lat: number; lng: number } | null>(null);

  // One-shot GPS for distance display
  React.useEffect(() => {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      pos => setCurrentPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, maximumAge: 30000 },
    );
  }, []);

  const signals = useLiveQuery(
    () => {
      if (!permissionId) return Promise.resolve([] as UndugSignal[]);
      return db.undugSignals
        .where('[permissionId+status]')
        .equals([permissionId, 'open'])
        .reverse()
        .sortBy('createdAt');
    },
    [permissionId],
  );

  if (!permissionId || !signals || signals.length === 0) return null;

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900 flex items-center justify-center text-emerald-700 dark:text-emerald-300 shrink-0">
            <SignalMarkerIcon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-black text-gray-900 dark:text-gray-100 m-0 uppercase tracking-tight">Signal Log</h3>
            <p className="text-2xs text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">Targets marked for a later pass.</p>
          </div>
        </div>
        <div className="shrink-0 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
          {signals.length} open
        </div>
      </div>

      <div className="grid gap-2">
        {signals.map(s => (
          <SignalRow
            key={s.id}
            signal={s}
            currentPos={currentPos}
            onTap={() => setSelectedSignal(s)}
          />
        ))}
      </div>
      <p className="text-[9px] text-gray-400 dark:text-gray-500 text-center italic mt-3 font-medium px-2 leading-tight">
        Open signals stay here until they are converted, dismissed, or marked as nothing found.
      </p>

      {/* Detail sheet */}
      {selectedSignal && (
        <UndugSignalDetailSheet
          signal={selectedSignal}
          onClose={() => setSelectedSignal(null)}
          onConvertToFind={onConvertToFind ? sig => { setSelectedSignal(null); onConvertToFind(sig); } : undefined}
        />
      )}
    </div>
  );
}
