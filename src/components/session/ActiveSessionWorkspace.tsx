import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import type { TrackingStatus } from '../../services/tracking';
import type { BoundaryPositionStatus } from '../../services/session/sessionFieldPosition';
import type { SessionActivityItem } from '../../services/session/sessionActivity';
import type { ScheduledMonumentMapCoverage } from '../../services/session/sessionScheduledMonuments';
import { ScheduledMonumentCoverageLine } from './ScheduledMonumentCoverageLine';

export type ActiveWorkspaceTab = 'map' | 'record' | 'session';
export type ActiveWorkspaceDestination = ActiveWorkspaceTab | 'guide';

function trackingPresentation(props: {
  isTracking: boolean;
  isCompanionTracking: boolean;
  hasRecordedTrail: boolean;
  trackingStatus: TrackingStatus;
}) {
  if (props.isCompanionTracking) return { label: 'Companion recording', detail: '', tone: 'text-teal-200', dot: 'bg-teal-400' };
  if (!props.isTracking && props.hasRecordedTrail) return { label: 'Session active', detail: 'Trail paused', tone: 'text-amber-300', dot: 'bg-amber-400' };
  if (!props.isTracking) return { label: 'Session active', detail: 'Trail not started', tone: 'text-gray-300', dot: 'border-2 border-gray-500' };
  const acceptedAge = props.trackingStatus.lastAcceptedFixAt ? Date.now() - props.trackingStatus.lastAcceptedFixAt : null;
  if (props.trackingStatus.watchError) return { label: 'Trail recording', detail: 'GPS error', tone: 'text-red-300', dot: 'bg-red-400' };
  if (acceptedAge === null) return { label: 'Trail recording', detail: 'Acquiring GPS', tone: 'text-amber-300', dot: 'animate-pulse bg-amber-400' };
  if (acceptedAge > 120_000) return { label: 'Trail recording', detail: 'GPS lost', tone: 'text-red-300', dot: 'bg-red-400' };
  if (acceptedAge > 10_000) return { label: 'Trail recording', detail: `GPS stale ${Math.round(acceptedAge / 1000)}s`, tone: 'text-amber-300', dot: 'bg-amber-400' };
  const accuracy = props.trackingStatus.lastAcceptedPoint?.accuracyM;
  const wakeWarning = !props.trackingStatus.wakeLockSupported || !props.trackingStatus.wakeLockHeld ? ' · screen lock unprotected' : '';
  return { label: 'Trail recording', detail: `${accuracy != null ? `GPS ±${Math.round(accuracy)}m` : 'GPS live'}${wakeWarning}`, tone: wakeWarning ? 'text-amber-300' : 'text-teal-200', dot: 'animate-pulse bg-teal-400' };
}

