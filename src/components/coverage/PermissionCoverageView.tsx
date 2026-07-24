import React, { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { pagePersistence } from '../../services/pagePersistence';
import { ensurePermissionSections } from '../../services/coverageMutations';
import { reportNonFatal } from '../../services/diagLog';
import {
  SectionCoverageMap,
  summarizeSectionEvidence,
} from './SectionCoverageMap';

function formatObservedDate(timestamp: number | null): string {
  if (timestamp === null || !Number.isFinite(timestamp)) return 'No coverage recorded';
  return new Date(timestamp).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function PermissionCoverageView(props: { permissionId: string }) {
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [setupError, setSetupError] = useState(false);

  useEffect(() => {
    ensurePermissionSections(props.permissionId).catch(error => {
      reportNonFatal('permission-coverage', 'Could not create permission sections', error);
      setSetupError(true);
    });
  }, [props.permissionId]);

  const sections = useLiveQuery(
    () => pagePersistence.permissionSections
      .where('permissionId')
      .equals(props.permissionId)
      .filter(section => !section.retiredAt)
      .toArray(),
    [props.permissionId],
  ) ?? [];
  const observations = useLiveQuery(
    () => pagePersistence.sessionCoverage
      .where('permissionId')
      .equals(props.permissionId)
      .toArray(),
    [props.permissionId],
  ) ?? [];
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

  return (
    <section
      className="lg:col-span-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-6"
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
            Reported and tracked search are shown as coverage. Find-only sections mark activity, not complete searching.
          </p>
        </div>
        <div className="flex gap-2 text-center">
          <div className="rounded-xl bg-emerald-50 px-3 py-2 dark:bg-emerald-950/30">
            <div className="text-lg font-black text-emerald-700 dark:text-emerald-300">
              {recordedCoverageSections.size}
            </div>
            <div className="text-[9px] font-black uppercase tracking-widest text-emerald-600/70">
              Coverage
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
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />Reported searched</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-sky-500" />Tracked</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-amber-400/60" />Find recorded only</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-gray-200 dark:bg-gray-600" />No coverage recorded</span>
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
                ? 'Reported searched'
                : source === 'tracked'
                  ? 'Tracked'
                  : 'Find recorded';
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
