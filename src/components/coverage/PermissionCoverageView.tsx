import React, { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { pagePersistence } from '../../services/pagePersistence';
import {
  canEditSessionCoverage,
  ensurePermissionSections,
} from '../../services/coverageMutations';
import { reportNonFatal } from '../../services/diagLog';
import {
  SectionCoverageMap,
  summarizeSectionEvidence,
} from './SectionCoverageMap';
import { SessionCoverageReview } from './SessionCoverageReview';

function formatObservedDate(timestamp: number | null): string {
  if (timestamp === null || !Number.isFinite(timestamp)) return 'Not marked searched';
  return new Date(timestamp).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function PermissionCoverageView(props: {
  permissionId: string;
  fieldId?: string;
  embedded?: boolean;
  onRequestClose?: () => void;
}) {
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [setupError, setSetupError] = useState(false);

  useEffect(() => {
    ensurePermissionSections(props.permissionId).catch(error => {
      reportNonFatal('permission-coverage', 'Could not create permission sections', error);
      setSetupError(true);
    });
  }, [props.permissionId]);

  const allSections = useLiveQuery(
    () => pagePersistence.permissionSections
      .where('permissionId')
      .equals(props.permissionId)
      .filter(section => !section.retiredAt)
      .toArray(),
    [props.permissionId],
  ) ?? [];
  const sections = props.fieldId
    ? allSections.filter(section => section.fieldId === props.fieldId)
    : allSections;
  const allObservations = useLiveQuery(
    () => pagePersistence.sessionCoverage
      .where('permissionId')
      .equals(props.permissionId)
      .toArray(),
    [props.permissionId],
  ) ?? [];
  const sectionIds = new Set(sections.map(section => section.id));
  const observations = props.fieldId
    ? allObservations.filter(observation => sectionIds.has(observation.sectionId))
    : allObservations;
  const editableSessions = useLiveQuery(
    () => pagePersistence.sessions
      .where('permissionId')
      .equals(props.permissionId)
      .filter(session => canEditSessionCoverage(session))
      .toArray(),
    [props.permissionId],
  ) ?? [];
  const reportedSessionIds = new Set(
    observations
      .filter(observation => observation.evidence === 'reported')
      .map(observation => observation.sessionId),
  );
  const latestEditableSession = editableSessions
    .filter(session =>
      !props.fieldId
      || session.fieldId === props.fieldId
      || !session.fieldId
      || reportedSessionIds.has(session.id)
    )
    .sort((left, right) =>
    Date.parse(right.endTime ?? right.updatedAt) - Date.parse(left.endTime ?? left.updatedAt)
  )[0] ?? null;
  const evidence = useMemo(
    () => summarizeSectionEvidence(observations),
    [observations],
  );
  const selectedSection = sections.find(section => section.id === selectedSectionId) ?? null;
  const selectedObservations = selectedSection
    ? observations.filter(observation => observation.sectionId === selectedSection.id)
    : [];
  const recordedCoverageSections = new Set(
    observations
      .filter(observation => observation.evidence !== 'find-visited')
      .map(observation => observation.sectionId),
  );
  const activityOnlySections = new Set(
    observations
      .filter(observation => observation.evidence === 'find-visited')
      .map(observation => observation.sectionId),
  );

  if (sections.length === 0 && !setupError) return null;

  if (latestEditableSession) {
    return (
      <SessionCoverageReview
        sessionId={latestEditableSession.id}
        fieldId={props.fieldId}
        initiallyOpen
        stayOpenAfterSave
        compact={props.embedded}
        onClose={props.onRequestClose}
      />
    );
  }

  return (
    <section
      className={props.embedded
        ? 'mt-2 rounded-xl border border-emerald-100 bg-emerald-50/30 p-3 dark:border-emerald-800/60 dark:bg-emerald-950/10'
        : 'lg:col-span-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-6'}
      aria-labelledby="permission-coverage-title"
    >
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-2xs font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
            Ground coverage
          </p>
          <h3 id="permission-coverage-title" className="mt-1 text-lg font-black text-gray-900 dark:text-gray-100">
            What has been searched
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-gray-500 dark:text-gray-400">
            Areas you marked and ground recorded by tracking are shown as searched. A find location alone does not mark the surrounding area.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-center">
          {recordedCoverageSections.size > 0 && (
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-2xs font-black text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
              Read only
            </span>
          )}
          <div className="rounded-xl bg-emerald-50 px-3 py-2 dark:bg-emerald-950/30">
            <div className="text-lg font-black text-emerald-700 dark:text-emerald-300">
              {recordedCoverageSections.size}
            </div>
            <div className="text-[9px] font-black uppercase tracking-widest text-emerald-600/70">
              Searched
            </div>
          </div>
          <div className="rounded-xl bg-amber-50 px-3 py-2 dark:bg-amber-950/30">
            <div className="text-lg font-black text-amber-700 dark:text-amber-300">
              {activityOnlySections.size}
            </div>
            <div className="text-[9px] font-black uppercase tracking-widest text-amber-600/70">
              Find activity
            </div>
          </div>
        </div>
      </div>

      {recordedCoverageSections.size > 0 && (
        <p className="-mt-1 mb-3 text-2xs font-semibold text-gray-400 dark:text-gray-500">
          Past coverage is shown here. A finished session can be adjusted for 48 hours.
        </p>
      )}

      {setupError ? (
        <p className="rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-600 dark:bg-red-950/20 dark:text-red-400">
          Coverage sections could not be prepared.
        </p>
      ) : (
        <SectionCoverageMap
          sections={sections}
          observations={observations}
          selectedSectionId={selectedSectionId}
          onInspect={setSelectedSectionId}
        />
      )}

      <div className="mt-3 flex flex-wrap gap-3 text-2xs font-bold text-gray-500 dark:text-gray-400">
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />Marked searched</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-sky-500" />Recorded by tracking</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-amber-400/60" />Find location only</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-gray-200 dark:bg-gray-600" />Not marked</span>
      </div>

      {selectedSection && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-black text-gray-800 dark:text-gray-100">{selectedSection.label}</p>
            <button
              type="button"
              onClick={() => setSelectedSectionId(null)}
              className="text-xs font-bold text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              Close
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {formatObservedDate(evidence.get(selectedSection.id)?.latestObservedAt ?? null)}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(['reported', 'tracked', 'find-visited'] as const).map(source => {
              const count = selectedObservations.filter(
                observation => observation.evidence === source,
              ).length;
              if (count === 0) return null;
              const label = source === 'reported'
                ? 'Marked searched'
                : source === 'tracked'
                  ? 'Recorded by tracking'
                  : 'Find location';
              return (
                <span
                  key={source}
                  className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-2xs font-black text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                >
                  {label} · {count}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
