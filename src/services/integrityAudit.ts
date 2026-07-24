import { FINDSPOT_CURRENT_VERSION, db, type FindSpotDB } from '../db';
import { diagLog } from './diagLog';
import { RETIRED_QUESTION_RULE_IDS } from './persistenceValidation/backup';

export const INTEGRITY_AUDIT_SCHEMA_SETTING_KEY = 'integrityAuditSchemaVersion';
export const INTEGRITY_AUDIT_SUMMARY_SETTING_KEY = 'integrityAuditSummary';

export type IntegrityAuditCounts = {
  orphanedRecords: number;
  danglingPermissionIds: number;
  retiredRules: number;
};

export type IntegrityAuditSummary = {
  checkedAt: string;
  schemaVersion: number;
  issueCount: number;
  counts: IntegrityAuditCounts;
};

type IntegrityDiagnosticLevel = 'info' | 'warn' | 'error';
type IntegrityDiagnostic = (
  level: IntegrityDiagnosticLevel,
  message: string,
  detail?: string,
) => void | Promise<void>;

type RunIntegrityAuditOptions = {
  database?: FindSpotDB;
  schemaVersion?: number;
  checkedAt?: string;
  audit?: typeof auditDatabaseIntegrity;
  diagnostic?: IntegrityDiagnostic;
};

export type IntegrityAuditRunResult =
  | { status: 'completed'; summary: IntegrityAuditSummary }
  | { status: 'skipped'; summary: IntegrityAuditSummary | null }
  | { status: 'failed'; summary: null };

function isKnownId(value: unknown, ids: Set<string>): boolean {
  return typeof value === 'string' && ids.has(value);
}

function missingOptionalId(value: unknown, ids: Set<string>): boolean {
  return typeof value === 'string' && value.length > 0 && !ids.has(value);
}

export async function auditDatabaseIntegrity(
  database: FindSpotDB = db,
  schemaVersion = FINDSPOT_CURRENT_VERSION,
  checkedAt = new Date().toISOString(),
): Promise<IntegrityAuditSummary> {
  const tables = [
    database.projects,
    database.permissions,
    database.fields,
    database.sessions,
    database.finds,
    database.significantFinds,
    database.tracks,
    database.media,
    database.savedPoints,
    database.undugSignals,
    database.findHotspotSignals,
    database.hotspotPredictions,
    database.outstandingQuestions,
    database.questionNotes,
    database.permissionSections,
    database.sessionCoverage,
  ];

  const rows = await database.transaction('r', tables, async () => {
    const [
      projects, permissions, fields, sessions, finds, significantFinds,
      tracks, media, savedPoints, undugSignals, findHotspotSignals,
      hotspotPredictions, outstandingQuestions, questionNotes,
      permissionSections, sessionCoverage,
    ] = await Promise.all([
      database.projects.toArray(),
      database.permissions.toArray(),
      database.fields.toArray(),
      database.sessions.toArray(),
      database.finds.toArray(),
      database.significantFinds.toArray(),
      database.tracks.toArray(),
      database.media.toArray(),
      database.savedPoints.toArray(),
      database.undugSignals.toArray(),
      database.findHotspotSignals.toArray(),
      database.hotspotPredictions.toArray(),
      database.outstandingQuestions.toArray(),
      database.questionNotes.toArray(),
      database.permissionSections.toArray(),
      database.sessionCoverage.toArray(),
    ]);
    return {
      projects, permissions, fields, sessions, finds, significantFinds,
      tracks, media, savedPoints, undugSignals, findHotspotSignals,
      hotspotPredictions, outstandingQuestions, questionNotes,
      permissionSections, sessionCoverage,
    };
  });

  const projectIds = new Set(rows.projects.map(row => row.id));
  const permissionIds = new Set(rows.permissions.map(row => row.id));
  const fieldIds = new Set(rows.fields.map(row => row.id));
  const sessionIds = new Set(rows.sessions.map(row => row.id));
  const findIds = new Set(rows.finds.map(row => row.id));
  const mediaOwnerIds = new Set([
    ...findIds,
    ...rows.significantFinds.map(row => row.id),
  ]);
  const sectionById = new Map(rows.permissionSections.map(row => [row.id, row]));

  let danglingPermissionIds = 0;
  for (const row of [
    ...rows.fields,
    ...rows.sessions,
    ...rows.finds,
    ...rows.significantFinds,
    ...rows.outstandingQuestions,
    ...rows.findHotspotSignals,
    ...rows.permissionSections,
    ...rows.sessionCoverage,
  ]) {
    if (!isKnownId(row.permissionId, permissionIds)) danglingPermissionIds += 1;
  }
  for (const row of [...rows.media, ...rows.undugSignals, ...rows.hotspotPredictions]) {
    if (missingOptionalId(row.permissionId, permissionIds)) danglingPermissionIds += 1;
  }

  let orphanedRecords = 0;
  for (const row of rows.permissions) {
    if (!isKnownId(row.projectId, projectIds)) orphanedRecords += 1;
  }
  for (const row of [
    ...rows.fields,
    ...rows.sessions,
    ...rows.finds,
    ...rows.significantFinds,
    ...rows.tracks,
    ...rows.media,
    ...rows.savedPoints,
  ]) {
    if (!isKnownId(row.projectId, projectIds)) orphanedRecords += 1;
  }
  for (const row of [...rows.sessions, ...rows.finds]) {
    if (missingOptionalId(row.fieldId, fieldIds)) orphanedRecords += 1;
  }
  for (const section of rows.permissionSections) {
    if (!section.retiredAt && missingOptionalId(section.fieldId, fieldIds)) orphanedRecords += 1;
    if (!section.geometryVersions.some(version =>
      version.version === section.currentGeometryVersion
    )) orphanedRecords += 1;
  }
  for (const row of [
    ...rows.finds,
    ...rows.significantFinds,
    ...rows.tracks,
    ...rows.undugSignals,
    ...rows.hotspotPredictions,
    ...rows.questionNotes,
    ...rows.sessionCoverage,
  ]) {
    if (missingOptionalId(row.sessionId, sessionIds)) orphanedRecords += 1;
  }
  for (const row of rows.significantFinds) {
    if (missingOptionalId(row.linkedFindId, findIds)) orphanedRecords += 1;
    for (const scatterFindId of row.scatterFindIds ?? []) {
      if (!findIds.has(scatterFindId)) orphanedRecords += 1;
    }
  }
  for (const row of rows.media) {
    if (missingOptionalId(row.findId, mediaOwnerIds)) orphanedRecords += 1;
  }
  for (const row of rows.undugSignals) {
    if (missingOptionalId(row.resolvedFindId, findIds)) orphanedRecords += 1;
  }
  for (const row of rows.questionNotes) {
    for (const linkedFindId of row.linkedFindIds ?? []) {
      if (!findIds.has(linkedFindId)) orphanedRecords += 1;
    }
  }
  for (const observation of rows.sessionCoverage) {
    const section = sectionById.get(observation.sectionId);
    if (!section) {
      orphanedRecords += 1;
      continue;
    }
    if (!section.geometryVersions.some(version =>
      version.version === observation.sectionGeometryVersion
    )) orphanedRecords += 1;
  }

  const retiredRules = rows.outstandingQuestions.filter(question =>
    RETIRED_QUESTION_RULE_IDS.has(question.ruleId),
  ).length;
  const counts = { orphanedRecords, danglingPermissionIds, retiredRules };

  return {
    checkedAt,
    schemaVersion,
    issueCount: orphanedRecords + danglingPermissionIds + retiredRules,
    counts,
  };
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function parseIntegrityAuditSummary(value: unknown): IntegrityAuditSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const summary = value as Partial<IntegrityAuditSummary>;
  const counts = summary.counts as Partial<IntegrityAuditCounts> | undefined;
  if (
    typeof summary.checkedAt !== 'string' ||
    !isNonNegativeInteger(summary.schemaVersion) ||
    !isNonNegativeInteger(summary.issueCount) ||
    !counts ||
    !isNonNegativeInteger(counts.orphanedRecords) ||
    !isNonNegativeInteger(counts.danglingPermissionIds) ||
    !isNonNegativeInteger(counts.retiredRules) ||
    summary.issueCount !== counts.orphanedRecords + counts.danglingPermissionIds + counts.retiredRules
  ) return null;
  return summary as IntegrityAuditSummary;
}

