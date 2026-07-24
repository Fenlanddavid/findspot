import React, { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { pagePersistence } from '../../services/pagePersistence';
import {
  canEditSessionCoverage,
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

export function SessionCoverageReview(props: {
  sessionId: string;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!props.initiallyOpen);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState<string | null>(null);

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
    return session.fieldId
      ? rows.filter(section => section.fieldId === session.fieldId)
      : rows;
  }, [session?.permissionId, session?.fieldId]);
  const observations = useLiveQuery(
    () => pagePersistence.sessionCoverage
      .where('sessionId')
      .equals(props.sessionId)
      .toArray(),
    [props.sessionId],
  ) ?? [];

  useEffect(() => {
    if (!open) return;
    prepareSessionCoverageEvidence(props.sessionId).catch(errorValue => {
      reportNonFatal('session-coverage', 'Could not prepare session coverage evidence', errorValue);
      setError('Coverage evidence could not be prepared.');
    });
  }, [open, props.sessionId]);

  useEffect(() => {
    if (dirty) return;
    setSelected(new Set(
      observations
        .filter(observation => observation.evidence === 'reported')
        .map(observation => observation.sectionId),
    ));
  }, [dirty, observations]);

  const evidence = useMemo(
    () => summarizeSectionEvidence(observations),
    [observations],
  );
  const editable = !!session && canEditSessionCoverage(session);
  const deadline = session ? sessionCoverageEditDeadline(session) : null;
  const coveredCount = new Set(
    observations
      .filter(observation => observation.evidence !== 'find-visited')
      .map(observation => observation.sectionId),
  ).size;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await saveReportedSessionCoverage(props.sessionId, selected);
      const resolved = await refreshHotspotPredictionOutcomes(session?.permissionId);
      const totalResolved = resolved.hits + resolved.searchedNoFind;
      setResolutionNote(totalResolved > 0
        ? `${totalResolved} predicted ${totalResolved === 1 ? 'area' : 'areas'} resolved — noted.`
        : 'Ground covered saved.');
      setDirty(false);
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : 'Coverage could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-800 dark:bg-emerald-950/20">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-2xs font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
              Ground covered
            </p>
            <p className="mt-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
              {coveredCount > 0
                ? `${coveredCount} ${coveredCount === 1 ? 'section' : 'sections'} recorded for this session.`
                : 'Mark which parts of the permission you searched.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2.5 text-2xs font-black uppercase tracking-widest text-white hover:bg-emerald-500"
          >
            {coveredCount > 0 ? 'Review' : 'Add'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-2xs font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
            Which parts did you cover today?
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Tap quiet sections you searched. Blue sections come from your track; amber marks a find location.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs font-bold text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
        >
          Close
        </button>
      </div>

      <SectionCoverageMap
        sections={sections ?? []}
        observations={observations}
        selectedReported={selected}
        interactive={editable}
        onToggle={sectionId => {
          if (evidence.get(sectionId)?.tracked) return;
          setSelected(previous => {
            const next = new Set(previous);
            if (next.has(sectionId)) next.delete(sectionId);
            else next.add(sectionId);
            return next;
          });
          setDirty(true);
          setResolutionNote(null);
        }}
      />

      <div className="mt-3 flex flex-wrap gap-3 text-2xs font-bold text-gray-500 dark:text-gray-400">
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />Reported searched</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-sky-500" />Tracked</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-amber-400/60" />Find recorded</span>
      </div>

      {resolutionNote && (
        <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
          {resolutionNote}
        </p>
      )}
      {error && <p className="mt-3 text-xs font-semibold text-red-600 dark:text-red-400">{error}</p>}
      {!editable && deadline && (
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          This review became read-only 48 hours after the session ended.
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-xl border border-gray-300 bg-white py-3 text-xs font-black uppercase tracking-widest text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!editable || saving}
          className="rounded-xl bg-emerald-600 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-emerald-500 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  );
}
