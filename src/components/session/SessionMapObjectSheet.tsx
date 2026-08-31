import { useEffect, useMemo, useRef } from 'react';
import type { Find, SavedPoint, Session, SurfaceObservation, Track, UndugSignal } from '../../db';
import { splitTrackPointsAtGaps } from '../../shared/trackSegments';
import type { SessionMapObjectRef, SessionMapSelection } from '../../hooks/useSessionMapSelection';
import { distanceMeters } from '../../utils/geo';

export type SessionMapObjectRecords = {
  finds: readonly Find[];
  signals: readonly UndugSignal[];
  observations: readonly SurfaceObservation[];
  savedPoints: readonly SavedPoint[];
  tracks: readonly Track[];
  sessions: readonly Session[];
};

function tokenLabel(value: string | null | undefined): string {
  if (!value?.trim() || value === 'unknown' || value === 'Unknown') return 'Unknown';
  const spaced = value.replaceAll('_', ' ').replaceAll('-', ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function dateLabel(value: string | number | null | undefined, withTime = false): string {
  if (value == null || value === '') return 'Unknown';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unknown';
  return date.toLocaleString('en-GB', withTime
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

function accuracyLabel(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? 'Unknown' : `±${Math.round(value)} m`;
}

function savedPointNote(point: SavedPoint): string {
  return point.note.replace(/^Session \S+(?: · )?/, '').trim() || 'Unknown';
}

function trailDistance(track: Track): string {
  const metres = splitTrackPointsAtGaps(track.points ?? [], track.gaps).reduce((total, segment) => {
    let segmentMetres = 0;
    for (let index = 1; index < segment.length; index++) {
      segmentMetres += distanceMeters(segment[index - 1], segment[index]);
    }
    return total + segmentMetres;
  }, 0);
  if (!Number.isFinite(metres) || metres <= 0) return 'Unknown';
  return metres < 1_000 ? `${Math.round(metres)} m` : `${(metres / 1_000).toFixed(1)} km`;
}

function trailDuration(track: Track): string {
  const timestamps = (track.points ?? []).map(point => point.timestamp).filter(Number.isFinite).sort((a, b) => a - b);
  if (timestamps.length < 2) return 'Unknown';
  const minutes = Math.max(0, Math.round((timestamps.at(-1)! - timestamps[0]) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

function objectRecord(object: SessionMapObjectRef, records: SessionMapObjectRecords) {
  if (object.kind === 'find') return records.finds.find(item => item.id === object.id) ?? null;
  if (object.kind === 'signal') return records.signals.find(item => item.id === object.id) ?? null;
  if (object.kind === 'observation') return records.observations.find(item => item.id === object.id) ?? null;
  if (object.kind === 'point') return records.savedPoints.find(item => item.id === object.id) ?? null;
  return records.tracks.find(item => item.id === object.id) ?? null;
}

function choiceText(object: SessionMapObjectRef, records: SessionMapObjectRecords): { title: string; detail: string } {
  const record = objectRecord(object, records);
  if (object.kind === 'find') {
    const find = record as Find | null;
    return { title: find?.objectType?.trim() || 'Unknown find', detail: 'Find' };
  }
  if (object.kind === 'signal') {
    const signal = record as UndugSignal | null;
    return { title: signal?.vdi?.trim() ? `VDI ${signal.vdi}` : 'Undug signal', detail: 'Signal' };
  }
  if (object.kind === 'observation') {
    const observation = record as SurfaceObservation | null;
    return observation?.observationKind === 'iron_patch'
      ? { title: 'Iron / junk patch', detail: 'Field observation' }
      : { title: tokenLabel(observation?.material), detail: 'Surface observation' };
  }
  if (object.kind === 'point') {
    const point = record as SavedPoint | null;
    return { title: point?.label?.trim() || 'Saved point', detail: 'Marked point' };
  }
  const track = record as Track | null;
  return { title: track?.name?.trim() || 'Recorded trail', detail: 'Trail' };
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3"><dt className="text-xs font-black uppercase tracking-wider text-gray-400">{label}</dt><dd className="mt-1 text-sm font-bold text-gray-100">{value || 'Unknown'}</dd></div>;
}

function ObjectDetails({ object, records }: { object: SessionMapObjectRef; records: SessionMapObjectRecords }) {
  const record = objectRecord(object, records);
  if (!record) return <p role="status" className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-3 text-sm font-bold text-amber-200">This record is unavailable. Its details are unknown.</p>;

  if (object.kind === 'find') {
    const find = record as Find;
    return <dl className="grid grid-cols-2 gap-2">
      <Detail label="Record" value={find.findCode?.trim() || 'Unknown'} />
      <Detail label="Recorded" value={dateLabel(find.foundAt ?? find.createdAt, true)} />
      <Detail label="Period" value={tokenLabel(find.period)} />
      <Detail label="Material" value={tokenLabel(find.material)} />
      <Detail label="GPS accuracy" value={accuracyLabel(find.gpsAccuracyM)} />
      <Detail label="Status" value={find.isPending ? 'Pending details' : 'Recorded'} />
      {find.notes?.trim() && <div className="col-span-2"><Detail label="Notes" value={find.notes.trim()} /></div>}
    </dl>;
  }

  if (object.kind === 'signal') {
    const signal = record as UndugSignal;
    const status = signal.status === 'dug-find' ? 'Dug — find recorded'
      : signal.status === 'dug-nothing' ? 'Dug — nothing recovered'
        : signal.status === 'dismissed' ? 'Dismissed' : 'Open';
    return <dl className="grid grid-cols-2 gap-2">
      <Detail label="Recorded" value={dateLabel(signal.createdAt, true)} />
      <Detail label="Status" value={status} />
      <Detail label="Direction" value={tokenLabel(signal.direction)} />
      <Detail label="Stability" value={tokenLabel(signal.stability)} />
      <Detail label="Conditions" value={tokenLabel(signal.conditions)} />
      <Detail label="GPS accuracy" value={accuracyLabel(signal.gpsAccuracy)} />
      {signal.notes?.trim() && <div className="col-span-2"><Detail label="Notes" value={signal.notes.trim()} /></div>}
    </dl>;
  }

  if (object.kind === 'observation') {
    const observation = record as SurfaceObservation;
    if (observation.observationKind === 'iron_patch') {
      return <dl className="grid grid-cols-2 gap-2">
        <Detail label="Observed" value={dateLabel(observation.observedAt ?? observation.createdAt, true)} />
        <Detail label="Approximate spread" value={tokenLabel(observation.extent)} />
        <Detail label="GPS accuracy" value={accuracyLabel(observation.gpsAccuracyM)} />
        <Detail label="Record type" value="Iron / junk patch" />
        {observation.note?.trim() && <div className="col-span-2"><Detail label="Notes" value={observation.note.trim()} /></div>}
      </dl>;
    }
    return <dl className="grid grid-cols-2 gap-2">
      <Detail label="Observed" value={dateLabel(observation.observedAt ?? observation.createdAt, true)} />
      <Detail label="Abundance" value={tokenLabel(observation.abundance)} />
      <Detail label="Period impression" value={tokenLabel(observation.periodImpression)} />
      <Detail label="Dating confidence" value={tokenLabel(observation.datingConfidence)} />
      <Detail label="Extent" value={tokenLabel(observation.extent)} />
      <Detail label="GPS accuracy" value={accuracyLabel(observation.gpsAccuracyM)} />
      {observation.note?.trim() && <div className="col-span-2"><Detail label="Notes" value={observation.note.trim()} /></div>}
    </dl>;
  }

  if (object.kind === 'point') {
    const point = record as SavedPoint;
    return <dl className="grid grid-cols-2 gap-2">
      <Detail label="Saved" value={dateLabel(point.createdAt, true)} />
      <Detail label="Location" value={`${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`} />
      <div className="col-span-2"><Detail label="Notes" value={savedPointNote(point)} /></div>
    </dl>;
  }

  const track = record as Track;
  const trailSession = records.sessions.find(item => item.id === track.sessionId);
  return <dl className="grid grid-cols-2 gap-2">
    <Detail label="Session date" value={dateLabel(trailSession?.date ?? null)} />
    <Detail label="Session status" value={trailSession ? (trailSession.isFinished ? 'Finished' : 'Active') : 'Unknown'} />
    <Detail label="Recorded distance" value={trailDistance(track)} />
    <Detail label="Recorded duration" value={trailDuration(track)} />
    <Detail label="Track points" value={track.points?.length ? String(track.points.length) : 'Unknown'} />
    <Detail label="GPS gaps" value={track.gaps === undefined ? 'Unknown' : `${track.gaps.length} recorded`} />
  </dl>;
}

function objectHeading(object: SessionMapObjectRef, records: SessionMapObjectRecords): { eyebrow: string; title: string } {
  const text = choiceText(object, records);
  return { eyebrow: text.detail, title: text.title };
}

export function SessionMapObjectSheet(props: {
  selection: SessionMapSelection;
  records: SessionMapObjectRecords;
  activeSessionId: string;
  onChoose: (object: SessionMapObjectRef) => void;
  onClose: () => void;
  onOpenFullRecord: (object: SessionMapObjectRef) => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onCloseRef.current(); return; }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')]
        .filter(element => element.offsetParent !== null);
      if (focusable.length === 0) { event.preventDefault(); panelRef.current.focus(); return; }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => { window.removeEventListener('keydown', onKeyDown, true); previousFocus.current?.focus(); };
  }, []);
  useEffect(() => { closeRef.current?.focus(); }, [props.selection]);

  const heading = useMemo(() => props.selection.mode === 'object'
    ? objectHeading(props.selection.object, props.records)
    : { eyebrow: 'Map objects', title: 'Choose what you tapped' }, [props.records, props.selection]);
  const object = props.selection.mode === 'object' ? props.selection.object : null;
  const canOpen = object && (object.kind !== 'trail' || (!!object.sessionId && object.sessionId !== props.activeSessionId));
  const actionLabel = object?.kind === 'observation' ? 'Open permission observations'
    : object?.kind === 'point' ? 'Open in Field Guide'
      : object?.kind === 'trail' ? 'Open session record' : 'Open full record';

  return <>
    <button type="button" aria-label="Close map object" onClick={props.onClose} className="fixed inset-0 z-[139] bg-black/55 backdrop-blur-[2px]" />
    <section ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="session-map-object-title" className="fixed inset-x-0 bottom-0 z-[140] max-h-[88dvh] overflow-y-auto rounded-t-3xl border-t border-white/15 bg-gray-950 pb-[env(safe-area-inset-bottom)] text-white shadow-[0_-20px_70px_rgba(0,0,0,0.55)] sm:left-1/2 sm:right-auto sm:w-[min(32rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:border-x">
      <div className="sticky top-0 z-10 border-b border-white/10 bg-gray-950/95 px-4 pb-3 pt-3 backdrop-blur">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15" />
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-teal-300">{heading.eyebrow}</p><h2 id="session-map-object-title" className="mt-1 text-lg font-black">{heading.title}</h2></div>
          <button ref={closeRef} type="button" onClick={props.onClose} aria-label="Close" className="grid min-h-11 min-w-11 place-items-center rounded-full border border-white/15 text-gray-300">×</button>
        </div>
      </div>
      <div className="grid gap-4 p-4">
        {props.selection.mode === 'choices' ? <div className="grid gap-2">
          <p className="text-sm font-medium text-gray-300">Several records are close to that position. Choose one to inspect.</p>
          {props.selection.objects.map(candidate => {
            const text = choiceText(candidate, props.records);
            return <button key={`${candidate.kind}:${candidate.id}`} type="button" onClick={() => props.onChoose(candidate)} className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-left">
              <span><span className="block text-sm font-black text-white">{text.title}</span><span className="mt-1 block text-xs font-bold uppercase tracking-wider text-gray-400">{text.detail}</span></span><span aria-hidden="true" className="text-lg text-gray-400">›</span>
            </button>;
          })}
        </div> : <ObjectDetails object={props.selection.object} records={props.records} />}
        {canOpen && object && <button type="button" onClick={() => props.onOpenFullRecord(object)} className="min-h-14 rounded-2xl bg-teal-400 px-4 text-sm font-black text-gray-950">{actionLabel}</button>}
        {props.selection.mode === 'object' && <button type="button" onClick={props.onClose} className="min-h-12 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-black text-gray-200">Close</button>}
      </div>
    </section>
  </>;
}
