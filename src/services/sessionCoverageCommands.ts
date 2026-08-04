import type { SessionCoverageObservation } from '../shared/coverageTypes';
import { db } from '../db';
import { reportNonFatal } from './diagLog';
import {
  ensurePermissionSections,
  prepareSessionCoverageEvidence,
  saveReportedSessionCoverage,
} from './coverageMutations';
import {
  aggregateAndSweepHotspotPredictions,
  refreshHotspotPredictionOutcomes,
} from './hotspotPredictionService';

export type SaveSessionSearchedAreasResult = {
  observations: SessionCoverageObservation[];
  predictionRefresh: 'completed' | 'pending';
};

export async function preparePermissionSearchedAreas(
  permissionId: string,
): Promise<void> {
  try {
    await ensurePermissionSections(permissionId);
  } catch (error) {
    reportNonFatal(
      'permission-coverage',
      'Could not prepare searched areas',
      error,
    );
    throw error;
  }
}

export async function prepareSessionSearchedAreas(
  sessionId: string,
): Promise<SessionCoverageObservation[]> {
  try {
    const observations = await prepareSessionCoverageEvidence(sessionId);
    const session = await db.sessions.get(sessionId);
    if (session) {
      try {
        await refreshHotspotPredictionOutcomes(session.permissionId);
        await aggregateAndSweepHotspotPredictions();
      } catch (error) {
        reportNonFatal(
          'session-coverage',
          'Coverage prepared but prediction outcomes could not be refreshed',
          error,
        );
      }
    }
    return observations;
  } catch (error) {
    reportNonFatal(
      'session-coverage',
      'Could not prepare session coverage evidence',
      error,
    );
    throw error;
  }
}

export async function saveSessionSearchedAreas(input: {
  sessionId: string;
  selectedSectionIds: ReadonlySet<string>;
}): Promise<SaveSessionSearchedAreasResult> {
  const session = await db.sessions.get(input.sessionId);
  if (!session) throw new Error('Session not found.');
  const observations = await saveReportedSessionCoverage(
    input.sessionId,
    input.selectedSectionIds,
  );
  try {
    await refreshHotspotPredictionOutcomes(session.permissionId);
    await aggregateAndSweepHotspotPredictions();
    return { observations, predictionRefresh: 'completed' };
  } catch (error) {
    reportNonFatal(
      'session-coverage',
      'Coverage saved but prediction outcomes could not be refreshed',
      error,
    );
    return { observations, predictionRefresh: 'pending' };
  }
}