export function ActiveSessionShellHeader(props: {
  permissionName: string;
  fieldName?: string;
  durationText: string;
  findCount: number;
  pendingCount: number;
  isTracking: boolean;
  isCompanionTracking: boolean;
  hasRecordedTrail: boolean;
  trackingStatus: TrackingStatus;
  boundaryStatus: BoundaryPositionStatus | null;
  onPermission: () => void;
  onFinish: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  const status = trackingPresentation(props);
  return (
    <header className="relative shrink-0 border-b border-white/10 bg-gray-950/95 px-4 pb-2.5 pt-[calc(0.55rem+env(safe-area-inset-top))] backdrop-blur">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center gap-2">
          <div className={`flex min-w-0 flex-1 items-center gap-2 text-3xs font-black uppercase tracking-[0.15em] ${status.tone}`}>
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${status.dot}`} />
            <span className="truncate">{status.label}{status.detail ? ` · ${status.detail}` : ''}{!isOnline ? ' · Offline' : ''}</span>
          </div>
          <button type="button" aria-label="Session options" aria-expanded={showMenu} onClick={() => setShowMenu(value => !value)} className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-white/15 text-lg font-black text-gray-300">•••</button>
          <button type="button" onClick={props.onFinish} className="min-h-11 rounded-xl border border-red-500/50 bg-red-500/10 px-3 py-2 text-2xs font-black uppercase tracking-wider text-red-200">Finish</button>
        </div>
        <div className="mt-1.5 flex min-w-0 items-baseline gap-2">
          <p className="min-w-0 flex-1 truncate text-base font-black">{props.permissionName}{props.fieldName ? <span className="font-bold text-gray-400"> · {props.fieldName}</span> : null}</p>
          <p className="shrink-0 text-2xs font-bold text-gray-400">{props.durationText} · {props.findCount} find{props.findCount === 1 ? '' : 's'}{props.pendingCount > 0 ? ` · ${props.pendingCount} pending` : ''}</p>
        </div>
        {props.boundaryStatus && props.boundaryStatus.kind !== 'inside' && <p className={`mt-1 text-3xs font-black uppercase tracking-wider ${props.boundaryStatus.kind === 'outside' ? 'text-red-300' : props.boundaryStatus.kind === 'near' ? 'text-amber-300' : 'text-gray-400'}`}>{props.boundaryStatus.label}</p>}
        {showMenu && <div className="absolute right-20 top-[calc(3.5rem+env(safe-area-inset-top))] z-[130] w-52 rounded-xl border border-white/15 bg-gray-950 p-2 shadow-2xl">
          <button type="button" onClick={props.onPermission} className="min-h-11 w-full rounded-lg px-3 text-left text-xs font-black text-gray-200 hover:bg-white/5">Open permission</button>
        </div>}
      </div>
    </header>
  );
}

export function ActiveSessionShellNav(props: {
  active: ActiveWorkspaceDestination;
  onSelect: (destination: ActiveWorkspaceDestination) => void;
}) {
  const destinations: Array<{ id: ActiveWorkspaceDestination; label: string }> = [
    { id: 'map', label: 'Map' },
    { id: 'record', label: 'Record' },
    { id: 'session', label: 'Session' },
    { id: 'guide', label: 'Guide' },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-[90] border-t border-white/10 bg-gray-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur" aria-label="Detecting workspace">
      <div className="mx-auto grid max-w-xl grid-cols-4">
        {destinations.map(destination => (
          <button key={destination.id} type="button" aria-current={props.active === destination.id ? 'page' : undefined} onClick={() => props.onSelect(destination.id)} className={`min-h-16 px-2 py-2 text-center ${props.active === destination.id ? 'text-teal-300' : 'text-gray-400'}`}>
            <span className="mx-auto grid h-6 w-6 place-items-center" aria-hidden="true"><NavIcon destination={destination.id} /></span>
            <span className="mt-1 block text-2xs font-black uppercase tracking-wider">{destination.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

function NavIcon({ destination }: { destination: ActiveWorkspaceDestination }) {
  if (destination === 'record') return <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 stroke-current" strokeWidth="2.4"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>;
  if (destination === 'session') return <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 stroke-current" strokeWidth="2"><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" strokeLinecap="round" /></svg>;
  if (destination === 'guide') return <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 stroke-current" strokeWidth="2"><path d="M4 5.5 9 4l6 2 5-1.5v14L15 20l-6-2-5 1.5Z" strokeLinejoin="round" /><path d="M9 4v14M15 6v14" /></svg>;
  return <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 stroke-current" strokeWidth="2"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" /></svg>;
}

function ActionIcon({ kind }: { kind: 'signal' | 'point' }) {
  if (kind === 'signal') return <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 stroke-current" strokeWidth="2"><path d="M12 21s6-5.3 6-11a6 6 0 1 0-12 0c0 5.7 6 11 6 11Z" /><circle cx="12" cy="10" r="2" /></svg>;
  return <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 stroke-current" strokeWidth="2"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" /></svg>;
}

export function ActiveSessionWorkspace(props: {
  workspaceTab: ActiveWorkspaceTab;
  onSelectTab: (tab: ActiveWorkspaceTab) => void;
  mapDivRef: RefObject<HTMLDivElement | null>;
  scheduledMonumentCoverage: ScheduledMonumentMapCoverage;
  mapLayerControl: ReactNode;
  permissionName: string;
  fieldName?: string;
  durationText: string;
  startedAt: number;
  findCount: number;
  pendingCount: number;
  observationCount: number;
  openSignalCount: number;
  hasField: boolean;
  hasFieldNotes: boolean;
  landUse: string;
  isStubble: boolean;
  distanceText: string | null;
  isTracking: boolean;
  isCompanionTracking: boolean;
  hasRecordedTrail: boolean;
  isAndroid: boolean;
  companionStateReady: boolean;
  isOtherCompanionTracking: boolean;
  companionPendingAction: 'start' | 'stop' | null;
  trackingStatus: TrackingStatus;
  boundaryStatus: BoundaryPositionStatus | null;
  startPointDistanceText: string | null;
  hasStartPoint: boolean;
  recentActivity: SessionActivityItem[];
  findActivity: SessionActivityItem[];
  error: string | null;
  notice: string | null;
  recordSurfaceAction: ReactNode;
  onPermission: () => void;
  onFinish: () => void;
  onToggleTracking: () => void;
  onCompanionStart: () => void;
  onCompanionStop: () => void;
  onCompanionConfirmStart: () => void;
  onCompanionCancel: () => void;
  onImportTrail: () => void;
  onLowDistraction: () => void;
  onQuickFind: () => void;
  onSignal: () => void;
  onSavePoint: () => void;
  onMarkStartPoint: () => void;
  onFieldNotes: () => void;
  onToggleStubble: () => void;
  onToggleLandUse: (landUse: 'Ploughed' | 'Pasture') => void;
  onActivity: (item: SessionActivityItem) => void;
  onOpenObservations: () => void;
  onOpenSignals: () => void;
  onTrailDetails: () => void;
  onAddNote: (note: string) => Promise<void>;
  onSignificantFind: () => void;
  onPending: () => void;
  onGuide: () => void;
}) {
  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [showSessionFinds, setShowSessionFinds] = useState(false);
  const hasVisitConditions = !!props.landUse.trim() || props.isStubble;
  const [visitConditionsExpanded, setVisitConditionsExpanded] = useState(() => !hasVisitConditions);
  const visitConditionsSummary = [props.landUse.trim(), props.isStubble ? 'Stubble' : '']
    .filter(Boolean)
    .join(' · ');
  async function addNote() {
    if (!note.trim() || savingNote) return;
    setSavingNote(true);
    try { await props.onAddNote(note.trim()); setNote(''); } finally { setSavingNote(false); }
  }
  return (
    <div className="fixed inset-0 z-[70] flex flex-col overflow-hidden bg-gray-950 text-white">
      <ActiveSessionShellHeader permissionName={props.permissionName} fieldName={props.fieldName} durationText={props.durationText} findCount={props.findCount} pendingCount={props.pendingCount} isTracking={props.isTracking} isCompanionTracking={props.isCompanionTracking} hasRecordedTrail={props.hasRecordedTrail} trackingStatus={props.trackingStatus} boundaryStatus={props.boundaryStatus} onPermission={props.onPermission} onFinish={props.onFinish} />

      <main className="min-h-0 flex-1 overflow-y-auto pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
        {props.error && <div className="mx-auto mt-3 max-w-4xl px-4"><div className="rounded-xl border border-red-500/40 bg-red-950/50 px-3 py-2 text-sm text-red-100">{props.error}</div></div>}
        {props.notice && <div className="fixed left-1/2 top-24 z-[110] -translate-x-1/2 rounded-full bg-teal-500 px-4 py-2 text-xs font-black text-gray-950 shadow-xl">{props.notice}</div>}

        {props.workspaceTab === 'map' && (
          <section className="relative h-full min-h-[460px] bg-gray-900" aria-label="Session map">
            <div className="absolute inset-0 grid place-items-center text-center text-sm text-gray-500"><div><div className="text-2xl">⌖</div><p className="mt-2">The map appears when a boundary, trail or live track is available.</p></div></div>
            <div ref={props.mapDivRef} className="absolute inset-0" />
            <ScheduledMonumentCoverageLine state={props.scheduledMonumentCoverage} />
            <div className="absolute right-4 top-4 z-[100] grid justify-items-end gap-2">
              {props.isTracking ? (
                <button type="button" onClick={props.onToggleTracking} className="min-h-11 rounded-xl bg-red-600 px-4 py-2 text-xs font-black text-white shadow-lg">Stop FindSpot trail</button>
              ) : props.isCompanionTracking ? (
                <button type="button" onClick={props.onCompanionStop} className="flex min-h-11 items-center rounded-xl bg-red-600 px-4 py-2 text-xs font-black text-white shadow-lg">{props.companionPendingAction === 'stop' ? 'Retry Companion stop' : 'Stop Companion'}</button>
              ) : (
                <div className="flex gap-2">
                  <button type="button" onClick={props.onToggleTracking} className="min-h-11 rounded-xl bg-teal-500 px-3 py-2 text-xs font-black text-gray-950 shadow-lg">FindSpot trail</button>
                  {props.isAndroid && (
                    <button
                      type="button"
                      aria-disabled={!props.companionStateReady || props.isOtherCompanionTracking}
                      onClick={props.companionStateReady && !props.isOtherCompanionTracking ? props.onCompanionStart : undefined}
                      className={`flex min-h-11 items-center rounded-xl border px-3 py-2 text-xs font-black shadow-lg backdrop-blur ${props.companionStateReady && !props.isOtherCompanionTracking ? 'border-white/15 bg-gray-950/85 text-gray-100' : 'pointer-events-none border-white/10 bg-gray-950/70 text-gray-600'}`}
                    >
                      {props.companionPendingAction === 'start' ? 'Retry Companion' : 'Companion'}
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="absolute bottom-14 left-4 z-[100] grid max-w-[65%] gap-2">
              {props.startPointDistanceText && <div className="w-fit rounded-xl border border-violet-400/25 bg-gray-950/85 px-3 py-2 text-2xs font-black text-violet-200 shadow-lg backdrop-blur">Start point · {props.startPointDistanceText}</div>}
              {props.boundaryStatus && props.boundaryStatus.kind !== 'inside' && <div className={`rounded-xl border bg-gray-950/90 px-3 py-2 text-2xs font-black shadow-lg backdrop-blur ${props.boundaryStatus.kind === 'outside' ? 'border-red-400/40 text-red-200' : 'border-amber-400/30 text-amber-200'}`}>{props.boundaryStatus.label}</div>}
            </div>
            <div className="absolute bottom-14 right-4 z-[100] grid justify-items-end gap-2">
              {props.mapLayerControl}
              <button type="button" aria-label="Add Find from Map" onClick={props.onQuickFind} className="grid h-16 w-16 place-items-center rounded-full bg-amber-400 text-center text-xs font-black text-gray-950 shadow-2xl shadow-black/50">+ Find</button>
            </div>
          </section>
        )}

        {props.workspaceTab === 'record' && (
          <section className="mx-auto grid max-w-3xl gap-4 p-4">
            <div className="rounded-2xl border border-white/10 bg-gray-900 p-4">
              <p className="text-2xs font-black uppercase tracking-[0.18em] text-gray-400">Record on {props.permissionName}</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <button type="button" aria-label="Add Find to Session" onClick={props.onQuickFind} className="min-h-24 rounded-2xl bg-amber-400 p-4 text-left text-gray-950 shadow-lg shadow-amber-950/20"><span className="block text-2xl font-light">+</span><span className="mt-2 block text-sm font-black">Find</span></button>
                <button type="button" aria-label="Un-dug Signal" onClick={props.onSignal} className="min-h-24 rounded-2xl border border-sky-400/30 bg-sky-400/10 p-4 text-left text-sky-100"><ActionIcon kind="signal" /><span className="mt-2 block text-sm font-black">Undug signal</span></button>
                <div className="[&>button]:min-h-24 [&>button]:rounded-2xl [&>button]:border-teal-400/30 [&>button]:bg-teal-400/10 [&>button]:text-teal-100">{props.recordSurfaceAction}</div>
                <button type="button" onClick={props.onSavePoint} className="min-h-24 rounded-2xl border border-white/15 bg-white/5 p-4 text-left text-gray-100"><ActionIcon kind="point" /><span className="mt-2 block text-sm font-black">Mark location</span></button>
              </div>
              <button type="button" aria-label="Significant Find" onClick={props.onSignificantFind} className="mt-3 min-h-12 w-full rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 text-sm font-black text-amber-200">Record significant find</button>
            </div>
            <div className="rounded-2xl border border-white/10 bg-gray-900 p-4">
              <div>
                <p className="text-xs font-black">Trail recording</p>
                <p className="mt-0.5 text-xs text-gray-400">{props.distanceText ? `${props.distanceText} recorded` : 'Optional — the session remains active without it.'}</p>
              </div>
              {props.isTracking ? (
                <div className="mt-3 rounded-xl border border-teal-400/25 bg-teal-400/10 p-3">
                  <p className="text-xs font-black text-teal-200">FindSpot trail · keep FindSpot open</p>
                  <p className="mt-1 text-2xs leading-relaxed text-teal-100/70">Screen wake lock is requested automatically. Do not manually lock the phone.</p>
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={props.onLowDistraction} className="min-h-11 flex-1 rounded-xl border border-white/15 px-3 text-2xs font-black text-gray-200">Low distraction</button>
                    <button type="button" onClick={props.onToggleTracking} className="min-h-11 flex-1 rounded-xl bg-red-600 px-3 text-xs font-black">Stop FindSpot trail</button>
                  </div>
                </div>
              ) : props.isCompanionTracking ? (
                <div className="mt-3 rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-3">
                  <p className="text-xs font-black text-emerald-200">{props.companionPendingAction === 'stop' ? 'Waiting for Companion trail' : 'Companion recording'}</p>
                  <p className="mt-1 text-2xs leading-relaxed text-emerald-100/70">{props.companionPendingAction === 'stop' ? 'Companion remains marked active until its recording is safely imported. If sharing was cancelled, retry or cancel this stop request.' : 'You can hide FindSpot or lock the phone. Your Companion trail will appear in FindSpot after the session ends.'}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" onClick={props.onCompanionStop} className="flex min-h-11 items-center justify-center rounded-xl border border-red-400/35 px-3 text-center text-2xs font-black text-red-200">{props.companionPendingAction === 'stop' ? 'Retry stop' : 'Stop Companion'}</button>
                    {props.companionPendingAction === 'stop' ? (
                      <button type="button" onClick={props.onCompanionCancel} className="flex min-h-11 items-center justify-center rounded-xl border border-white/15 px-3 text-center text-2xs font-black text-gray-200">Sharing was cancelled</button>
                    ) : (
                      <button type="button" onClick={props.onFinish} className="flex min-h-11 items-center justify-center rounded-xl bg-red-600 px-3 text-center text-2xs font-black text-white">Stop &amp; finish</button>
                    )}
                  </div>
                </div>
              ) : props.companionPendingAction === 'start' ? (
                <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/10 p-3">
                  <p className="text-xs font-black text-amber-200">Waiting for Companion confirmation</p>
                  <p className="mt-1 text-2xs leading-relaxed text-amber-100/70">New Companion versions confirm automatically. With an older beta, confirm here only after Android says it is recording.</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" onClick={props.onCompanionConfirmStart} className="min-h-11 rounded-xl bg-emerald-500 px-3 text-2xs font-black text-gray-950">Companion is recording</button>
                    <button type="button" onClick={props.onCompanionCancel} className="min-h-11 rounded-xl border border-white/15 px-3 text-2xs font-black text-gray-200">It didn't start</button>
                  </div>
                </div>
              ) : (
                <div className="mt-3">
                  <div className={`grid gap-2 ${props.isAndroid ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    <button type="button" onClick={props.onToggleTracking} className="min-h-16 rounded-xl bg-teal-500 px-3 py-2 text-left text-gray-950">
                      <span className="block text-xs font-black">Start in FindSpot</span>
                      <span className="mt-1 block text-3xs font-bold text-gray-800/70">Keeps the screen awake</span>
                    </button>
                    {props.isAndroid && (
                      <button
                        type="button"
                        aria-disabled={!props.companionStateReady || props.isOtherCompanionTracking}
                        onClick={props.companionStateReady && !props.isOtherCompanionTracking ? props.onCompanionStart : undefined}
                        className={`flex min-h-16 flex-col justify-center rounded-xl border px-3 py-2 text-left ${props.companionStateReady && !props.isOtherCompanionTracking ? 'border-emerald-400/35 bg-emerald-400/10 text-emerald-100' : 'pointer-events-none border-white/10 bg-white/5 text-gray-600'}`}
                      >
                        <span className="block text-xs font-black">Use Companion beta</span>
                        <span className="mt-1 block text-3xs font-bold opacity-70">{props.isOtherCompanionTracking ? 'Another session is active' : 'Works with screen locked'}</span>
                      </button>
                    )}
                  </div>
                  <button type="button" onClick={props.onImportTrail} className="mt-2 min-h-11 w-full rounded-xl border border-white/15 px-3 text-2xs font-black text-gray-300">Import a Companion trail</button>
                </div>
              )}
            </div>
            <div className="rounded-2xl border border-white/10 bg-gray-900 p-4" role="group" aria-label="Visit conditions">
              {visitConditionsExpanded ? (
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="pt-1 text-xs font-black">Visit conditions</p>
                  <div className="flex flex-wrap justify-end gap-2">
                    {props.hasField && (
                      <button type="button" onClick={props.onFieldNotes} className="min-h-11 rounded-xl border border-white/15 px-3 text-2xs font-black text-gray-200">
                        {props.hasFieldNotes ? 'Field notes ✓' : 'Field notes'}
                      </button>
                    )}
                    {hasVisitConditions && (
                      <button type="button" aria-expanded={true} aria-controls="visit-conditions-controls" onClick={() => setVisitConditionsExpanded(false)} className="min-h-11 rounded-xl px-3 text-2xs font-black text-teal-300">Done</button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-black">Visit conditions</p>
                    <p className="mt-1 text-sm font-bold text-gray-300">{visitConditionsSummary}</p>
                    {props.hasField && (
                      <button type="button" onClick={props.onFieldNotes} className="mt-1 min-h-11 text-left text-2xs font-black text-gray-300">
                        {props.hasFieldNotes ? 'Field notes ✓' : 'Field notes'}
                      </button>
                    )}
                  </div>
                  <button type="button" aria-expanded={false} aria-controls="visit-conditions-controls" onClick={() => setVisitConditionsExpanded(true)} className="min-h-11 shrink-0 rounded-xl border border-white/15 px-3 text-2xs font-black text-gray-200">Edit</button>
                </div>
              )}
              <div id="visit-conditions-controls" hidden={!visitConditionsExpanded} className={`mt-3 flex-wrap gap-2 ${visitConditionsExpanded ? 'flex' : 'hidden'}`} aria-label="Ground condition">
                <button type="button" aria-pressed={props.isStubble} onClick={props.onToggleStubble} className={`min-h-11 rounded-xl border px-3 text-2xs font-black ${props.isStubble ? 'border-amber-400/50 bg-amber-400/15 text-amber-200' : 'border-white/15 text-gray-300'}`}>Stubble</button>
                {(['Ploughed', 'Pasture'] as const).map(condition => (
                  <button key={condition} type="button" aria-pressed={props.landUse === condition} onClick={() => props.onToggleLandUse(condition)} className={`min-h-11 rounded-xl border px-3 text-2xs font-black ${props.landUse === condition ? 'border-teal-400/50 bg-teal-400/15 text-teal-200' : 'border-white/15 text-gray-300'}`}>{condition}</button>
                ))}
              </div>
            </div>
          </section>
        )}

        {props.workspaceTab === 'session' && (
          <section className="mx-auto grid max-w-3xl gap-4 p-4">
            <div className="rounded-2xl border border-white/10 bg-gray-900 p-5">
              <p className="text-2xs font-black uppercase tracking-[0.2em] text-teal-300">This visit</p>
              <h2 className="mt-1 text-xl font-black">{props.permissionName}</h2>
              <p className="mt-1 text-sm text-gray-400">Started {new Date(props.startedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</p>
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Elapsed', value: props.durationText },
                  { label: 'Finds', value: String(props.findCount) },
                  { label: 'Observations', value: String(props.observationCount) },
                  { label: 'Open signals', value: String(props.openSignalCount) },
                ].map(item => <button type="button" key={item.label} aria-expanded={item.label === 'Finds' ? showSessionFinds : undefined} onClick={item.label === 'Finds' ? () => setShowSessionFinds(current => !current) : item.label === 'Observations' ? props.onOpenObservations : item.label === 'Open signals' ? props.onOpenSignals : undefined} className="rounded-xl border border-white/10 bg-gray-950 p-3 text-left"><div className="text-lg font-black text-white">{item.value}</div><div className="mt-1 text-2xs font-black uppercase tracking-wider text-gray-400">{item.label}</div></button>)}
              </div>
              {showSessionFinds && (
                <div className="mt-4 grid gap-2" aria-label="Session finds">
                  {props.findActivity.length > 0 ? props.findActivity.map(item => (
                    <button type="button" key={item.id} onClick={() => props.onActivity(item)} className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-white/10 bg-gray-950 px-3 text-left">
                      <span className="min-w-0"><span className="block truncate text-xs font-black text-gray-100">{item.detail}</span><span className="mt-0.5 block text-2xs text-gray-400">{item.title}</span></span>
                      <span className="shrink-0 text-3xs font-bold text-gray-500">{new Date(item.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                    </button>
                  )) : <p className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-xs font-bold text-gray-500">No finds recorded in this visit.</p>}
                </div>
              )}
              {props.distanceText && <button type="button" onClick={props.onTrailDetails} className="mt-4 text-left text-xs text-gray-400">Reliable trail distance: <span className="font-black text-gray-200">{props.distanceText}</span><span className="ml-2 font-black text-teal-300">View trail controls</span></button>}
            </div>
            <div className="rounded-2xl border border-white/10 bg-gray-900 p-4">
              <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black">Recent activity</p><p className="mt-0.5 text-2xs text-gray-400">Open a record to check or add detail.</p></div>{!props.hasStartPoint && <button type="button" onClick={props.onMarkStartPoint} className="min-h-11 rounded-xl border border-violet-400/30 bg-violet-400/10 px-3 text-2xs font-black text-violet-200">Mark start</button>}</div>
              <div className="mt-3 grid gap-2">
                {props.recentActivity.length > 0 ? props.recentActivity.map(item => <button type="button" key={`${item.kind}:${item.id}`} onClick={() => props.onActivity(item)} className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-white/10 bg-gray-950 px-3 text-left"><span className="min-w-0"><span className="block truncate text-xs font-black text-gray-100">{item.title}</span><span className="mt-0.5 block truncate text-2xs text-gray-400">{item.detail}</span></span><span className="shrink-0 text-3xs font-bold text-gray-500">{new Date(item.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span></button>) : <p className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-xs font-bold text-gray-500">Your finds, signals and marked locations will appear here.</p>}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-gray-900 p-4">
              <label className="text-xs font-black" htmlFor="active-session-note">Quick session note</label>
              <div className="mt-2 flex gap-2"><input id="active-session-note" value={note} onChange={event => setNote(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void addNote(); }} placeholder="Conditions, detector changes, access…" className="min-h-12 min-w-0 flex-1 rounded-xl border border-white/15 bg-gray-950 px-3 text-sm text-white placeholder:text-gray-600" /><button type="button" disabled={!note.trim() || savingNote} onClick={() => void addNote()} className="min-h-12 rounded-xl bg-teal-400 px-4 text-xs font-black text-gray-950 disabled:opacity-40">Add</button></div>
            </div>
            {props.pendingCount > 0 && <button type="button" onClick={props.onPending} className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-left text-sm font-bold text-amber-200">{props.pendingCount} pending find{props.pendingCount === 1 ? '' : 's'} to finish</button>}
            <button type="button" onClick={props.onFinish} className="min-h-14 rounded-2xl bg-red-600 px-5 text-sm font-black text-white shadow-lg shadow-red-950/30">Review and finish</button>
          </section>
        )}
      </main>

      <ActiveSessionShellNav active={props.workspaceTab} onSelect={destination => destination === 'guide' ? props.onGuide() : props.onSelectTab(destination)} />
    </div>
  );
}
