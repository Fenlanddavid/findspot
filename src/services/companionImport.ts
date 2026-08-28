import type {
  CompanionImportLedger,
  CompanionRecordingRecord,
  CompanionSegmentRule,
  Session,
  Track,
} from '../db';
import { db } from '../db';
import {
  validateCompanionRecordingJson,
  type CompanionRecording,
  type ValidatedCompanionRecording,
} from '../shared/companionRecording';
import { prepareSessionCoverageEvidence } from './coverageMutations';
import { reportNonFatal } from './diagLog';
import { refreshHotspotPredictionOutcomes } from './hotspotPredictionService';
import { MAX_COMPANION_FILE_BYTES } from '../shared/companionLimits';

export type CompanionImportPreview = ValidatedCompanionRecording & {
  startedAt: Date;
  stoppedAt: Date | null;
  segmentCount: number;
  durationMs: number | null;
};

export type CompanionImportResult = {
  recordingUuid: string;
  sessionId: string;
  trackIds: string[];
  alreadyImported: boolean;
  derivationStatus: CompanionImportLedger['derivationStatus'];
};

function trackId(recordingUuid: string, segmentIndex: number): string {
  return `companion:${recordingUuid}:segment:${segmentIndex}`;
}

function trackColor(segmentIndex: number): string {
  const colors = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#ef4444'];
  return colors[segmentIndex % colors.length];
}

function defaultRules(recording: CompanionRecording): CompanionSegmentRule[] {
  return recording.segments.map(segment => ({
    segmentIndex: segment.segmentIndex,
    includeFromSequence: null,
    includeToSequence: null,
  }));
}

function materializeTracks(
  recording: CompanionRecording,
  session: Session,
  rules: CompanionSegmentRule[],
  now: string,
): Track[] {
  const rulesBySegment = new Map(rules.map(rule => [rule.segmentIndex, rule]));
  return recording.segments.map(segment => {
    const rule = rulesBySegment.get(segment.segmentIndex);
    const observations = segment.observations.filter(observation => (
      (rule?.includeFromSequence == null || observation.sequence >= rule.includeFromSequence)
      && (rule?.includeToSequence == null || observation.sequence <= rule.includeToSequence)
    ));
    return {
      id: trackId(recording.recordingUuid, segment.segmentIndex),
      projectId: session.projectId,
      sessionId: session.id,
      name: recording.segments.length === 1
        ? 'Companion recording'
        : `Companion segment ${segment.segmentIndex + 1}`,
      points: observations.map(observation => ({
        lat: observation.latitude,
        lon: observation.longitude,
        timestamp: observation.timestampUtc,
        accuracy: observation.horizontalAccuracyM ?? undefined,
        sourceSequence: observation.sequence,
        altitudeM: observation.altitudeM,
        verticalAccuracyM: observation.verticalAccuracyM,
        headingDegrees: observation.headingDegrees,
        speedMps: observation.speedMps,
        provider: observation.provider,
      })),
      isActive: false,
      color: trackColor(segment.segmentIndex),
      createdAt: new Date(segment.startedAtUtc).toISOString(),
      updatedAt: now,
      sourceRecordingUuid: recording.recordingUuid,
      sourceSegmentIndex: segment.segmentIndex,
    };
  });
}

export async function inspectCompanionRecording(
  input: File | string,
): Promise<CompanionImportPreview> {
  if (input instanceof File && input.size > MAX_COMPANION_FILE_BYTES) {
    throw new Error(`Companion recording exceeds the ${MAX_COMPANION_FILE_BYTES / (1024 * 1024)} MB limit.`);
  }
  const originalJson = typeof input === 'string' ? input : await input.text();
  const validated = await validateCompanionRecordingJson(originalJson);
  const stoppedAt = validated.recording.stoppedAtUtc === null
    ? null
    : new Date(validated.recording.stoppedAtUtc);
  return {
    ...validated,
    startedAt: new Date(validated.recording.startedAtUtc),
    stoppedAt,
    segmentCount: validated.recording.segments.length,
    durationMs: stoppedAt
      ? Math.max(0, stoppedAt.getTime() - validated.recording.startedAtUtc)
      : null,
  };
}

async function completeDerivedEvidence(
  recordingUuid: string,
  session: Session,
): Promise<CompanionImportLedger['derivationStatus']> {
  try {
    await prepareSessionCoverageEvidence(session.id);
    await refreshHotspotPredictionOutcomes(session.permissionId);
    await db.companionImports.update(recordingUuid, {
      derivationStatus: 'ready',
      derivationError: undefined,
      updatedAt: new Date().toISOString(),
    });
    return 'ready';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.companionImports.update(recordingUuid, {
      derivationStatus: 'failed',
      derivationError: message,
      updatedAt: new Date().toISOString(),
    });
    reportNonFatal('companion-import', 'Recording imported but derivation failed', error);
    return 'failed';
  }
}

