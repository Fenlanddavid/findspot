import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, type Session } from '../../src/db';
import {
  companionPayloadHash,
  validateCompanionRecordingJson,
  type CompanionRecording,
} from '../../src/shared/companionRecording';

vi.mock('../../src/services/coverageMutations', () => ({
  prepareSessionCoverageEvidence: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/services/hotspotPredictionService', () => ({
  refreshHotspotPredictionOutcomes: vi.fn().mockResolvedValue({ hits: 0, searchedNoFind: 0 }),
}));

const {
  applyCompanionTrackTrim,
  importCompanionRecording,
  inspectCompanionRecording,
  regenerateCompanionTracks,
} = await import('../../src/services/companionImport');

async function recordingFixture(
  recordingUuid = '00000000-0000-4000-8000-000000000001',
): Promise<CompanionRecording> {
  const recording: CompanionRecording = {
    schemaVersion: 1,
    producer: { name: 'FindSpot Companion', version: '1.0.0', platform: 'android' },
    recordingUuid,
    contentHash: `sha256:${'0'.repeat(64)}`,
    createdAtUtc: 1_785_499_200_000,
    startedAtUtc: 1_785_499_200_000,
    stoppedAtUtc: 1_785_499_260_000,
    state: 'stopped',
    interruptionReason: null,
    segments: [0, 1].map(segmentIndex => ({
      segmentIndex,
      startedAtUtc: 1_785_499_200_000 + segmentIndex * 40_000,
      endedAtUtc: 1_785_499_220_000 + segmentIndex * 40_000,
      observations: [0, 1].map(offset => ({
        type: 'trackPoint' as const,
        sequence: segmentIndex * 2 + offset,
        timestampUtc: 1_785_499_200_000 + segmentIndex * 40_000 + offset * 10_000,
        monotonicTimestampNs: String(1_000_000_000 + segmentIndex * 20_000_000 + offset),
        receivedTimestampUtc: 1_785_499_200_100 + segmentIndex * 40_000 + offset * 10_000,
        latitude: 52.2053 + segmentIndex * 0.001 + offset * 0.0001,
        longitude: 0.1218 + segmentIndex * 0.001 + offset * 0.0001,
        altitudeM: 8.2,
        horizontalAccuracyM: 4,
        verticalAccuracyM: 6,
        headingDegrees: 90,
        speedMps: 1.1,
        provider: 'fused',
      })),
    })),
  };
  recording.contentHash = await companionPayloadHash(recording);
  return recording;
}

async function seedSession(): Promise<Session> {
  const now = new Date().toISOString();
  await db.projects.add({ id: 'project-1', name: 'Project', region: 'England', createdAt: now });
  await db.permissions.add({
    id: 'permission-1', projectId: 'project-1', name: 'Field', type: 'individual',
    lat: null, lon: null, gpsAccuracyM: null, collector: '', landType: 'arable',
    permissionGranted: true, notes: '', createdAt: now, updatedAt: now,
  });
  const session: Session = {
    id: 'session-1', projectId: 'project-1', permissionId: 'permission-1', fieldId: null,
    date: now, lat: null, lon: null, gpsAccuracyM: null, landUse: '', cropType: '',
    isStubble: false, notes: '', isFinished: true, createdAt: now, updatedAt: now,
  };
  await db.sessions.add(session);
  return session;
}

beforeEach(async () => {
  db.close();
  await Dexie.delete('findspot_uk');
  await db.open();
});

