import React, { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  db,
  type Media,
  type SurfaceAssessmentSnapshot,
  type SurfaceConfidence,
  type SurfaceExtent,
  type SurfaceGroundCondition,
  type SurfaceMaterial,
  type SurfaceObservation,
  type SurfacePeriod,
  type SurfaceVisibility,
} from '../../db';
import {
  deleteSurfaceObservationPermanently,
  editSurfaceObservationContext,
  reassessSurfaceObservation,
  retireSurfaceObservation,
  SURFACE_ABUNDANCE_LABELS,
  SURFACE_CAPTURE_PERIODS,
  SURFACE_EXTENT_LABELS,
  SURFACE_GROUND_LABELS,
  SURFACE_GROUND_OTHER_MAX_LENGTH,
  SURFACE_MATERIAL_LABELS,
  SURFACE_NOTE_MAX_LENGTH,
  SURFACE_PERIOD_LABELS,
  SURFACE_VISIBILITY_LABELS,
  type SurfaceContextInput,
} from '../../services/surfaceScatter';
import {
  addSurfaceObservationPhoto,
  deleteSurfaceObservationPhoto,
} from '../../services/surfaceScatterMedia';
import Modal from '../Modal';

const EXTENTS = Object.keys(SURFACE_EXTENT_LABELS) as SurfaceExtent[];
const VISIBILITIES = Object.keys(SURFACE_VISIBILITY_LABELS) as SurfaceVisibility[];
const GROUNDS = Object.keys(SURFACE_GROUND_LABELS) as SurfaceGroundCondition[];
const MATERIALS = Object.keys(SURFACE_MATERIAL_LABELS) as SurfaceMaterial[];
const CONFIDENCES: SurfaceConfidence[] = ['unsure', 'fairly_sure', 'confident'];

export type SurfaceContextDraft = {
  extent: SurfaceExtent | '';
  surfaceVisibility: SurfaceVisibility | '';
  groundCondition: SurfaceGroundCondition | '';
  groundConditionOther: string;
  note: string;
};

export function contextDraftFrom(observation?: Partial<SurfaceObservation>): SurfaceContextDraft {
  return {
    extent: observation?.extent ?? '',
    surfaceVisibility: observation?.surfaceVisibility ?? '',
    groundCondition: observation?.groundCondition ?? '',
    groundConditionOther: observation?.groundConditionOther ?? '',
    note: observation?.note ?? '',
  };
}

export function contextInputFrom(draft: SurfaceContextDraft): SurfaceContextInput {
  return {
    extent: draft.extent || undefined,
    surfaceVisibility: draft.surfaceVisibility || undefined,
    groundCondition: draft.groundCondition || undefined,
    groundConditionOther: draft.groundCondition === 'other' ? draft.groundConditionOther : undefined,
    note: draft.note,
  };
}

