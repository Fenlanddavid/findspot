import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Find, type Permission, type SavedPoint, type Session, type SurfaceObservation, type Track, type UndugSignal } from '../../src/db';
import {
  chooseCurrentUnfinishedSession,
  sessionStartedAt,
} from '../../src/services/session/activeSessionContext';
import { chooseMostRecentCompletedSession, getHomeContext } from '../../src/services/home/homeContext';
import {
  CONTINUITY_MAX_AGE_MS,
  resolveContinuityForPermission,
} from '../../src/services/continuity/continuityResolver';
import { reliableTrackDistanceMetres } from '../../src/services/session/sessionReview';
import { evaluateBoundaryPosition, getBoundaryBounds, locationAccuracyCircle } from '../../src/services/session/sessionFieldPosition';
import { recentSessionActivity } from '../../src/services/session/sessionActivity';
import { appendSessionNote } from '../../src/services/sessionMutations';
import { buildActiveSessionGuideHref } from '../../src/services/session/activeSessionGuideRoute';

const ISO = '2026-08-15T09:00:00.000Z';

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1', projectId: 'project-1', permissionId: 'permission-1', fieldId: null,
    date: ISO, lat: null, lon: null, gpsAccuracyM: null, landUse: '', cropType: '',
    isStubble: false, notes: '', isFinished: false, createdAt: ISO, updatedAt: ISO,
    ...overrides,
  };
}

function permission(overrides: Partial<Permission> = {}): Permission {
  return {
    id: 'permission-1', projectId: 'project-1', name: 'North Meadow', type: 'individual',
    lat: 52, lon: 0, gpsAccuracyM: 5, collector: 'Tester', landType: 'pasture',
    permissionGranted: true, notes: '', createdAt: ISO, updatedAt: ISO,
    ...overrides,
  };
}

