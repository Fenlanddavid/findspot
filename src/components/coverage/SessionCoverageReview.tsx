import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { pagePersistence } from '../../services/pagePersistence';
import {
  canEditSessionCoverage,
  ensurePermissionSections,
  prepareSessionCoverageEvidence,
  saveReportedSessionCoverage,
  sessionCoverageEditDeadline,
} from '../../services/coverageMutations';
import { refreshHotspotPredictionOutcomes } from '../../services/hotspotPredictionService';
import { reportNonFatal } from '../../services/diagLog';
import {
  SectionCoverageMap,
  summarizeSectionEvidence,
} from './SectionCoverageMap';
import type { SessionCoverageObservation } from '../../shared/coverageTypes';

const EMPTY_OBSERVATIONS: SessionCoverageObservation[] = [];

export function SessionCoverageReview(props: {
  sessionId: string;
  fieldId?: string;
  initiallyOpen?: boolean;
  onClose?: () => void;
  stayOpenAfterSave?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(!!props.initiallyOpen);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const dirtyRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sectionsReady, setSectionsReady] = useState(false);

  const session = useLiveQuery(
    () => pagePersistence.sessions.get(props.sessionId),
    [props.sessionId],
  );
  const sections = useLiveQuery(async () => {
    if (!session) return [];
    const rows = await pagePersistence.permissionSections
      .where('permissionId')
      .equals(session.permissionId)
      .filter(section => !section.retiredAt)
      .toArray();
    const scopedFieldId = props.fieldId ?? session.fieldId;
    return scopedFieldId
      ? rows.filter(section => section.fieldId === scopedFieldId)
      : rows;
  }, [session?.permissionId, session?.fieldId, props.fieldId]);
  const observationRows = useLiveQuery(
    () => pagePersistence.sessionCoverage
      .where('sessionId')
      .equals(props.sessionId)
      .toArray(),
    [props.sessionId],
  );
  const observations = observationRows ?? EMPTY_OBSERVATIONS;

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setSectionsReady(false);
    ensurePermissionSections(session.permissionId)
      .catch(errorValue => {
        reportNonFatal('session-coverage', 'Could not prepare searched areas', errorValue);
      })
      .finally(() => {
        if (!cancelled) setSectionsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.permissionId]);

  useEffect(() => {
    if (!open) return;
    prepareSessionCoverageEvidence(props.sessionId).catch(errorValue => {
      reportNonFatal('session-coverage', 'Could not prepare session coverage evidence', errorValue);
      setError('The searched-area map could not be prepared.');
    });
  }, [open, props.sessionId]);

  useEffect(() => {
    if (dirtyRef.current) return;
    setSelected(new Set(
      observations
        .filter(observation => observation.evidence === 'reported')
        .map(observation => observation.sectionId),
    ));
  }, [observationRows]);

  const evidence = useMemo(
    () => summarizeSectionEvidence(observations),
    [observations],
  );
  const savedReportedIds = useMemo(
    () => new Set(
      observations
        .filter(observation => observation.evidence === 'reported')
        .map(observation => observation.sectionId),
    ),
    [observations],
  );
  const trackedIds = useMemo(
    () => new Set(
      observations
        .filter(observation => observation.evidence === 'tracked')
        .map(observation => observation.sectionId),
    ),
    [observations],
  );
  const editable = !!session && canEditSessionCoverage(session);
  const deadline = session ? sessionCoverageEditDeadline(session) : null;
  const coveredCount = new Set(
    observations
      .filter(observation => observation.evidence !== 'find-visited')
      .map(observation => observation.sectionId),
  ).size;
  const fieldWord = (props.fieldId ?? session?.fieldId) ? 'field' : 'permission';
  const visibleSectionIds = new Set((sections ?? []).map(section => section.id));
  const selectedVisibleCount = [...selected]
    .filter(sectionId => visibleSectionIds.has(sectionId))
    .length;
  const trackedVisibleCount = [...trackedIds]
    .filter(sectionId => visibleSectionIds.has(sectionId))
    .length;

  function openReview() {
    setSelected(new Set(savedReportedIds));
    dirtyRef.current = false;
    setError(null);
    setOpen(true);
  }

  function abandonChanges() {
    setSelected(new Set(savedReportedIds));
    dirtyRef.current = false;
    setError(null);
    if (props.onClose) props.onClose();
    else setOpen(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await saveReportedSessionCoverage(props.sessionId, selected);
      await refreshHotspotPredictionOutcomes(session?.permissionId);
      dirtyRef.current = false;
      if (!props.stayOpenAfterSave) {
        if (props.onClose) props.onClose();
        else setOpen(false);
      }
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : 'Searched areas could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  if (!sectionsReady || !sections || sections.length === 0) return null;

  if (!open) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-800 dark:bg-emerald-950/20">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-2xs font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
              Searched areas
            </p>
            <p className="mt-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
              {savedReportedIds.size > 0
                ? `${savedReportedIds.size} ${savedReportedIds.size === 1 ? 'area' : 'areas'} marked.`
                : coveredCount > 0
                  ? `${coveredCount} ${coveredCount === 1 ? 'area was' : 'areas were'} recorded by tracking.`
                  : `Mark the parts of the ${fieldWord} you searched.`}
            </p>
          </div>
          <button
            type="button"
            onClick={openReview}
            className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2.5 text-2xs font-black uppercase tracking-widest text-white hover:bg-emerald-500"
          >
            {savedReportedIds.size > 0 ? 'Edit' : 'Mark areas'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className={props.compact
      ? 'rounded-xl border border-emerald-200 bg-gradient-to-br from-white to-emerald-50/70 p-3 shadow-sm dark:border-emerald-800/70 dark:from-gray-900 dark:to-emerald-950/20'
      : 'rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900'}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-2xs font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
            Ground coverage
          </p>
          <h4 className="mt-1 text-sm font-black leading-tight text-gray-900 dark:text-gray-100">
            Which parts of the {fieldWord} did you search?
          </h4>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Tap an area to add or remove it. Blue areas were recorded by tracking.
          </p>
        </div>
        <button
          type="button"
          onClick={abandonChanges}
          aria-label="Close ground coverage"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-sm font-bold text-gray-400 transition-colors hover:border-gray-300 hover:text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:hover:text-gray-200"
        >
          ×
        </button>
      </div>

      <SectionCoverageMap
        sections={sections ?? []}
        observations={observations}
        selectedReported={selected}
        interactive={editable}
        disabledSectionIds={trackedIds}
        onToggle={sectionId => {
          if (evidence.get(sectionId)?.tracked) return;
          dirtyRef.current = true;
          setSelected(previous => {
            const next = new Set(previous);
            if (next.has(sectionId)) next.delete(sectionId);
            else next.add(sectionId);
            return next;
          });
        }}
      />

      <div className="mt-3 flex flex-wrap gap-3 text-2xs font-bold text-gray-500 dark:text-gray-400">
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />Marked searched</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-sky-500" />Recorded by tracking</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-amber-400/60" />Find location</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2" aria-live="polite">
        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-2xs font-black text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
          {selectedVisibleCount} {selectedVisibleCount === 1 ? 'area' : 'areas'} marked
        </span>
        {trackedVisibleCount > 0 && (
          <span className="rounded-full bg-sky-100 px-2.5 py-1 text-2xs font-black text-sky-800 dark:bg-sky-950/50 dark:text-sky-300">
            {trackedVisibleCount} from tracking
          </span>
        )}
      </div>
      {error && <p className="mt-3 text-xs font-semibold text-red-600 dark:text-red-400">{error}</p>}
      {!editable && deadline && (
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          This review became read-only 48 hours after the session ended.
        </p>
      )}
      {editable && (
        <p className="mt-2 text-2xs text-gray-400 dark:text-gray-500">
          You can change this for 48 hours after finishing.
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={abandonChanges}
          className="rounded-xl border border-gray-300 bg-white py-3 text-xs font-black uppercase tracking-widest text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
        >
          {props.compact ? 'Close' : 'Not now'}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!editable || saving}
          className="rounded-xl bg-emerald-600 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-emerald-500 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Done'}
        </button>
      </div>
    </section>
  );
}
