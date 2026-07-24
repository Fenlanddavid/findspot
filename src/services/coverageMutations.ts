import { db } from '../db';
import { getResolution } from 'h3-js';
import type {
  Find,
  PermissionSection,
  Session,
  SessionCoverageObservation,
} from '../db';
import {
  TRACK_SECTION_CALCULATION_VERSION,
  TRACK_SECTION_COVERAGE_THRESHOLD,
  SECTION_LAYOUT_VERSION,
  areaOverlapFraction,
  deriveSectionCandidates,
  evidenceObservationId,
  pointIsInsideArea,
  trackedSectionCoverageFraction,
} from '../engines/coverage/sectionCoverageEngine';
import {
  currentSectionGeometry,
  sectionGeometryAtVersion,
} from '../shared/coverageRecords';

export const SESSION_COVERAGE_EDIT_WINDOW_MS = 48 * 60 * 60 * 1_000;

function sessionObservedAt(session: Session): number {
  for (const candidate of [session.endTime, session.date, session.updatedAt, session.createdAt]) {
    if (!candidate) continue;
    const parsed = Date.parse(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function sessionStartedAt(session: Session): number {
  for (const candidate of [session.startTime, session.date, session.createdAt]) {
    if (!candidate) continue;
    const parsed = Date.parse(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return sessionObservedAt(session);
}

export function sessionCoverageEditDeadline(session: Session): number | null {
  if (!session.isFinished || !session.endTime) return null;
  const endTime = Date.parse(session.endTime);
  if (!Number.isFinite(endTime)) return null;
  return endTime + SESSION_COVERAGE_EDIT_WINDOW_MS;
}

export function canEditSessionCoverage(session: Session, now = Date.now()): boolean {
  const deadline = sessionCoverageEditDeadline(session);
  return deadline !== null && now <= deadline;
}

function sourceKey(fieldId: string | null): string {
  return fieldId ?? 'permission';
}

function retainedH3Resolution(sections: PermissionSection[]): number | undefined {
  const section = sections.find(candidate => {
    const geometry = currentSectionGeometry(candidate);
    return candidate.layoutKey.startsWith('h3:')
      && geometry?.boundaryHash.startsWith(`${SECTION_LAYOUT_VERSION}:`);
  });
  if (!section) return undefined;
  const cell = section.layoutKey.slice('h3:'.length);
  try {
    return getResolution(cell);
  } catch {
    return undefined;
  }
}

/**
 * Idempotently reconciles current boundaries with stable section identities.
 * A field keeps the layout mode selected on first creation; geometry edits add
 * versions instead of replacing the shapes referenced by past observations.
 */
export async function ensurePermissionSections(
  permissionId: string,
  now = new Date().toISOString(),
): Promise<PermissionSection[]> {
  const [permission, fields, existing] = await Promise.all([
    db.permissions.get(permissionId),
    db.fields.where('permissionId').equals(permissionId).toArray(),
    db.permissionSections.where('permissionId').equals(permissionId).toArray(),
  ]);
  if (!permission) return [];

  const sources = fields.length > 0
    ? fields.map(field => ({
        fieldId: field.id,
        permissionId,
        name: field.name,
        boundary: field.boundary,
      }))
    : permission.boundary
      ? [{
          fieldId: null,
          permissionId,
          name: permission.name,
          boundary: permission.boundary,
        }]
      : [];

  const nextIds = new Set<string>();
  const writes: PermissionSection[] = [];
  const sectionMigrations: Array<{
    previousSection: PermissionSection;
    replacementSections: PermissionSection[];
  }> = [];
  for (const source of sources) {
    const existingForSource = existing.filter(section => section.fieldId === source.fieldId);
    const candidates = deriveSectionCandidates(
      source,
      retainedH3Resolution(existingForSource),
    );
    const replacementSections: PermissionSection[] = [];
    for (const candidate of candidates) {
      nextIds.add(candidate.id);
      const previous = existing.find(section => section.id === candidate.id);
      if (!previous) {
        const nextSection: PermissionSection = {
          id: candidate.id,
          permissionId,
          fieldId: candidate.fieldId,
          layoutKey: candidate.layoutKey,
          label: candidate.label,
          currentGeometryVersion: 1,
          geometryVersions: [{
            version: 1,
            boundaryHash: candidate.boundaryHash,
            geometry: candidate.geometry,
            areaM2: candidate.areaM2,
            effectiveFrom: now,
          }],
          createdAt: now,
          updatedAt: now,
        };
        writes.push(nextSection);
        replacementSections.push(nextSection);
        continue;
      }

      const current = currentSectionGeometry(previous);
      if (
        current?.boundaryHash === candidate.boundaryHash
        && !previous.retiredAt
        && previous.label === candidate.label
      ) {
        replacementSections.push(previous);
        continue;
      }

      const geometryChanged = current?.boundaryHash !== candidate.boundaryHash;
      const nextVersion = geometryChanged
        ? Math.max(0, ...previous.geometryVersions.map(version => version.version)) + 1
        : previous.currentGeometryVersion;
      const nextSection: PermissionSection = {
        ...previous,
        label: candidate.label,
        currentGeometryVersion: nextVersion,
        geometryVersions: geometryChanged
          ? [...previous.geometryVersions, {
              version: nextVersion,
              boundaryHash: candidate.boundaryHash,
              geometry: candidate.geometry,
              areaM2: candidate.areaM2,
              effectiveFrom: now,
            }]
          : previous.geometryVersions,
        updatedAt: now,
        retiredAt: undefined,
      };
      writes.push(nextSection);
      replacementSections.push(nextSection);
    }
    const replacementIds = new Set(replacementSections.map(section => section.id));
    for (const previousSection of existingForSource) {
      if (
        !previousSection.retiredAt
        && !replacementIds.has(previousSection.id)
        && replacementSections.length > 0
      ) {
        sectionMigrations.push({ previousSection, replacementSections });
      }
    }
  }

  const activeSourceKeys = new Set(sources.map(source => sourceKey(source.fieldId)));
  for (const section of existing) {
    const shouldRetire = (
      !activeSourceKeys.has(sourceKey(section.fieldId))
      || !nextIds.has(section.id)
    );
    if (shouldRetire && !section.retiredAt) {
      writes.push({ ...section, retiredAt: now, updatedAt: now });
    }
  }

  if (writes.length > 0 || sectionMigrations.length > 0) {
    await db.transaction('rw', [db.permissionSections, db.sessionCoverage], async () => {
      if (writes.length > 0) await db.permissionSections.bulkPut(writes);
      for (const migration of sectionMigrations) {
        const previousReports = await db.sessionCoverage
          .where('sectionId')
          .equals(migration.previousSection.id)
          .filter(observation => observation.evidence === 'reported')
          .toArray();
        const migratedReports = previousReports.flatMap(observation => {
          const previousGeometry = sectionGeometryAtVersion(
            migration.previousSection,
            observation.sectionGeometryVersion,
          );
          if (!previousGeometry) return [];
          const overlapping = migration.replacementSections.filter(section => {
            const replacementGeometry = currentSectionGeometry(section);
            return replacementGeometry
              ? areaOverlapFraction(
                  replacementGeometry.geometry,
                  previousGeometry.geometry,
                ) >= 0.5
              : false;
          });
          return overlapping.map(section => ({
            ...observation,
            id: evidenceObservationId(
              observation.sessionId,
              section.id,
              section.currentGeometryVersion,
              'reported',
            ),
            sectionId: section.id,
            sectionGeometryVersion: section.currentGeometryVersion,
            updatedAt: now,
          }));
        });
        if (previousReports.length > 0) {
          await db.sessionCoverage.bulkDelete(previousReports.map(row => row.id));
        }
        if (migratedReports.length > 0) {
          await db.sessionCoverage.bulkPut(
            [...new Map(migratedReports.map(row => [row.id, row])).values()],
          );
        }
      }
    });
  }
  return db.permissionSections.where('permissionId').equals(permissionId)
    .filter(section => !section.retiredAt)
    .toArray();
}

function scopedSections(
  session: Session,
  sections: PermissionSection[],
): PermissionSection[] {
  if (!session.fieldId) return sections;
  return sections.filter(section => section.fieldId === session.fieldId);
}

function observationBase(input: {
  session: Session;
  section: PermissionSection;
  evidence: SessionCoverageObservation['evidence'];
  observedAt: number;
  now: string;
}): SessionCoverageObservation {
  return {
    id: evidenceObservationId(
      input.session.id,
      input.section.id,
      input.section.currentGeometryVersion,
      input.evidence,
    ),
    sessionId: input.session.id,
    permissionId: input.session.permissionId,
    sectionId: input.section.id,
    sectionGeometryVersion: input.section.currentGeometryVersion,
    evidence: input.evidence,
    startedAt: sessionStartedAt(input.session),
    observedAt: input.observedAt,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function sectionForFind(
  find: Find,
  sections: PermissionSection[],
): PermissionSection | null {
  if (find.lat == null || find.lon == null) return null;
  const matches = sections.flatMap(section => {
    const geometry = currentSectionGeometry(section);
    return geometry && pointIsInsideArea(
      { lat: find.lat!, lon: find.lon! },
      geometry.geometry,
    ) ? [{ section, areaM2: geometry.areaM2 }] : [];
  });
  matches.sort((left, right) => left.areaM2 - right.areaM2);
  return matches[0]?.section ?? null;
}

/**
 * Recomputes objective evidence for a session. User-reported observations are
 * left untouched. Find visits remain visible but never count as negative
 * prediction evidence.
 */
export async function prepareSessionCoverageEvidence(
  sessionId: string,
  now = new Date().toISOString(),
): Promise<SessionCoverageObservation[]> {
  const session = await db.sessions.get(sessionId);
  if (!session) return [];
  const sections = scopedSections(
    session,
    await ensurePermissionSections(session.permissionId, now),
  );
  const [tracks, finds] = await Promise.all([
    db.tracks.where('sessionId').equals(sessionId).toArray(),
    db.finds.where('sessionId').equals(sessionId).toArray(),
  ]);
  const observedAt = sessionObservedAt(session);
  const objective: SessionCoverageObservation[] = [];

  for (const section of sections) {
    const geometry = currentSectionGeometry(section);
    if (!geometry) continue;
    const coverageFraction = trackedSectionCoverageFraction(geometry.geometry, tracks);
    if (coverageFraction >= TRACK_SECTION_COVERAGE_THRESHOLD) {
      objective.push({
        ...observationBase({ session, section, evidence: 'tracked', observedAt, now }),
        coverageFraction,
        calculationVersion: TRACK_SECTION_CALCULATION_VERSION,
        sourceRecordIds: tracks.map(track => track.id),
      });
    }
  }

  const findIdsBySection = new Map<string, string[]>();
  for (const find of finds) {
    const section = sectionForFind(find, sections);
    if (!section) continue;
    const ids = findIdsBySection.get(section.id) ?? [];
    ids.push(find.id);
    findIdsBySection.set(section.id, ids);
  }
  for (const [sectionId, findIds] of findIdsBySection) {
    const section = sections.find(candidate => candidate.id === sectionId);
    if (!section) continue;
    objective.push({
      ...observationBase({ session, section, evidence: 'find-visited', observedAt, now }),
      sourceRecordIds: findIds,
    });
  }

  await db.transaction('rw', db.sessionCoverage, async () => {
    const previous = await db.sessionCoverage.where('sessionId').equals(sessionId)
      .filter(observation => observation.evidence !== 'reported')
      .toArray();
    const nextIds = new Set(objective.map(observation => observation.id));
    const staleIds = previous
      .filter(observation => !nextIds.has(observation.id))
      .map(observation => observation.id);
    if (staleIds.length > 0) await db.sessionCoverage.bulkDelete(staleIds);
    if (objective.length > 0) await db.sessionCoverage.bulkPut(objective);
  });
  return db.sessionCoverage.where('sessionId').equals(sessionId).toArray();
}

export async function saveReportedSessionCoverage(
  sessionId: string,
  selectedSectionIds: ReadonlySet<string>,
  nowMs = Date.now(),
): Promise<SessionCoverageObservation[]> {
  const session = await db.sessions.get(sessionId);
  if (!session) throw new Error('Session not found.');
  if (!canEditSessionCoverage(session, nowMs)) {
    throw new Error('Coverage can only be changed for 48 hours after a session ends.');
  }

  const now = new Date(nowMs).toISOString();
  const sections = scopedSections(
    session,
    await ensurePermissionSections(session.permissionId, now),
  );
  const selected = sections.filter(section => selectedSectionIds.has(section.id));
  const observedAt = sessionObservedAt(session);
  const rows = selected.map(section =>
    observationBase({ session, section, evidence: 'reported', observedAt, now })
  );

  await db.transaction('rw', db.sessionCoverage, async () => {
    const previous = await db.sessionCoverage.where('sessionId').equals(sessionId)
      .filter(observation => observation.evidence === 'reported')
      .toArray();
    const nextIds = new Set(rows.map(row => row.id));
    const removedIds = previous
      .filter(observation => !nextIds.has(observation.id))
      .map(observation => observation.id);
    if (removedIds.length > 0) await db.sessionCoverage.bulkDelete(removedIds);
    if (rows.length > 0) await db.sessionCoverage.bulkPut(rows);
  });
  return db.sessionCoverage.where('sessionId').equals(sessionId).toArray();
}

export async function retireSectionsForField(
  fieldId: string,
  now = new Date().toISOString(),
): Promise<void> {
  await db.permissionSections.where('fieldId').equals(fieldId)
    .modify(section => {
      section.retiredAt = now;
      section.updatedAt = now;
    });
}
