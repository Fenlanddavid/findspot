import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { v4 as uuid } from 'uuid';
import type { Find, Media } from '../../db';
import { saveQuickFind } from '../../services/findMutations';
import { fileToBlob } from '../../services/photos';
import { captureGPS } from '../../services/gps';
import type { QuickFindLocation } from '../QuickFindFab';

type QuickFindCategory = NonNullable<Find['findCategory']>;

const CATEGORIES: QuickFindCategory[] = ['Coin', 'Artefact', 'Jewellery', 'Button / Fastener', 'Other'];

export function SessionQuickFindSheet(props: {
  projectId: string;
  permissionId: string;
  sessionId: string;
  fieldId: string | null;
  permissionName: string;
  getPreferredLocation: () => QuickFindLocation | null;
  onClose: () => void;
  onSaved: (findId: string, pending: boolean) => void;
  onAddDetails: (findId: string) => void;
}) {
  const [location, setLocation] = useState<QuickFindLocation | null>(() => props.getPreferredLocation());
  const [gpsState, setGpsState] = useState<'waiting' | 'locked' | 'unavailable'>(() => location ? 'locked' : 'waiting');
  const [objectType, setObjectType] = useState('');
  const [category, setCategory] = useState<QuickFindCategory | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshingLocation, setRefreshingLocation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const saveIdRef = useRef<string | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== 'Tab' || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter(element => element.offsetParent !== null);
      if (focusable.length === 0) { event.preventDefault(); panel.focus(); return; }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    if (location) return;
    let cancelled = false;
    void captureGPS().then(fix => {
      if (cancelled) return;
      setLocation({ lat: fix.lat, lon: fix.lon, gpsAccuracyM: fix.accuracyM, fixTimestamp: fix.fixTimestamp, captureMethod: 'live_gps' });
      setGpsState('locked');
    }).catch(() => {
      if (!cancelled) setGpsState('unavailable');
    });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshLocation() {
    if (refreshingLocation) return;
    setRefreshingLocation(true);
    setGpsState('waiting');
    try {
      const fix = await captureGPS();
      setLocation({ lat: fix.lat, lon: fix.lon, gpsAccuracyM: fix.accuracyM, fixTimestamp: fix.fixTimestamp, captureMethod: 'live_gps' });
      setGpsState('locked');
    } catch {
      setGpsState(location ? 'locked' : 'unavailable');
      setError('Could not refresh the position. The frozen position is unchanged.');
    } finally {
      setRefreshingLocation(false);
    }
  }

  async function save(pending: boolean, addDetails = false) {
    if (savingRef.current) return;
    if (!pending && !objectType.trim() && !category) {
      setError('Add an object description or choose a type, or save it for later.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const id = saveIdRef.current ?? uuid();
    saveIdRef.current = id;
    const now = new Date().toISOString();
    try {
      let media: Media | undefined;
      if (photo) {
        const blob = await fileToBlob(photo);
        media = {
          id: uuid(), projectId: props.projectId, findId: id, type: 'photo', photoType: 'in-situ',
          filename: photo.name, mime: photo.type || 'application/octet-stream', blob,
          caption: 'In-situ quick capture', scalePresent: false, createdAt: now,
        };
      }

      await saveQuickFind({
        id,
        projectId: props.projectId,
        permissionId: props.permissionId,
        sessionId: props.sessionId,
        fieldId: props.fieldId,
        findCode: `QUICK-${Date.now().toString().slice(-6)}`,
        objectType: objectType.trim() || 'Pending Quick Find',
        findCategory: category ?? undefined,
        lat: location?.lat ?? null,
        lon: location?.lon ?? null,
        gpsAccuracyM: location?.gpsAccuracyM ?? null,
        locationFixAt: location?.fixTimestamp ? new Date(location.fixTimestamp).toISOString() : undefined,
        locationMethod: location?.captureMethod,
        locationFrozenAt: location ? now : undefined,
        osGridRef: '',
        w3w: '',
        period: 'Unknown',
        material: 'Other',
        weightG: null,
        widthMm: null,
        heightMm: null,
        depthMm: null,
        decoration: '',
        completeness: 'Unassessed',
        findContext: '',
        storageLocation: '',
        notes: 'Recorded from the active-session quick capture.',
        foundAt: now,
        isPending: pending,
        createdAt: now,
        updatedAt: now,
      }, media);
    } catch (cause) {
      navigator.vibrate?.([70, 40, 70]);
      setError(cause instanceof Error ? cause.message : 'Could not save this find.');
      savingRef.current = false;
      setSaving(false);
      return;
    }
    navigator.vibrate?.(50);
    props.onSaved(id, pending);
    if (addDetails) props.onAddDetails(id);
  }

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    setPhoto(event.target.files?.[0] ?? null);
    event.currentTarget.value = '';
  }

  return (
    <>
      <button type="button" aria-label="Close quick find" onClick={props.onClose} className="fixed inset-0 z-[119] bg-black/55 backdrop-blur-[2px]" />
      <section ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="session-quick-find-title" className="fixed inset-x-0 bottom-0 z-[120] max-h-[88dvh] overflow-y-auto rounded-t-3xl border-t border-amber-400/25 bg-gray-950 pb-[env(safe-area-inset-bottom)] text-white shadow-[0_-20px_70px_rgba(0,0,0,0.55)] sm:left-1/2 sm:right-auto sm:w-[min(32rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:border-x">
        <div className="sticky top-0 z-10 border-b border-white/10 bg-gray-950/95 px-4 pb-3 pt-3 backdrop-blur">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15" />
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-3xs font-black uppercase tracking-[0.2em] text-amber-300">Quick capture · {props.permissionName}</p>
              <h2 id="session-quick-find-title" className="mt-1 text-lg font-black">Record a find</h2>
            </div>
            <button type="button" onClick={props.onClose} aria-label="Close" className="grid min-h-11 min-w-11 place-items-center rounded-full border border-white/15 text-gray-300">×</button>
          </div>
        </div>

        <div className="grid gap-4 p-4">
          <div className={`rounded-xl border px-3 py-3 ${gpsState === 'locked' ? 'border-teal-400/30 bg-teal-400/10 text-teal-100' : gpsState === 'waiting' ? 'border-amber-400/30 bg-amber-400/10 text-amber-100' : 'border-white/10 bg-white/5 text-gray-300'}`}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-bold">{gpsState === 'locked' ? 'Position frozen' : gpsState === 'waiting' ? 'Locating…' : 'Location optional'}</span>
              <button type="button" disabled={refreshingLocation} onClick={() => void refreshLocation()} className="min-h-11 rounded-xl border border-current/25 px-3 text-sm font-bold disabled:opacity-50">{refreshingLocation ? 'Refreshing…' : location ? 'Refresh position' : 'Get position'}</button>
            </div>
            {location && <p className="mt-1 text-xs text-current/75">Accuracy {location.gpsAccuracyM == null ? 'unknown' : `±${Math.round(location.gpsAccuracyM)} m`} · Fix {location.fixTimestamp ? `${Math.max(0, Math.round((Date.now() - location.fixTimestamp) / 1000))} s old` : 'age unknown'}</p>}
          </div>

          <label className="grid gap-1.5 text-2xs font-black uppercase tracking-widest text-gray-400">
            What did you find?
            <input value={objectType} onChange={event => setObjectType(event.target.value)} placeholder="e.g. buckle, coin, button" className="min-h-12 rounded-xl border border-white/15 bg-gray-900 px-3 text-base font-bold normal-case tracking-normal text-white outline-none focus:border-teal-400" />
          </label>

          <div>
            <p className="mb-2 text-2xs font-black uppercase tracking-widest text-gray-400">Type · optional</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map(value => <button key={value} type="button" onClick={() => setCategory(current => current === value ? null : value)} className={`min-h-11 rounded-xl border px-3 py-2 text-xs font-black ${category === value ? 'border-amber-300 bg-amber-400 text-gray-950' : 'border-white/15 bg-gray-900 text-gray-200'}`}>{value}</button>)}
            </div>
          </div>

          <label className="flex min-h-12 cursor-pointer items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 text-sm font-black text-amber-200">
            {photo ? `Photo ready · ${photo.name}` : 'Take in-situ photo'}
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={choosePhoto} />
          </label>

          {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-200">{error}</p>}

          <div className="sticky bottom-0 z-10 -mx-4 grid gap-2 border-t border-white/10 bg-gray-950/95 px-4 pb-3 pt-3 backdrop-blur">
            <button type="button" disabled={saving} onClick={() => void save(false)} className="min-h-14 rounded-2xl bg-amber-400 px-4 text-sm font-black text-gray-950 disabled:opacity-50">{saving ? 'Saving…' : 'Save find'}</button>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={saving} onClick={() => void save(true)} className="min-h-12 rounded-xl border border-white/15 bg-white/5 px-3 text-xs font-black text-gray-200 disabled:opacity-50">Finish later</button>
              <button type="button" disabled={saving} onClick={() => void save(true, true)} className="min-h-12 rounded-xl border border-teal-400/30 bg-teal-400/10 px-3 text-xs font-black text-teal-200 disabled:opacity-50">Add full details</button>
            </div>
          </div>
          <p className="text-center text-3xs font-bold leading-relaxed text-gray-500">Everything is stored locally. “Finish later” creates a pending find tied to this visit.</p>
        </div>
      </section>
    </>
  );
}