describe('Companion recording contract', () => {
  it('matches the native canonical hash fixture', async () => {
    const recording: CompanionRecording = {
      schemaVersion: 1,
      producer: { name: 'FindSpot Companion', version: '1.0.0', platform: 'android' },
      recordingUuid: '00000000-0000-4000-8000-000000000001',
      contentHash: `sha256:${'0'.repeat(64)}`,
      createdAtUtc: 900,
      startedAtUtc: 1000,
      stoppedAtUtc: 2000,
      state: 'stopped', interruptionReason: null,
      segments: [{
        segmentIndex: 0, startedAtUtc: 1000, endedAtUtc: 2000,
        observations: [{
          type: 'trackPoint', sequence: 0, timestampUtc: 1000,
          monotonicTimestampNs: '500', receivedTimestampUtc: 1001,
          latitude: 52.2, longitude: 0.12, altitudeM: 8,
          horizontalAccuracyM: 4, verticalAccuracyM: 6,
          headingDegrees: 90, speedMps: 1.1, provider: 'gps',
        }],
      }],
    };
    expect(await companionPayloadHash(recording)).toBe(
      'sha256:620f272a33301657a760f8a34fcd01aef6f434223d3876459da53696f07ddcb2',
    );
  });

  it('validates a hashed lossless recording and rejects tampering', async () => {
    const recording = await recordingFixture();
    const valid = await validateCompanionRecordingJson(JSON.stringify(recording));
    expect(valid.pointCount).toBe(4);

    recording.segments[0].observations[0].latitude += 0.01;
    await expect(validateCompanionRecordingJson(JSON.stringify(recording)))
      .rejects.toThrow(/content hash/i);
  });

  it('uses sequence as canonical order and rejects cross-segment regressions', async () => {
    const recording = await recordingFixture();
    recording.segments[1].observations[0].sequence = 1;
    recording.contentHash = await companionPayloadHash(recording);
    await expect(validateCompanionRecordingJson(JSON.stringify(recording)))
      .rejects.toThrow(/strictly increasing/i);
  });
});

describe('Companion import pipeline', () => {
  it('atomically preserves the source and materialises one track per segment', async () => {
    await seedSession();
    const recording = await recordingFixture();
    const preview = await inspectCompanionRecording(JSON.stringify(recording));
    const imported = await importCompanionRecording(preview, 'session-1');

    expect(imported).toMatchObject({ alreadyImported: false, derivationStatus: 'ready' });
    expect(await db.companionRecordings.get(recording.recordingUuid)).toMatchObject({
      contentHash: recording.contentHash,
      pointCount: 4,
      associatedSessionId: 'session-1',
    });
    const tracks = await db.tracks.where('sessionId').equals('session-1').sortBy('sourceSegmentIndex');
    expect(tracks).toHaveLength(2);
    expect(tracks.map(track => track.points.map(point => point.sourceSequence)))
      .toEqual([[0, 1], [2, 3]]);
  });

  it('makes repeat imports no-ops and rejects duplicate content under another UUID', async () => {
    await seedSession();
    const recording = await recordingFixture();
    const preview = await inspectCompanionRecording(JSON.stringify(recording));
    await importCompanionRecording(preview, 'session-1');
    await expect(importCompanionRecording(preview, 'session-1')).resolves.toMatchObject({
      alreadyImported: true,
    });

    const duplicate = await recordingFixture('00000000-0000-4000-8000-000000000002');
    expect(duplicate.contentHash).toBe(recording.contentHash);
    await expect(importCompanionRecording(
      await inspectCompanionRecording(JSON.stringify(duplicate)),
      'session-1',
    )).rejects.toThrow(/another recording UUID/i);
    expect(await db.tracks.count()).toBe(2);
  });

  it('persists a trim rule and reapplies it during regeneration', async () => {
    await seedSession();
    const recording = await recordingFixture();
    await importCompanionRecording(
      await inspectCompanionRecording(JSON.stringify(recording)),
      'session-1',
    );
    const track = (await db.tracks.get(`companion:${recording.recordingUuid}:segment:0`))!;
    await applyCompanionTrackTrim(track, [track.points[1]], new Date().toISOString());
    await regenerateCompanionTracks(recording.recordingUuid);
    expect((await db.tracks.get(track.id))?.points.map(point => point.sourceSequence)).toEqual([1]);
  });
});
