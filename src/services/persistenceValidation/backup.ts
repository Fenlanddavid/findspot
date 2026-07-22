import type { NormalizedBackupInput } from '../backup/normalization';
import {
  MAX_BACKUP_RECORDS,
  type BackupValidationOptions,
  type UnvalidatedRow,
  type ValidatedBackupData,
  type ValidatedBackupMedia,
} from '../backup/schema';

function assertRowsHaveId(rows: UnvalidatedRow[], table: string) {
  rows.forEach((row, index) => {
    if (typeof row.id !== 'string' || !row.id.trim()) {
      throw new Error(`Invalid format: ${table}[${index}] is missing an id`);
    }
  });
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function assertPermissionIntelligence(permission: UnvalidatedRow, index: number) {
  const invalid = (field: string) => new Error(`Invalid format: permissions[${index}] has an invalid ${field}`);

  if (permission.protectionStatus !== undefined) {
    const status = permission.protectionStatus as UnvalidatedRow;
    if (!status || typeof status !== 'object' || Array.isArray(status)) throw invalid('protectionStatus');
    if (!new Set(['present', 'clear', 'unknown']).has(status.state as string)) {
      throw invalid('protectionStatus.state');
    }
    if (!isIsoDateString(status.evaluatedAt)) throw invalid('protectionStatus.evaluatedAt');
    if (status.monumentCount !== undefined &&
        (!Number.isInteger(status.monumentCount) || (status.monumentCount as number) < 0)) {
      throw invalid('protectionStatus.monumentCount');
    }
  }

  if (permission.pasContext !== undefined) {
    const context = permission.pasContext as UnvalidatedRow;
    if (!context || typeof context !== 'object' || Array.isArray(context)) throw invalid('pasContext');
    if (!Number.isInteger(context.count) || (context.count as number) < 0) throw invalid('pasContext.count');
    for (const field of ['topPeriods', 'topTypes'] as const) {
      if (!Array.isArray(context[field]) || context[field].length > 3 ||
          context[field].some((value: unknown) => typeof value !== 'string')) {
        throw invalid(`pasContext.${field}`);
      }
    }
    if (!isIsoDateString(context.evaluatedAt)) throw invalid('pasContext.evaluatedAt');
  }
}

const QUESTION_RULE_IDS = new Set([
  'MOVEMENT_NO_FINDS',
  'SETTLEMENT_QUIET',
  'UNRECORDED_ROUTE',
  'ROMAN_ROUTE_ACTIVITY',
]);

/** Retired IDs remain readable in old backups and are removed before restore. */
export const RETIRED_QUESTION_RULE_IDS = new Set([
  'PUBLIC_RECORD_CONTEXT',
  'COVERAGE_GAP',
  'PROTECTED_AREA_EXCLUSION',
]);

const QUESTION_CATEGORIES = new Set(['MOVEMENT', 'COVERAGE', 'CONTRADICTION', 'HISTORIC_CONTEXT']);
const QUESTION_STATUSES = new Set(['UNRESOLVED', 'NEEDS_EVIDENCE', 'WEAKENING', 'RESOLVED']);
const QUESTION_RESOLVED_REASONS = new Set(['preconditions_cleared', 'superseded', 'cap_evicted']);
const QUESTION_HYPOTHESES = new Set([
  'activity_follows_route',
  'settlement_signal_reflects_activity',
  'route_signal_is_historic',
  'activity_associated_with_roman_road',
]);
const QUESTION_RESOLVED_OUTCOMES = new Set([
  'likely_supported', 'likely_unsupported', 'inconclusive_adequate', 'not_applicable',
]);

function assertInvestigationMetrics(
  value: unknown,
  invalid: (field: string) => Error,
  field: string,
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(field);
  const metrics = value as UnvalidatedRow;
  if (!Number.isFinite(metrics.bufferM) || (metrics.bufferM as number) <= 0) throw invalid(`${field}.bufferM`);
  if (metrics.localCoveragePct !== undefined &&
      (!Number.isFinite(metrics.localCoveragePct) || (metrics.localCoveragePct as number) < 0 ||
       (metrics.localCoveragePct as number) > 100)) {
    throw invalid(`${field}.localCoveragePct`);
  }
  if (metrics.findsNearCount !== undefined &&
      (!Number.isInteger(metrics.findsNearCount) || (metrics.findsNearCount as number) < 0)) {
    throw invalid(`${field}.findsNearCount`);
  }
}

function assertOutstandingQuestion(question: UnvalidatedRow, index: number) {
  const invalid = (field: string) => new Error(`Invalid format: outstandingQuestions[${index}] has an invalid ${field}`);
  if (!QUESTION_RULE_IDS.has(question.ruleId as string) &&
      !RETIRED_QUESTION_RULE_IDS.has(question.ruleId as string)) throw invalid('ruleId');
  if (!QUESTION_CATEGORIES.has(question.category as string)) throw invalid('category');
  if (!QUESTION_STATUSES.has(question.status as string)) throw invalid('status');

  const anchor = question.anchor as UnvalidatedRow;
  if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor) ||
      !Number.isFinite(anchor.lat) || (anchor.lat as number) < -90 || (anchor.lat as number) > 90 ||
      !Number.isFinite(anchor.lon) || (anchor.lon as number) < -180 || (anchor.lon as number) > 180) {
    throw invalid('anchor');
  }
  if (typeof question.title !== 'string' || !question.title.trim()) throw invalid('title');
  if (typeof question.description !== 'string' || !question.description.trim()) throw invalid('description');
  if (!Number.isFinite(question.confidence) || (question.confidence as number) < 0 ||
      (question.confidence as number) > 1) throw invalid('confidence');
  if (!Number.isFinite(question.createdAt) || !Number.isFinite(question.updatedAt)) throw invalid('timestamps');
  if (typeof question.generatedByScanId !== 'string' || !question.generatedByScanId.trim()) {
    throw invalid('generatedByScanId');
  }
  if (question.resolvedReason !== undefined &&
      !QUESTION_RESOLVED_REASONS.has(question.resolvedReason as string)) throw invalid('resolvedReason');
  if (question.resolvedAt !== undefined && !Number.isFinite(question.resolvedAt)) throw invalid('resolvedAt');
  if (question.consecutiveMisses !== undefined &&
      (!Number.isInteger(question.consecutiveMisses) || (question.consecutiveMisses as number) < 0)) {
    throw invalid('consecutiveMisses');
  }
  if (question.dismissedByUser !== undefined && typeof question.dismissedByUser !== 'boolean') {
    throw invalid('dismissedByUser');
  }
  if (question.hypothesisId !== undefined && !QUESTION_HYPOTHESES.has(question.hypothesisId as string)) {
    throw invalid('hypothesisId');
  }
  if (question.metrics !== undefined) assertInvestigationMetrics(question.metrics, invalid, 'metrics');
  if (question.initialMetrics !== undefined) assertInvestigationMetrics(question.initialMetrics, invalid, 'initialMetrics');
  if (question.contextGeometry !== undefined) {
    if (!Array.isArray(question.contextGeometry) || question.contextGeometry.length < 2 ||
        question.contextGeometry.length > 50 || question.contextGeometry.some((point: unknown) =>
          !Array.isArray(point) || point.length !== 2 ||
          !Number.isFinite(point[0]) || point[0] < -180 || point[0] > 180 ||
          !Number.isFinite(point[1]) || point[1] < -90 || point[1] > 90
        )) {
      throw invalid('contextGeometry');
    }
  }
  if (question.resolvedOutcome !== undefined &&
      !QUESTION_RESOLVED_OUTCOMES.has(question.resolvedOutcome as string)) throw invalid('resolvedOutcome');
  if (question.resolvedOutcome !== undefined && question.status !== 'RESOLVED') throw invalid('resolvedOutcome');
  if (question.priorityState !== undefined) {
    const priorityState = question.priorityState as UnvalidatedRow;
    if (!priorityState || typeof priorityState !== 'object' || Array.isArray(priorityState) ||
        !Number.isInteger(priorityState.scansSinceEvidenceChange) ||
        (priorityState.scansSinceEvidenceChange as number) < 0) {
      throw invalid('priorityState');
    }
  }
  if (question.supersededByIds !== undefined &&
      (!Array.isArray(question.supersededByIds) || question.supersededByIds.length === 0 ||
       question.supersededByIds.some((id: unknown) => typeof id !== 'string' || !id.trim()))) {
    throw invalid('supersededByIds');
  }

  for (const field of ['supportingEvidence', 'contradictingEvidence'] as const) {
    if (!Array.isArray(question[field]) || question[field].some((value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return true;
      const evidence = value as UnvalidatedRow;
      return typeof evidence.label !== 'string' || !evidence.label.trim() ||
        typeof evidence.sourceScanId !== 'string' || !evidence.sourceScanId.trim();
    })) {
      throw invalid(field);
    }
  }
}

