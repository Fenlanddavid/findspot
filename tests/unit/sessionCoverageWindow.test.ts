import { describe, expect, it } from 'vitest';
import type { Session } from '../../src/db';
import {
  canEditSessionCoverage,
  sessionCoverageEditDeadline,
} from '../../src/shared/sessionCoveragePolicy';
import { nextSessionCoverageDeadline } from '../../src/components/coverage/useSessionCoverageNow';

function session(endTime?: string): Session {
  return {
    id: 'session-1',
    projectId: 'project-1',
    permissionId: 'permission-1',
    fieldId: null,
    date: '2026-07-20T10:00:00.000Z',
    lat: null,
    lon: null,
    gpsAccuracyM: null,
    landUse: '',
    cropType: '',
    isStubble: false,
    notes: '',
    isFinished: true,
    endTime,
    createdAt: '2026-07-20T10:00:00.000Z',
    updatedAt: '2026-07-20T10:00:00.000Z',
  };
}

describe('session coverage recall window', () => {
  it('uses the original end time and becomes read-only after 48 hours', () => {
    const row = session('2026-07-20T12:00:00.000Z');
    expect(sessionCoverageEditDeadline(row)).toBe(Date.parse('2026-07-22T12:00:00.000Z'));
    expect(canEditSessionCoverage(row, Date.parse('2026-07-22T11:59:59.999Z'))).toBe(true);
    expect(canEditSessionCoverage(row, Date.parse('2026-07-22T12:00:00.001Z'))).toBe(false);
  });

  it('does not infer a deadline when a finished session has no end time', () => {
    expect(sessionCoverageEditDeadline(session())).toBeNull();
    expect(canEditSessionCoverage(session())).toBe(false);
  });

  it('schedules the nearest live edit deadline and drops elapsed deadlines', () => {
    const first = session('2026-07-20T12:00:00.000Z');
    const second = {
      ...session('2026-07-20T13:00:00.000Z'),
      id: 'session-2',
    };

    expect(nextSessionCoverageDeadline(
      [second, first],
      Date.parse('2026-07-22T11:00:00.000Z'),
    )).toBe(Date.parse('2026-07-22T12:00:00.000Z'));
    expect(nextSessionCoverageDeadline(
      [first],
      Date.parse('2026-07-22T12:00:00.001Z'),
    )).toBeNull();
  });
});