describe('V5 context services', () => {
  beforeEach(async () => {
    await db.open();
    await Promise.all([
      db.projects.clear(), db.permissions.clear(), db.sessions.clear(), db.undugSignals.clear(),
    ]);
    await db.projects.put({ id: 'project-1', name: 'Project', region: 'England', createdAt: ISO });
  });

  it('uses the canonical visit start instead of legacy tracking start', () => {
    expect(sessionStartedAt(session({
      sessionStartedAt: '2026-08-15T08:00:00.000Z',
      startTime: '2026-08-15T09:30:00.000Z',
    }))).toBe(Date.parse('2026-08-15T08:00:00.000Z'));
  });

  it('chooses the most recently activated unfinished session with a stable ID tie-break', () => {
    const chosen = chooseCurrentUnfinishedSession([
      session({ id: 'b', activatedAt: ISO }),
      session({ id: 'a', activatedAt: ISO }),
      session({ id: 'finished', isFinished: true, activatedAt: '2026-08-16T09:00:00.000Z' }),
    ]);
    expect(chosen.session?.id).toBe('a');
    expect(chosen.otherUnfinishedSessionIds).toEqual(['b']);
  });

  it('orders completed visits by durable end time rather than array order', () => {
    const chosen = chooseMostRecentCompletedSession([
      session({ id: 'newer', isFinished: true, endTime: '2026-08-15T12:00:00.000Z' }),
      session({ id: 'older', isFinished: true, endTime: '2026-08-14T12:00:00.000Z' }),
    ]);
    expect(chosen?.id).toBe('newer');
  });

  it('returns the permission from the most recent completed visit', async () => {
    await db.permissions.bulkPut([
      permission(), permission({ id: 'permission-2', name: 'South Field' }),
    ]);
    await db.sessions.bulkPut([
      session({ id: 'older', isFinished: true, permissionId: 'permission-1', endTime: '2026-08-13T12:00:00.000Z' }),
      session({ id: 'newer', isFinished: true, permissionId: 'permission-2', endTime: '2026-08-14T12:00:00.000Z' }),
    ]);
    const context = await getHomeContext('project-1');
    expect(context.returnTo?.permission.id).toBe('permission-2');
    expect(context.returnTo?.lastVisitAt).toBe(Date.parse('2026-08-14T12:00:00.000Z'));
  });

  it('uses a stable ID tie-break across fifteen permissions with identical activity timestamps', async () => {
    await db.permissions.bulkPut(Array.from({ length: 15 }, (_, index) => permission({
      id: `permission-${String(14 - index).padStart(2, '0')}`,
      name: `Field ${index}`,
      createdAt: ISO,
      updatedAt: ISO,
    })));
    const context = await getHomeContext('project-1');
    expect(context.returnTo?.permission.id).toBe('permission-00');
  });

  it('selects one recent open signal deterministically from a 40+ backlog', async () => {
    await db.permissions.put(permission());
    const now = Date.parse(ISO);
    await db.undugSignals.bulkPut(Array.from({ length: 45 }, (_, index) => ({
      id: `signal-${String(index).padStart(2, '0')}`,
      permissionId: 'permission-1', status: 'open' as const,
      createdAt: now - index * 1_000, lat: 52, lng: 0,
    })));
    await db.undugSignals.bulkPut([
      { id: 'tie-b', permissionId: 'permission-1', status: 'open', createdAt: now, lat: 52, lng: 0 },
      { id: 'tie-a', permissionId: 'permission-1', status: 'open', createdAt: now, lat: 52, lng: 0 },
      { id: 'stale', permissionId: 'permission-1', status: 'open', createdAt: now - CONTINUITY_MAX_AGE_MS - 1, lat: 52, lng: 0 },
    ]);
    const item = await resolveContinuityForPermission('permission-1', now);
    expect(item?.sourceId).toBe('signal-00');
    expect(item?.action.href).toBe('/finds-box?tab=signals&signal=signal-00');
  });

  it('does not count track distance across an explicit GPS gap', () => {
    const track: Track = {
      id: 'track-1', projectId: 'project-1', sessionId: 'session-1', name: 'Track',
      points: [
        { lat: 52, lon: 0, timestamp: 1_000 },
        { lat: 52, lon: 0.0001, timestamp: 2_000 },
        { lat: 52, lon: 0.0002, timestamp: 3_000 },
      ],
      gaps: [{ start: 1_500, end: 2_500 }], isActive: false, color: '#000',
      createdAt: ISO, updatedAt: ISO,
    };
    const distance = reliableTrackDistanceMetres([track]);
    expect(distance).toBeGreaterThan(5);
    expect(distance).toBeLessThan(10);
  });

  it('uses GPS uncertainty when describing a recorded boundary', () => {
    const boundary = { type: 'Polygon' as const, coordinates: [[[-0.001, 51.999], [0.001, 51.999], [0.001, 52.001], [-0.001, 52.001], [-0.001, 51.999]]] };
    expect(evaluateBoundaryPosition(boundary, { lat: 52, lon: 0, accuracyM: 5 })?.kind).toBe('inside');
    expect(evaluateBoundaryPosition(boundary, { lat: 52, lon: 0.00105, accuracyM: 12 })?.kind).toBe('uncertain');
    expect(evaluateBoundaryPosition(boundary, { lat: 52, lon: 0.002, accuracyM: 5 })?.kind).toBe('outside');
    expect(locationAccuracyCircle({ lat: 52, lon: 0, accuracyM: 8 }).features).toHaveLength(1);
  });

  it('opens the active-session Guide on the recorded boundary rather than a generic point zoom', () => {
    const boundary = { type: 'Polygon' as const, coordinates: [[[-1.471, 53.38], [-1.468, 53.38], [-1.468, 53.383], [-1.471, 53.383], [-1.471, 53.38]]] };
    expect(getBoundaryBounds(boundary)).toEqual({ west: -1.471, south: 53.38, east: -1.468, north: 53.383 });
    const href = buildActiveSessionGuideHref({
      sessionId: 'session-1', permissionId: 'permission-1', fieldId: 'field-1', boundary,
      target: { lat: 53.3815, lon: -1.4695 },
    });
    const params = new URL(href, 'https://findspot.local').searchParams;
    expect(params.get('fieldId')).toBe('field-1');
    expect([params.get('west'), params.get('south'), params.get('east'), params.get('north')])
      .toEqual(['-1.471', '53.38', '-1.468', '53.383']);
  });

  it('orders recent session activity across authoritative source records', () => {
    const find = { id: 'find', objectType: 'Button', createdAt: '2026-08-15T09:03:00Z' } as Find;
    const signal = { id: 'signal', createdAt: Date.parse('2026-08-15T09:04:00Z'), status: 'open' } as UndugSignal;
    const observation = { id: 'observation', material: 'flint', observedAt: '2026-08-15T09:02:00Z' } as SurfaceObservation;
    const point = { id: 'point', label: 'Start point', createdAt: '2026-08-15T09:05:00Z' } as SavedPoint;
    expect(recentSessionActivity({ finds: [find], signals: [signal], observations: [observation], savedPoints: [point] }).map(item => item.id))
      .toEqual(['point', 'signal', 'find']);
  });

  it('appends timestamped session notes without replacing existing notes', async () => {
    await db.permissions.put(permission());
    await db.sessions.put(session({ notes: 'Existing note' }));
    const notes = await appendSessionNote('session-1', 'Rain started', new Date('2026-08-15T10:30:00Z'));
    expect(notes).toContain('Existing note');
    expect(notes).toContain('Rain started');
    expect((await db.sessions.get('session-1'))?.notes).toBe(notes);
  });
});