export function validatePersistedBackupTables(
  input: NormalizedBackupInput,
  options?: BackupValidationOptions,
): ValidatedBackupData {
  const backup = input.tables;
  const recordCount = Object.values(backup).reduce((total, rows) => total + rows.length, 0);
  if (recordCount > MAX_BACKUP_RECORDS) {
    throw new Error(`Invalid backup file: contains more than ${MAX_BACKUP_RECORDS.toLocaleString()} records.`);
  }

  for (const table of [
    'projects', 'permissions', 'fields', 'sessions', 'finds', 'significantFinds',
    'tracks', 'media', 'importedPackages', 'savedPoints', 'undugSignals',
    'outstandingQuestions', 'questionNotes',
  ] as const) {
    assertRowsHaveId(backup[table], table);
  }

  const projectIds = new Set(backup.projects.map(row => row.id));
  const permissionIds = new Set(backup.permissions.map(row => row.id));
  const sessionIds = new Set(backup.sessions.map(row => row.id));
  const findIds = new Set(backup.finds.map(row => row.id));
  const significantFindIds = new Set(backup.significantFinds.map(row => row.id));

  backup.permissions.forEach((permission, index) => {
    if (!projectIds.has(permission.projectId)) {
      throw new Error(`Invalid format: permissions[${index}] references an unknown project`);
    }
    assertPermissionIntelligence(permission, index);
  });
  backup.fields.forEach((field, index) => {
    if (!permissionIds.has(field.permissionId)) {
      throw new Error(`Invalid format: fields[${index}] references an unknown permission`);
    }
  });
  backup.sessions.forEach((session, index) => {
    if (!permissionIds.has(session.permissionId)) {
      throw new Error(`Invalid format: sessions[${index}] references an unknown permission`);
    }
  });
  backup.finds.forEach((find, index) => {
    if (!permissionIds.has(find.permissionId)) {
      throw new Error(`Invalid format: finds[${index}] references an unknown permission`);
    }
    if (find.sessionId && !sessionIds.has(find.sessionId)) {
      throw new Error(`Invalid format: finds[${index}] references an unknown session`);
    }
  });
  backup.significantFinds.forEach((find, index) => {
    if (!projectIds.has(find.projectId)) {
      throw new Error(`Invalid format: significantFinds[${index}] references an unknown project`);
    }
    if (!permissionIds.has(find.permissionId)) {
      throw new Error(`Invalid format: significantFinds[${index}] references an unknown permission`);
    }
    if (find.sessionId && !sessionIds.has(find.sessionId)) {
      throw new Error(`Invalid format: significantFinds[${index}] references an unknown session`);
    }
    if (find.linkedFindId && !findIds.has(find.linkedFindId)) {
      throw new Error(`Invalid format: significantFinds[${index}] references an unknown find`);
    }
  });
  backup.tracks.forEach((track, index) => {
    if (track.sessionId && !sessionIds.has(track.sessionId)) {
      throw new Error(`Invalid format: tracks[${index}] references an unknown session`);
    }
  });
  backup.media.forEach((media, index) => {
    if (options?.zipMode) {
      if (typeof media._zipEntry !== 'string' || !media._zipEntry.startsWith('media/')) {
        throw new Error(`Invalid format: media[${index}] has an invalid _zipEntry`);
      }
    } else if (typeof media.blob !== 'string' || !media.blob.startsWith('data:')) {
      throw new Error(`Invalid format: media[${index}] has an invalid blob`);
    }
    if (media.findId && !findIds.has(media.findId) && !significantFindIds.has(media.findId)) {
      throw new Error(`Invalid format: media[${index}] references an unknown find or significant find`);
    }
    if (media.permissionId && !permissionIds.has(media.permissionId)) {
      throw new Error(`Invalid format: media[${index}] references an unknown permission`);
    }
  });
  backup.settings.forEach((setting, index) => {
    if (typeof setting.key !== 'string' || !setting.key.trim()) {
      throw new Error(`Invalid format: settings[${index}] is missing a key`);
    }
  });
  backup.savedPoints.forEach((savedPoint, index) => {
    if (!projectIds.has(savedPoint.projectId)) {
      throw new Error(`Invalid format: savedPoints[${index}] references an unknown project`);
    }
  });
  backup.findHotspotSignals.forEach((signal, index) => {
    const invalid = (field: string) => new Error(`Invalid format: findHotspotSignals[${index}] has an invalid ${field}`);
    if (typeof signal.signalKey !== 'string' || !signal.signalKey.trim()) throw invalid('signalKey');
    if (typeof signal.permissionId !== 'string' || !signal.permissionId.trim()) throw invalid('permissionId');
    if (typeof signal.geohash6 !== 'string' || !signal.geohash6.trim()) throw invalid('geohash6');
    if (!Number.isInteger(signal.findCount) || (signal.findCount as number) < 0) throw invalid('findCount');
    if (signal.findIds !== undefined &&
        (!Array.isArray(signal.findIds) || signal.findIds.some((id: unknown) =>
          typeof id !== 'string' || !id.trim()))) throw invalid('findIds');
  });
  backup.hotspotPredictions.forEach((prediction, index) => {
    const invalid = (field: string) => new Error(`Invalid format: hotspotPredictions[${index}] has an invalid ${field}`);
    if (typeof prediction.id !== 'string' || !prediction.id.trim()) throw invalid('id');
    if (typeof prediction.engineVersion !== 'string' || !prediction.engineVersion.trim()) throw invalid('engineVersion');
    if (!Number.isFinite(prediction.surfacedAt)) throw invalid('surfacedAt');
    if (!['hit', 'searched_no_find', 'unvisited'].includes(prediction.outcome as string)) throw invalid('outcome');
    if (!Array.isArray(prediction.center) || prediction.center.length !== 2 ||
        prediction.center.some((value: unknown) => !Number.isFinite(value))) throw invalid('center');
    if (!Array.isArray(prediction.bounds) || prediction.bounds.length !== 2) throw invalid('bounds');
  });
  backup.hotspotPredictionAggregates.forEach((aggregate, index) => {
    const invalid = (field: string) =>
      new Error(`Invalid format: hotspotPredictionAggregates[${index}] has an invalid ${field}`);
    if (typeof aggregate.id !== 'string' || !aggregate.id.trim()) throw invalid('id');
    if (typeof aggregate.engineVersion !== 'string' || !aggregate.engineVersion.trim()) throw invalid('engineVersion');
    for (const field of ['surfacedCount', 'searchedCount', 'hitCount'] as const) {
      if (!Number.isInteger(aggregate[field]) || (aggregate[field] as number) < 0) throw invalid(field);
    }
    if ((aggregate.hitCount as number) > (aggregate.searchedCount as number) ||
        (aggregate.searchedCount as number) > (aggregate.surfacedCount as number)) throw invalid('counts');
  });
  backup.outstandingQuestions.forEach((question, index) => {
    if (!permissionIds.has(question.permissionId)) {
      throw new Error(`Invalid format: outstandingQuestions[${index}] references an unknown permission`);
    }
    assertOutstandingQuestion(question, index);
  });

  const validNoteTypes = new Set([
    'searched_nothing', 'found_something', 'ground_inaccessible',
    'poor_conditions', 'modern_disturbance', 'freeform', 'session_crossed',
    'status_change', 'merged_from',
  ]);
  backup.questionNotes.forEach((note, index) => {
    const invalid = (field: string) => new Error(`Invalid format: questionNotes[${index}] has an invalid ${field}`);
    if (typeof note.questionId !== 'string' || !note.questionId.trim()) throw invalid('questionId');
    if (note.author !== 'user' && note.author !== 'system') throw invalid('author');
    if (!validNoteTypes.has(note.type as string)) throw invalid('type');
    if (note.text !== undefined && (typeof note.text !== 'string' || note.text.length > 1000)) throw invalid('text');
    if (!Number.isFinite(note.createdAt)) throw invalid('createdAt');
    if (note.sessionId !== undefined && typeof note.sessionId !== 'string') throw invalid('sessionId');
    if (note.linkedFindIds !== undefined &&
        (!Array.isArray(note.linkedFindIds) || note.linkedFindIds.some((id: unknown) => typeof id !== 'string'))) {
      throw invalid('linkedFindIds');
    }
  });

  return {
    version: input.version,
    projects: backup.projects as ValidatedBackupData['projects'],
    permissions: backup.permissions as ValidatedBackupData['permissions'],
    fields: backup.fields as ValidatedBackupData['fields'],
    sessions: backup.sessions as ValidatedBackupData['sessions'],
    finds: backup.finds as ValidatedBackupData['finds'],
    significantFinds: backup.significantFinds as ValidatedBackupData['significantFinds'],
    tracks: backup.tracks as ValidatedBackupData['tracks'],
    media: backup.media.map(media => options?.zipMode
      ? { ...media, format: 'zip' as const } as ValidatedBackupMedia
      : { ...media, format: 'legacy' as const } as ValidatedBackupMedia),
    settings: backup.settings as ValidatedBackupData['settings'],
    importedPackages: backup.importedPackages as ValidatedBackupData['importedPackages'],
    savedPoints: backup.savedPoints as ValidatedBackupData['savedPoints'],
    undugSignals: backup.undugSignals as ValidatedBackupData['undugSignals'],
    findHotspotSignals: backup.findHotspotSignals as ValidatedBackupData['findHotspotSignals'],
    hotspotPredictions: backup.hotspotPredictions as ValidatedBackupData['hotspotPredictions'],
    hotspotPredictionAggregates:
      backup.hotspotPredictionAggregates as ValidatedBackupData['hotspotPredictionAggregates'],
    outstandingQuestions:
      backup.outstandingQuestions as unknown as ValidatedBackupData['outstandingQuestions'],
    questionNotes: backup.questionNotes as unknown as ValidatedBackupData['questionNotes'],
  };
}
