import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { v4 as uuid } from 'uuid';
import type { Find, Media } from '../../db';
import { saveQuickFind } from '../../services/findMutations';
import { fileToBlob } from '../../services/photos';
import { captureGPS } from '../../services/gps';
import { useConfirmDialog } from '../ConfirmModal';
import { useDialogScrollLock } from '../../hooks/useDialogScrollLock';
import { captureLocationStatus, captureElapsed, fixTimeIso } from '../../utils/captureLocationStatus';
import { useObjectUrl } from '../../hooks/useObjectUrl';
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
  const [location, setLocation] = useState<(QuickFindLocation & { capturedAt: number }) | null>(() => { const preferred = props.getPreferredLocation(); return preferred ? { ...preferred, capturedAt: Date.now() } : null; });
  const [gpsState, setGpsState] = useState<'waiting' | 'locked' | 'unavailable'>(() => location ? 'locked' : 'waiting');
  const [objectType, setObjectType] = useState('');
  const [category, setCategory] = useState<QuickFindCategory | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const photoUrl = useObjectUrl(photo);
  const photoInput = useRef<HTMLInputElement>(null);
  const locationRequest = useRef(0);
  const [saving, setSaving] = useState(false);
  const [refreshingLocation, setRefreshingLocation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const saveIdRef = useRef<string | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const { confirm, dialog: discardDialog } = useConfirmDialog();
  const closingRef = useRef(false);
  useDialogScrollLock();
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const positionStatus = captureLocationStatus(location);
  async function requestClose() {
    if (savingRef.current || closingRef.current) return;
    closingRef.current = true;
    try {
      if ((objectType.trim() || category || photo) && !await confirm({
        title: 'Discard this capture?', message: 'The description, type and photo have not been saved.',
        confirmLabel: 'Discard changes', cancelLabel: 'Keep editing', danger: true,
      })) return;
      props.onClose();
    } finally { closingRef.current = false; }
  }
  const onCloseRef = useRef(requestClose);
  onCloseRef.current = requestClose;

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (closingRef.current) return;
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
    const request = ++locationRequest.current;
    void captureGPS().then(fix => {
      if (cancelled || request !== locationRequest.current) return;
      setLocation({ lat: fix.lat, lon: fix.lon, gpsAccuracyM: fix.accuracyM, fixTimestamp: fix.fixTimestamp, captureMethod: 'live_gps', capturedAt: Date.now() });
      setGpsState('locked');
    }).catch(() => {
      if (!cancelled && request === locationRequest.current) setGpsState('unavailable');
    });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshLocation() {
    if (refreshingLocation) return;
    const request = ++locationRequest.current;
    setRefreshingLocation(true);
    setError(null);
    setGpsState('waiting');
    try {
      const fix = await captureGPS();
      if (request !== locationRequest.current) return;
      setLocation({ lat: fix.lat, lon: fix.lon, gpsAccuracyM: fix.accuracyM, fixTimestamp: fix.fixTimestamp, captureMethod: 'live_gps', capturedAt: Date.now() });
      setGpsState('locked');
    } catch {
      setGpsState(location ? 'locked' : 'unavailable');
      setError(location ? 'Could not refresh. Earlier position retained.' : 'Could not get a position. You can save without a location.');
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
        locationFixAt: fixTimeIso(location?.fixTimestamp),
        locationMethod: location?.captureMethod,
        locationFrozenAt: fixTimeIso(location?.capturedAt),
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
      setError('This find was not saved. Your details and photo are still here; please try again.');
      savingRef.current = false;
      setSaving(false);
      return;
    }
    navigator.vibrate?.(50);
    props.onSaved(id, pending);
    if (addDetails) props.onAddDetails(id);
  }

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    if (chosen) setPhoto(chosen);
    event.currentTarget.value = '';
  }

  return (
    <>
      <button type="button" aria-label="Close quick find" onClick={() => void requestClose()} disabled={saving} className="fixed inset-0 z-[119] bg-black/55 backdrop-blur-[2px]" />
      <section ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="session-quick-find-title" className="fixed inset-x-0 bottom-0 z-[120] max-h-[88dvh] overflow-y-auto rounded-t-3xl border-t border-amber-400/25 bg-white dark:bg-gray-950 pb-[env(safe-area-inset-bottom)] text-gray-900 dark:text-white shadow-[0_-20px_70px_rgba(0,0,0,0.55)] sm:left-1/2 sm:right-auto sm:w-[min(32rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:border-x">
        <div className="sticky top-0 z-10 border-b border-gray-200 dark:border-white/10 bg-white/95 dark:bg-gray-950/95 px-4 pb-3 pt-3 backdrop-blur">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300 dark:bg-white/15" />
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-800 dark:text-amber-300">Quick capture · {props.permissionName}</p>
              <h2 id="session-quick-find-title" className="mt-1 text-lg font-bold">Record a find</h2>
            </div>
            <button type="button" onClick={() => void requestClose()} disabled={saving} aria-label="Close" className="grid min-h-11 min-w-11 place-items-center rounded-full border border-gray-300 dark:border-white/15 text-gray-600 dark:text-gray-300">×</button>
          </div>
        </div>

        <div className="grid gap-4 p-4">
          <div className={`rounded-xl border px-3 py-3 ${gpsState === 'locked' && !positionStatus.warning ? 'border-teal-300 bg-teal-50 text-teal-900 dark:border-teal-400/30 dark:bg-teal-400/10 dark:text-teal-100' : (gpsState === 'waiting' || positionStatus.warning) ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100' : 'border-gray-200 dark:border-white/10 bg-white/5 text-gray-600 dark:text-gray-300'}`}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-bold">{gpsState === 'locked' ? positionStatus.label : gpsState === 'waiting' ? 'Locating…' : 'No position captured'}</span>
              <button type="button" disabled={refreshingLocation || saving} onClick={() => void refreshLocation()} className="min-h-11 rounded-xl border border-current/25 px-3 text-sm font-bold disabled:opacity-50">{refreshingLocation ? 'Refreshing…' : location ? 'Refresh position' : 'Get position'}</button>
            </div>
            <p className="mt-1 text-sm leading-relaxed">{location ? `Accuracy ${location.gpsAccuracyM == null || !Number.isFinite(location.gpsAccuracyM) ? 'unknown' : `±${Math.round(location.gpsAccuracyM)} m`} · ${captureElapsed(location.capturedAt, now)}` : 'You can save without a location.'}</p>
            {location && <p className="mt-1 text-xs">Source: {location.captureMethod?.replaceAll('_', ' ') ?? 'unknown'}. Position stays fixed unless refreshed.</p>}
            <p className="mt-1 text-xs">Refresh uses where you are now, which may differ from the findspot.</p>
          </div>

          <label className="grid gap-1.5 text-sm font-bold uppercase tracking-wide text-gray-600 dark:text-gray-400">
            What did you find?
            <input disabled={saving} value={objectType} onChange={event => setObjectType(event.target.value)} placeholder="e.g. buckle, coin, button" className="min-h-12 rounded-xl border border-gray-300 dark:border-white/15 bg-gray-50 dark:bg-gray-900 px-3 text-base font-bold normal-case tracking-normal text-gray-900 dark:text-white outline-none focus:border-teal-400" />
          </label>

          <div>
            <p className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-600 dark:text-gray-400">Type · optional</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map(value => <button key={value} type="button" disabled={saving} aria-pressed={category === value} onClick={() => setCategory(current => current === value ? null : value)} className={`min-h-11 rounded-xl border px-3 py-2 text-xs font-bold ${category === value ? 'border-blue-500 bg-blue-100 text-blue-900 dark:border-blue-300 dark:bg-blue-950 dark:text-blue-100' : 'border-gray-300 dark:border-white/15 bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-200'}`}>{value}</button>)}
            </div>
          </div>

          <div className="grid gap-2">
            <input ref={photoInput} type="file" disabled={saving} accept="image/*" capture="environment" className="hidden" onChange={choosePhoto} />
            {photo && photoUrl ? <div className="flex items-start gap-3">
              <img src={photoUrl} alt="Selected photo, not yet saved" className="h-24 w-24 rounded-xl object-cover" />
              <div className="min-w-0"><p className="text-sm break-words">Photo ready · {photo.name}</p><div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="ui-secondary" disabled={saving} onClick={() => photoInput.current?.click()}>Replace / Retake</button>
                <button type="button" className="ui-danger" disabled={saving} onClick={() => setPhoto(null)}>Remove photo</button>
              </div></div>
            </div> : <button type="button" className="ui-secondary" disabled={saving} onClick={() => photoInput.current?.click()}>Take in-situ photo</button>}
          </div>

          {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-800 dark:text-red-200">{error}</p>}

          <div className="sticky bottom-0 z-10 -mx-4 grid gap-2 border-t border-gray-200 dark:border-white/10 bg-white/95 dark:bg-gray-950/95 px-4 pb-3 pt-3 backdrop-blur">
            <button type="button" disabled={saving} onClick={() => void save(!objectType.trim() && !category)} className="ui-primary min-h-14">{saving ? 'Saving…' : objectType.trim() || category ? 'Save find' : 'Save & finish later'}</button>
            <div className={`grid gap-2 ${objectType.trim() || category ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {(objectType.trim() || category) && <button type="button" disabled={saving} onClick={() => void save(true)} className="min-h-12 rounded-xl border border-gray-300 dark:border-white/15 bg-white/5 px-3 text-xs font-bold text-gray-700 dark:text-gray-200 disabled:opacity-50">Save & finish later</button>}
              <button type="button" disabled={saving} onClick={() => void save(true, true)} className="min-h-12 rounded-xl border border-teal-400/30 bg-teal-400/10 px-3 text-xs font-bold text-teal-800 dark:text-teal-200 disabled:opacity-50">Add more details</button>
            </div>
          </div>
          <p className="text-center text-xs font-bold leading-relaxed text-gray-500">Saved on this device. “Save & finish later” keeps a record tied to this visit. Your position stays fixed unless you refresh it.</p>
        </div>
      </section>
      {discardDialog}
    </>
  );
}
