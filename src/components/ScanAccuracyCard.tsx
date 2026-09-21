import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { loadPredictionEvidenceCalibration } from '../services/predictionCalibration';

function StatRow({ label, value }: { label: string; value: number | string }) {
  return <div className="flex items-baseline justify-between gap-3 py-1.5">
    <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
    <span className="shrink-0 whitespace-nowrap text-sm font-bold tabular-nums text-gray-800 dark:text-gray-200">{value}</span>
  </div>;
}

export function ScanAccuracyCard({ permissionId }: { permissionId: string }) {
  const evidence = useLiveQuery(() => loadPredictionEvidenceCalibration(permissionId), [permissionId]);
  const undug = useLiveQuery(() => db.undugSignals.where('permissionId').equals(permissionId).toArray(), [permissionId]);
  if (!evidence || !undug) return null;
  const dugFind = undug.filter(row => row.status === 'dug-find').length;
  const dugNothing = undug.filter(row => row.status === 'dug-nothing').length;
  return <details className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
    <summary className="min-h-14 cursor-pointer px-5 py-3.5 text-xs font-black text-gray-800 dark:text-gray-100 sm:px-6">
      Field Guide evidence
      <span className="mt-0.5 block font-normal text-gray-500">Predictions, reported searches and associated finds</span>
    </summary>
    <div className="border-t border-gray-100 px-5 pb-5 pt-4 dark:border-gray-700 sm:px-6">
      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
        Repeat scans and overlapping targets can share the same find. Associations include finds
        inside target bounds or within 150 m of their centre. GPS visits alone do not confirm a search.
      </p>
      {evidence.cohorts.length === 0 && <p className="text-xs text-gray-500">No current prediction evidence recorded for this permission.</p>}
      {evidence.cohorts.map(cohort => <div key={cohort.key} className="mb-4 border-t border-gray-100 pt-3 dark:border-gray-700">
        <p className="text-xs font-bold text-gray-800 dark:text-gray-100">{cohort.confidence}</p>
        <p className="break-words text-2xs text-gray-500">Prediction version {cohort.engineVersion}</p>
        <StatRow label="Predictions surfaced" value={cohort.counts.surfacedCount} />
        {cohort.limited ? <p className="text-xs text-gray-500">Earlier evidence rules; search comparisons are unavailable until evidence is reviewed.</p> : <>
          <StatRow label="Accepted reported searches" value={cohort.counts.searchedCount} />
          <StatRow label="With an associated find" value={`${cohort.counts.hitCount} of ${cohort.counts.searchedCount}`} />
          {cohort.counts.searchedCount === 0 && <p className="text-xs text-gray-500">No accepted search reports yet; no search outcome rate is available.</p>}
          {cohort.counts.reportedSearchedCount > 0 && <StatRow label="Reported only: with a find / searched" value={`${cohort.counts.reportedHitCount} / ${cohort.counts.reportedSearchedCount}`} />}
          {cohort.counts.mixedSearchedCount > 0 && <StatRow label="Tracked + reported: with a find / searched" value={`${cohort.counts.mixedHitCount} / ${cohort.counts.mixedSearchedCount}`} />}
          {cohort.counts.trackedVisitCount > 0 && <StatRow label="Tracked visits (including reported searches)" value={cohort.counts.trackedVisitCount} />}
          {cohort.counts.trackedFindCount > 0 && <StatRow label="Find associations with tracking only" value={cohort.counts.trackedFindCount} />}
          {cohort.counts.findOnlyHitCount > 0 && <StatRow label="Find associations without search evidence" value={cohort.counts.findOnlyHitCount} />}
          {cohort.counts.explicitNoFindCount > 0 && <StatRow label="Explicit reports of no relevant find" value={cohort.counts.explicitNoFindCount} />}
          {cohort.counts.unresolvedCount > 0 && <StatRow label="Without a resolved search outcome" value={cohort.counts.unresolvedCount} />}
          {cohort.sharedFindCount > 0 && <p className="text-xs text-gray-500">{cohort.sharedFindCount} finds are shared by multiple predictions in this group.</p>}
        </>}
      </div>)}
      <p className="text-2xs text-gray-500">Recent predictions only (up to 180 days before archiving). No find logged is not a report of no find. These counts do not establish predictive accuracy.</p>
      {evidence.legacyExcludedCount > 0 && <p className="mt-2 text-2xs text-gray-500">{evidence.legacyExcludedCount} legacy inferred outcomes excluded.</p>}
      {undug.length > 0 && <div className="mt-4 border-t border-gray-100 pt-3 dark:border-gray-700">
        <p className="text-xs font-bold text-gray-800 dark:text-gray-100">Logged signal outcomes</p>
        <StatRow label="Dug and found / resolved dug signals" value={`${dugFind} / ${dugFind + dugNothing}`} />
        <StatRow label="Open" value={undug.filter(row => row.status === 'open').length} />
        <StatRow label="Dismissed" value={undug.filter(row => row.status === 'dismissed').length} />
        <p className="text-2xs text-gray-500">Describes the signals you chose to dig; not scan accuracy.</p>
      </div>}
    </div>
  </details>;
}