export async function getLatestIntegrityAuditSummary(
  database: FindSpotDB = db,
): Promise<IntegrityAuditSummary | null> {
  const row = await database.settings.get(INTEGRITY_AUDIT_SUMMARY_SETTING_KEY);
  return parseIntegrityAuditSummary(row?.value);
}

export function formatIntegrityAuditStatus(summary: IntegrityAuditSummary | null): string {
  if (!summary) return 'Data check pending.';
  if (summary.issueCount === 0) return 'Data check passed after the latest storage update.';
  return `Data check found ${summary.issueCount} possible link issue${summary.issueCount === 1 ? '' : 's'}. Your records were not changed.`;
}

function defaultDiagnostic(
  level: IntegrityDiagnosticLevel,
  message: string,
  detail?: string,
): Promise<void> {
  return diagLog[level]('integrity', message, detail);
}

export async function runIntegrityAuditAfterSchemaChange(
  options: RunIntegrityAuditOptions = {},
): Promise<IntegrityAuditRunResult> {
  const database = options.database ?? db;
  const schemaVersion = options.schemaVersion ?? FINDSPOT_CURRENT_VERSION;
  const diagnostic = options.diagnostic ?? defaultDiagnostic;

  try {
    const marker = await database.settings.get(INTEGRITY_AUDIT_SCHEMA_SETTING_KEY);
    const previousSummary = await getLatestIntegrityAuditSummary(database);
    if (marker?.value === schemaVersion) {
      return { status: 'skipped', summary: previousSummary };
    }

    const audit = options.audit ?? auditDatabaseIntegrity;
    const summary = await audit(
      database,
      schemaVersion,
      options.checkedAt ?? new Date().toISOString(),
    );
    await database.transaction('rw', database.settings, async () => {
      await database.settings.put({ key: INTEGRITY_AUDIT_SUMMARY_SETTING_KEY, value: summary });
      await database.settings.put({ key: INTEGRITY_AUDIT_SCHEMA_SETTING_KEY, value: schemaVersion });
    });

    const message = summary.issueCount === 0
      ? 'On-device data check passed'
      : `On-device data check found ${summary.issueCount} possible link issue${summary.issueCount === 1 ? '' : 's'}`;
    void diagnostic(summary.issueCount === 0 ? 'info' : 'warn', message);
    return { status: 'completed', summary };
  } catch (error) {
    void diagnostic(
      'error',
      'On-device data check could not complete',
      error instanceof Error ? error.message : String(error),
    );
    return { status: 'failed', summary: null };
  }
}
