import type { FindSpotDB } from '../../src/db';
import {
  BACKED_UP_TABLE_NAMES,
  type BackedUpTableName,
} from '../../src/services/backup/tableRegistry';

type FixtureRow = Record<string, unknown>;
type FixtureFactory = () => FixtureRow;

const ISO = '2026-07-23T12:00:00.000Z';

/**
 * One relationship-consistent row for every backed-up table. The registry
 * parity test below makes a new table fail until its deliberate fixture exists.
 */
export const BACKUP_FIXTURE_FACTORIES = {
  projects: () => ({
    id: 'project-1', name: 'Fen Edge Survey', region: 'England', createdAt: ISO,
  }),
  permissions: () => ({
    id: 'permission-1', projectId: 'project-1', name: 'South Field',
    type: 'individual', lat: 52.2053, lon: 0.1218, gpsAccuracyM: 4,
    collector: 'Alice', landType: 'arable', permissionGranted: true,
    notes: 'Written permission retained.', createdAt: ISO, updatedAt: ISO,
  }),
  fields: () => ({
    id: 'field-1', projectId: 'project-1', permissionId: 'permission-1',
    name: 'Lower paddock',
    boundary: {
      type: 'Polygon',
      coordinates: [[[0.12, 52.20], [0.13, 52.20], [0.13, 52.21], [0.12, 52.20]]],
    },
    notes: 'Winter wheat.', createdAt: ISO, updatedAt: ISO,
  }),
  sessions: () => ({
    id: 'session-1', projectId: 'project-1', permissionId: 'permission-1',
    fieldId: 'field-1', date: ISO, lat: 52.2053, lon: 0.1218, gpsAccuracyM: 4,
    landUse: 'arable', cropType: 'stubble', isStubble: true,
    notes: 'Dry conditions.', isFinished: true, createdAt: ISO, updatedAt: ISO,
  }),
  finds: () => ({
    id: 'find-1', projectId: 'project-1', permissionId: 'permission-1',
    fieldId: 'field-1', sessionId: 'session-1', findCode: 'FS-001',
    objectType: 'Coin', lat: 52.2053, lon: 0.1218, gpsAccuracyM: 4,
    osGridRef: 'TL 447 588', w3w: '', period: 'Roman', material: 'Copper alloy',
    weightG: 4.2, widthMm: 18, heightMm: 18, depthMm: 2,
    decoration: '', completeness: 'Complete', findContext: 'Ploughsoil',
    storageLocation: 'Finds tray A', notes: 'Representative fidelity marker.',
    createdAt: ISO, updatedAt: ISO,
  }),
  significantFinds: () => ({
    id: 'significant-1', projectId: 'project-1', permissionId: 'permission-1',
    sessionId: 'session-1', linkedFindId: 'find-1',
    path: 'notable_find', status: 'pas_recorded', jurisdiction: 'england_wales',
    lat: 52.2053, lon: 0.1218, gpsAccuracyM: 4, osGridRef: 'TL 447 588', w3w: '',
    preExcavationNotes: '', soilObservations: '', groundSurfacePhotoCaptured: true,
    scatterId: null, scatterFindIds: [], treasureActDraft: '',
    landownerSummary: 'Reported to the landowner.', createdAt: ISO, updatedAt: ISO,
  }),
  tracks: () => ({
    id: 'track-1', projectId: 'project-1', sessionId: 'session-1',
    name: 'First transect',
    points: [{ lat: 52.2053, lon: 0.1218, timestamp: Date.parse(ISO), accuracy: 4 }],
    isActive: false, color: '#334155', createdAt: ISO, updatedAt: ISO,
  }),
  media: () => ({
    id: 'media-1', projectId: 'project-1', findId: 'find-1',
    type: 'photo', filename: 'roman-coin.jpg', mime: 'image/jpeg',
    blob: new Blob([new Uint8Array([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9])], {
      type: 'image/jpeg',
    }),
    caption: 'In-situ photograph', scalePresent: true, createdAt: ISO,
  }),
  settings: () => ({ key: 'detectorist', value: 'Alice' }),
  importedPackages: () => ({
    id: 'package-1', packageHash: 'sha256:fixture', importedAt: ISO,
  }),
  savedPoints: () => ({
    id: 'point-1', projectId: 'project-1', label: 'Gate',
    lat: 52.2053, lon: 0.1218, zoom: 17, note: 'Vehicle access', createdAt: ISO,
  }),
  undugSignals: () => ({
    id: 'signal-1', createdAt: Date.parse(ISO), lat: 52.2054, lng: 0.1219,
    sessionId: 'session-1', permissionId: 'permission-1',
    status: 'open', direction: 'two-way', stability: 'repeatable',
  }),
  findHotspotSignals: () => ({
    signalKey: 'permission-1:gcpuuz', permissionId: 'permission-1',
    geohash6: 'gcpuuz', findCount: 1, findIds: ['find-1'],
    periodCounts: { Roman: 1 }, lastFindAt: ISO,
    lastHotspotClassification: 'Settlement Edge Candidate',
    lastHotspotScore: 72, updatedAt: Date.parse(ISO),
  }),
  hotspotPredictions: () => ({
    id: 'prediction-1', engineVersion: 'fixture-engine-v1',
    confidence: 'Developing Signal', classification: 'Settlement Edge Candidate',
    surfacedAt: Date.parse(ISO), permissionId: 'permission-1',
    sessionId: 'session-1', center: [0.1218, 52.2053],
    bounds: [[0.121, 52.205], [0.122, 52.206]],
    geohash6: 'gcpuuz', outcome: 'hit', matchedFindId: 'find-1',
  }),
  hotspotPredictionAggregates: () => ({
    id: 'fixture-engine-v1:Developing Signal', engineVersion: 'fixture-engine-v1',
    confidence: 'Developing Signal', surfacedCount: 1, searchedCount: 1,
    hitCount: 1, updatedAt: Date.parse(ISO),
  }),
  outstandingQuestions: () => ({
    id: 'question-1', permissionId: 'permission-1', ruleId: 'MOVEMENT_NO_FINDS',
    anchor: { lat: 52.2053, lon: 0.1218 }, title: 'Route alignment',
    description: 'Test the movement corridor.', category: 'MOVEMENT',
    status: 'UNRESOLVED', confidence: 0.7, createdAt: Date.parse(ISO),
    updatedAt: Date.parse(ISO), generatedByScanId: 'scan-1',
    supportingEvidence: [{ label: 'Historic route', sourceScanId: 'scan-1' }],
    contradictingEvidence: [],
  }),
  questionNotes: () => ({
    id: 'note-1', questionId: 'question-1', author: 'user',
    type: 'freeform', text: 'Check after ploughing.', createdAt: Date.parse(ISO),
  }),
} satisfies Record<BackedUpTableName, FixtureFactory>;

export async function seedBackupFixture(database: FindSpotDB): Promise<void> {
  for (const tableName of BACKED_UP_TABLE_NAMES) {
    await database.table(tableName).put(BACKUP_FIXTURE_FACTORIES[tableName]());
  }
}