export async function importCompanionRecording(
  preview: CompanionImportPreview,
  sessionId: string,
  sessionToCreate?: Session,
): Promise<CompanionImportResult> {
  const { recording } = preview;
  const session = sessionToCreate ?? await db.sessions.get(sessionId);
  if (!session) throw new Error('Select a session that still exists on this device.');
  if (session.id !== sessionId) throw new Error('New-session association does not match the requested session.');

  const [sameUuid, sameHash] = await Promise.all([
    db.companionImports.get(recording.recordingUuid),
    db.companionImports.where('contentHash').equals(recording.contentHash).first(),
  ]);
  if (sameUuid) {
    if (sameUuid.contentHash !== recording.contentHash) {
      throw new Error('This recording UUID was already imported with different content.');
    }
    return {
      recordingUuid: recording.recordingUuid,
      sessionId: sameUuid.sessionId,
      trackIds: sameUuid.trackIds,
      alreadyImported: true,
      derivationStatus: sameUuid.derivationStatus,
    };
  }
  if (sameHash) {
    throw new Error('These observations were already imported under another recording UUID.');
  }

  const now = new Date().toISOString();
  const rules = defaultRules(recording);
  const tracks = materializeTracks(recording, session, rules, now);
  const immutable: CompanionRecordingRecord = {
    id: recording.recordingUuid,
    contentHash: recording.contentHash,
    schemaVersion: recording.schemaVersion,
    producerName: recording.producer.name,
    producerVersion: recording.producer.version,
    producerPlatform: recording.producer.platform,
    associatedSessionId: session.id,
    originalJson: preview.originalJson,
    pointCount: preview.pointCount,
    importedAt: now,
    createdAt: new Date(recording.createdAtUtc).toISOString(),
    updatedAt: now,
  };
  const ledger: CompanionImportLedger = {
    id: recording.recordingUuid,
    contentHash: recording.contentHash,
    recordingId: recording.recordingUuid,
    sessionId: session.id,
    trackIds: tracks.map(track => track.id),
    segmentRules: rules,
    derivationStatus: 'pending',
    importedAt: now,
    updatedAt: now,
  };

  await db.transaction(
    'rw',
    [db.sessions, db.companionRecordings, db.companionImports, db.tracks],
    async () => {
      // Repeat conflict checks inside the transaction so two entry paths cannot
      // race file-picker and share-target imports into duplicate tracks.
      const existingUuid = await db.companionImports.get(recording.recordingUuid);
      const existingHash = await db.companionImports
        .where('contentHash').equals(recording.contentHash).first();
      if (existingUuid || existingHash) {
        throw new Error('This Companion recording was imported concurrently.');
      }
      if (sessionToCreate) {
        if (await db.sessions.get(sessionToCreate.id)) throw new Error('The new session already exists.');
        await db.sessions.add(sessionToCreate);
      } else if (!await db.sessions.get(sessionId)) {
        throw new Error('The selected session no longer exists.');
      } else {
        await db.sessions.update(sessionId, { updatedAt: now });
      }
      await db.companionRecordings.add(immutable);
      await db.companionImports.add(ledger);
      if (tracks.length > 0) await db.tracks.bulkAdd(tracks);
    },
  );

  const derivationStatus = await completeDerivedEvidence(recording.recordingUuid, session);
  return {
    recordingUuid: recording.recordingUuid,
    sessionId: session.id,
    trackIds: ledger.trackIds,
    alreadyImported: false,
    derivationStatus,
  };
}

export async function regenerateCompanionTracks(recordingUuid: string): Promise<string[]> {
  const [stored, ledger] = await Promise.all([
    db.companionRecordings.get(recordingUuid),
    db.companionImports.get(recordingUuid),
  ]);
  if (!stored || !ledger) throw new Error('Companion recording is missing its import ledger.');
  const session = await db.sessions.get(ledger.sessionId);
  if (!session) throw new Error('The associated session no longer exists.');
  const validated = await validateCompanionRecordingJson(stored.originalJson);
  if (validated.recording.contentHash !== ledger.contentHash) {
    throw new Error('Stored Companion recording no longer matches its import ledger.');
  }

  const now = new Date().toISOString();
  const tracks = materializeTracks(validated.recording, session, ledger.segmentRules, now);
  await db.transaction('rw', [db.tracks, db.companionImports], async () => {
    if (ledger.trackIds.length > 0) await db.tracks.bulkDelete(ledger.trackIds);
    if (tracks.length > 0) await db.tracks.bulkPut(tracks);
    await db.companionImports.update(recordingUuid, {
      trackIds: tracks.map(track => track.id),
      derivationStatus: 'pending',
      derivationError: undefined,
      updatedAt: now,
    });
  });
  await completeDerivedEvidence(recordingUuid, session);
  return tracks.map(track => track.id);
}

export async function retryPendingCompanionDerivations(): Promise<void> {
  const pending = await db.companionImports
    .where('derivationStatus').equals('pending')
    .toArray();
  for (const entry of pending) {
    try {
      await regenerateCompanionTracks(entry.recordingId);
    } catch (error) {
      reportNonFatal('companion-import', 'Could not recover Companion derivation', error);
    }
  }
}

export async function applyCompanionTrackTrim(
  track: Track,
  points: Track['points'],
  updatedAt: string,
): Promise<boolean> {
  if (track.sourceRecordingUuid == null || track.sourceSegmentIndex == null) return false;
  const sequences = points
    .map(point => point.sourceSequence)
    .filter((sequence): sequence is number => sequence !== undefined)
    .sort((left, right) => left - right);
  if (sequences.length === 0) {
    throw new Error('A Companion-derived segment cannot be trimmed to zero observations.');
  }
  const ledger = await db.companionImports.get(track.sourceRecordingUuid);
  if (!ledger) throw new Error('Companion import ledger is missing.');
  const segmentRules = ledger.segmentRules.map(rule => (
    rule.segmentIndex === track.sourceSegmentIndex
      ? {
          ...rule,
          includeFromSequence: sequences[0],
          includeToSequence: sequences[sequences.length - 1],
        }
      : rule
  ));
  await db.transaction('rw', [db.companionImports, db.tracks], async () => {
    await db.companionImports.update(ledger.id, {
      segmentRules,
      derivationStatus: 'pending',
      updatedAt,
    });
    await db.tracks.update(track.id, { points, updatedAt });
  });
  return true;
}