export function SurfaceContextFields({
  value,
  onChange,
}: {
  value: SurfaceContextDraft;
  onChange: (value: SurfaceContextDraft) => void;
}) {
  const selectClass = 'min-h-12 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold dark:border-gray-600 dark:bg-gray-900';
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-xs font-black text-gray-600 dark:text-gray-300">
        Extent (approximate diameter / spread)
        <select className={selectClass} value={value.extent} onChange={event => onChange({ ...value, extent: event.target.value as SurfaceContextDraft['extent'] })}>
          <option value="">Unknown</option>
          {EXTENTS.map(item => <option key={item} value={item}>{SURFACE_EXTENT_LABELS[item]}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-black text-gray-600 dark:text-gray-300">
        Surface visibility
        <select className={selectClass} value={value.surfaceVisibility} onChange={event => onChange({ ...value, surfaceVisibility: event.target.value as SurfaceContextDraft['surfaceVisibility'] })}>
          <option value="">Unknown</option>
          {VISIBILITIES.map(item => <option key={item} value={item}>{SURFACE_VISIBILITY_LABELS[item]}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-black text-gray-600 dark:text-gray-300">
        Ground condition
        <select className={selectClass} value={value.groundCondition} onChange={event => onChange({ ...value, groundCondition: event.target.value as SurfaceContextDraft['groundCondition'], groundConditionOther: event.target.value === 'other' ? value.groundConditionOther : '' })}>
          <option value="">Unknown</option>
          {GROUNDS.map(item => <option key={item} value={item}>{SURFACE_GROUND_LABELS[item]}</option>)}
        </select>
      </label>
      {value.groundCondition === 'other' && (
        <label className="grid gap-1 text-xs font-black text-gray-600 dark:text-gray-300">
          Other ground condition
          <input maxLength={SURFACE_GROUND_OTHER_MAX_LENGTH} className={selectClass} value={value.groundConditionOther} onChange={event => onChange({ ...value, groundConditionOther: event.target.value })} />
        </label>
      )}
      <label className="grid gap-1 text-xs font-black text-gray-600 dark:text-gray-300 sm:col-span-2">
        Observation note
        <textarea
          rows={3}
          maxLength={SURFACE_NOTE_MAX_LENGTH}
          className="w-full rounded-xl border border-gray-300 bg-white p-3 text-sm dark:border-gray-600 dark:bg-gray-900"
          value={value.note}
          onChange={event => onChange({ ...value, note: event.target.value })}
        />
        <span className="text-right text-3xs text-gray-400">{[...value.note].length}/{SURFACE_NOTE_MAX_LENGTH}</span>
      </label>
    </div>
  );
}

function confidenceLabel(value: SurfaceConfidence): string {
  return value === 'fairly_sure' ? 'Fairly sure' : value === 'confident' ? 'Confident' : 'Unsure';
}

function assessmentLine(assessment: SurfaceAssessmentSnapshot): string {
  const material = SURFACE_MATERIAL_LABELS[assessment.material];
  const abundance = SURFACE_ABUNDANCE_LABELS[assessment.abundance].toLowerCase();
  const period = assessment.periodImpression === 'unknown'
    ? 'Period not recorded'
    : `${assessment.datingConfidence === 'confident' ? '' : 'Possible '}${SURFACE_PERIOD_LABELS[assessment.periodImpression]}`;
  return `${material} · ${abundance} · ${confidenceLabel(assessment.materialConfidence)} · ${period}`;
}

function PhotoGallery({ observationId, media }: { observationId: string; media: Media[] }) {
  const [urls, setUrls] = useState<Array<{ media: Media; url: string }>>([]);
  useEffect(() => {
    const next = media.map(item => ({ media: item, url: URL.createObjectURL(item.blob) }));
    setUrls(next);
    return () => next.forEach(item => URL.revokeObjectURL(item.url));
  }, [media]);
  if (!urls.length) return null;
  return (
    <div className="grid grid-cols-2 gap-2">
      {urls.map(item => (
        <div key={item.media.id} className="relative overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
          <img src={item.url} alt="Surface observation" className="aspect-square h-full w-full object-cover" />
          <button
            type="button"
            aria-label="Delete photo"
            onClick={() => void deleteSurfaceObservationPhoto(observationId, item.media.id)}
            className="absolute right-1.5 top-1.5 rounded-lg bg-black/65 px-2 py-1 text-xs font-black text-white"
          >×</button>
        </div>
      ))}
    </div>
  );
}

export function SurfaceObservationDetailModal({
  observation,
  onClose,
}: {
  observation: SurfaceObservation;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'detail' | 'edit' | 'reassess'>('detail');
  const [context, setContext] = useState(() => contextDraftFrom(observation));
  const [assessment, setAssessment] = useState<SurfaceAssessmentSnapshot>(() => ({
    material: observation.material,
    abundance: observation.abundance,
    materialConfidence: observation.materialConfidence,
    periodImpression: observation.periodImpression,
    datingConfidence: observation.datingConfidence,
  }));
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'retire' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const photos = useLiveQuery(
    () => db.media.where('surfaceObservationId').equals(observation.id).toArray(),
    [observation.id],
  ) ?? [];
  const field = useLiveQuery(
    async () => observation.fieldId ? await db.fields.get(observation.fieldId) : undefined,
    [observation.fieldId],
  );
  const section = useLiveQuery(
    async () => observation.sectionId ? await db.permissionSections.get(observation.sectionId) : undefined,
    [observation.sectionId],
  );
  const original = observation.reassessments[0]?.previous ?? assessment;

  useEffect(() => {
    setContext(contextDraftFrom(observation));
    setAssessment({
      material: observation.material,
      abundance: observation.abundance,
      materialConfidence: observation.materialConfidence,
      periodImpression: observation.periodImpression,
      datingConfidence: observation.datingConfidence,
    });
  }, [observation]);

  const saveContext = async () => {
    setBusy(true); setError(null);
    try {
      await editSurfaceObservationContext(observation.id, contextInputFrom(context));
      setMode('detail');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save details.'); }
    finally { setBusy(false); }
  };

  const saveAssessment = async () => {
    setBusy(true); setError(null);
    try {
      await reassessSurfaceObservation(observation.id, assessment);
      setMode('detail');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save reassessment.'); }
    finally { setBusy(false); }
  };

  const performConfirmedAction = async () => {
    if (!confirmAction) return;
    setBusy(true);
    try {
      if (confirmAction === 'retire') await retireSurfaceObservation(observation.id);
      else await deleteSurfaceObservationPermanently(observation.id);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update this observation.'); }
    finally { setBusy(false); }
  };

  const detailRows = useMemo(() => [
    ['Recorded position', observation.gpsAccuracyM == null ? 'GPS accuracy unknown' : `GPS ±${Math.round(observation.gpsAccuracyM)} m`],
    ['Extent', observation.extent ? SURFACE_EXTENT_LABELS[observation.extent] : 'Not recorded'],
    ['Surface visibility', observation.surfaceVisibility ? SURFACE_VISIBILITY_LABELS[observation.surfaceVisibility] : 'Not recorded'],
    ['Ground', observation.groundCondition ? (observation.groundCondition === 'other' ? observation.groundConditionOther || 'Other' : SURFACE_GROUND_LABELS[observation.groundCondition]) : 'Not recorded'],
    ['Period impression', observation.periodImpression === 'unknown' ? 'Not recorded' : `${observation.datingConfidence === 'confident' ? '' : 'Possible '}${SURFACE_PERIOD_LABELS[observation.periodImpression]} — your impression`],
    ['Identification confidence', confidenceLabel(observation.materialConfidence)],
    ['Recorded', new Date(observation.observedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })],
    ['Visit', observation.originSessionId ? (observation.originSessionDate ? new Date(observation.originSessionDate).toLocaleDateString('en-GB') : 'Saved visit') : 'Outside a saved visit'],
    ['Field context', field?.name ?? (observation.fieldId ? 'Linked field' : 'Not assigned')],
    ['Section context', section?.label ?? (observation.sectionId ? 'Linked section' : 'Not assigned')],
  ] as const, [field?.name, observation, section?.label]);

  return (
    <Modal title={SURFACE_MATERIAL_LABELS[observation.material]} onClose={onClose}>
      <div className="space-y-4">
        {mode === 'edit' ? (
          <>
            <p className="text-xs font-bold text-gray-500">Edit observation context. Assessment fields are changed only through Reassess.</p>
            <SurfaceContextFields value={context} onChange={setContext} />
            <div className="flex gap-2"><button disabled={busy} onClick={() => void saveContext()} className="min-h-12 flex-1 rounded-xl bg-emerald-600 font-black text-white">Save context</button><button onClick={() => setMode('detail')} className="min-h-12 rounded-xl border px-4 font-black">Cancel</button></div>
          </>
        ) : mode === 'reassess' ? (
          <div className="grid gap-3">
            <p className="text-xs font-bold text-gray-500">This creates a dated reassessment and preserves the previous assessment.</p>
            <label className="grid gap-1 text-xs font-black">Material<select className="min-h-12 rounded-xl border bg-white px-3 dark:bg-gray-900" value={assessment.material} onChange={event => setAssessment({ ...assessment, material: event.target.value as SurfaceMaterial })}>{MATERIALS.map(item => <option key={item} value={item}>{SURFACE_MATERIAL_LABELS[item]}</option>)}</select></label>
            <label className="grid gap-1 text-xs font-black">Abundance<select className="min-h-12 rounded-xl border bg-white px-3 dark:bg-gray-900" value={assessment.abundance} onChange={event => setAssessment({ ...assessment, abundance: event.target.value as SurfaceAssessmentSnapshot['abundance'] })}>{Object.entries(SURFACE_ABUNDANCE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="grid gap-1 text-xs font-black">Identification confidence<select className="min-h-12 rounded-xl border bg-white px-3 dark:bg-gray-900" value={assessment.materialConfidence} onChange={event => setAssessment({ ...assessment, materialConfidence: event.target.value as SurfaceConfidence })}>{CONFIDENCES.map(item => <option key={item} value={item}>{confidenceLabel(item)}</option>)}</select></label>
            <label className="grid gap-1 text-xs font-black">Period impression<select className="min-h-12 rounded-xl border bg-white px-3 dark:bg-gray-900" value={assessment.periodImpression} onChange={event => setAssessment({ ...assessment, periodImpression: event.target.value as SurfacePeriod, datingConfidence: event.target.value === 'unknown' ? 'unsure' : assessment.datingConfidence === 'unsure' ? 'fairly_sure' : assessment.datingConfidence })}><option value="unknown">Remove / unknown</option>{SURFACE_CAPTURE_PERIODS.map(item => <option key={item} value={item}>{SURFACE_PERIOD_LABELS[item]}</option>)}</select></label>
            <label className="grid gap-1 text-xs font-black">Dating confidence<select disabled={assessment.periodImpression === 'unknown'} className="min-h-12 rounded-xl border bg-white px-3 disabled:opacity-50 dark:bg-gray-900" value={assessment.datingConfidence} onChange={event => setAssessment({ ...assessment, datingConfidence: event.target.value as SurfaceConfidence })}>{CONFIDENCES.map(item => <option key={item} value={item}>{confidenceLabel(item)}</option>)}</select></label>
            <div className="flex gap-2"><button disabled={busy} onClick={() => void saveAssessment()} className="min-h-12 flex-1 rounded-xl bg-sky-600 font-black text-white">Save reassessment</button><button onClick={() => setMode('detail')} className="min-h-12 rounded-xl border px-4 font-black">Cancel</button></div>
          </div>
        ) : (
          <>
            <div><p className="text-lg font-black">{SURFACE_ABUNDANCE_LABELS[observation.abundance]}</p><p className="text-xs font-bold text-sky-600">Observed by you{observation.retiredAt ? ' · Retired' : ''}</p></div>
            <dl className="grid gap-2 sm:grid-cols-2">{detailRows.map(([label, value]) => <div key={label} className="rounded-xl bg-gray-50 p-3 dark:bg-gray-900/60"><dt className="text-3xs font-black uppercase tracking-widest text-gray-400">{label}</dt><dd className="mt-1 text-sm font-bold">{value}</dd></div>)}</dl>
            {observation.note && <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700"><p className="text-3xs font-black uppercase tracking-widest text-gray-400">Note</p><p className="mt-1 whitespace-pre-wrap text-sm">{observation.note}</p></div>}
            <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <p className="text-3xs font-black uppercase tracking-widest text-gray-400">Assessment history</p>
              <p className="mt-2 text-xs font-black">Original assessment</p><p className="text-xs text-gray-600 dark:text-gray-300">{assessmentLine(original)}</p>
              {observation.reassessments.map((item, index) => <div key={`${item.reassessedAt}-${index}`} className="mt-2 border-t border-gray-100 pt-2 dark:border-gray-700"><p className="text-xs font-black">Reassessed {new Date(item.reassessedAt).toLocaleDateString('en-GB')}</p><p className="text-xs text-gray-600 dark:text-gray-300">{assessmentLine(item.current)}</p></div>)}
              {observation.reassessments.length === 0 && <p className="mt-2 text-xs text-gray-400">No later reassessments.</p>}
            </div>
            <PhotoGallery observationId={observation.id} media={photos} />
            <label className="block min-h-12 cursor-pointer rounded-xl border border-gray-300 px-3 py-3 text-center text-xs font-black dark:border-gray-600">Add photo<input type="file" accept="image/*" capture="environment" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) void addSurfaceObservationPhoto(observation.id, file).catch(cause => setError(cause instanceof Error ? cause.message : 'Could not add photo.')); event.currentTarget.value = ''; }} /></label>
            {!observation.retiredAt && <div className="grid grid-cols-2 gap-2"><button onClick={() => setMode('edit')} className="min-h-12 rounded-xl border font-black">Edit context</button><button onClick={() => setMode('reassess')} className="min-h-12 rounded-xl border font-black">Reassess</button></div>}
            {confirmAction ? <div className="rounded-xl border border-red-300 bg-red-50 p-3 dark:bg-red-950/20"><p className="text-xs font-bold">{confirmAction === 'delete' ? 'Permanently delete this observation and all its photos?' : 'Retire this observation from current maps, counts and summaries?'}</p><div className="mt-2 flex gap-2"><button disabled={busy} onClick={() => void performConfirmedAction()} className="min-h-10 rounded-lg bg-red-600 px-4 text-xs font-black text-white">Confirm {confirmAction}</button><button onClick={() => setConfirmAction(null)} className="min-h-10 rounded-lg border px-4 text-xs font-black">Cancel</button></div></div> : <div className="flex justify-between gap-2">{!observation.retiredAt && <button onClick={() => setConfirmAction('retire')} className="text-xs font-black text-amber-700">Retire</button>}<button onClick={() => setConfirmAction('delete')} className="ml-auto text-xs font-black text-red-600">Delete permanently</button></div>}
          </>
        )}
        {error && <p role="alert" className="text-xs font-bold text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}
