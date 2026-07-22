export type BackupTableClassification = 'backup' | 'excluded';

export type BackupTableRegistration = {
  classification: BackupTableClassification;
  reason: string;
};

/**
 * Every live FindSpot Dexie table must appear here. The permanent registry test
 * compares these keys with FindSpotDB.tables, so a schema addition cannot land
 * without an explicit backup decision.
 */
export const BACKUP_TABLE_REGISTRY = {
  projects: {
    classification: 'backup',
    reason: 'User-owned project organization and metadata.',
  },
  permissions: {
    classification: 'backup',
    reason: 'User-owned permission, landowner and investigation context.',
  },
  fields: {
    classification: 'backup',
    reason: 'User-authored field boundaries and notes.',
  },
  sessions: {
    classification: 'backup',
    reason: 'User-recorded detecting sessions and fieldwork context.',
  },
  finds: {
    classification: 'backup',
    reason: 'Primary user find records.',
  },
  media: {
    classification: 'backup',
    reason: 'User photos, agreements and other irreplaceable attachments.',
  },
  tracks: {
    classification: 'backup',
    reason: 'User-recorded fieldwork tracks.',
  },
  settings: {
    classification: 'backup',
    reason: 'User preferences and durable local application state.',
  },
  importedPackages: {
    classification: 'backup',
    reason: 'Import identity prevents duplicate Club Day package application.',
  },
  significantFinds: {
    classification: 'backup',
    reason: 'User-recorded significant-find workflows and observations.',
  },
  savedPoints: {
    classification: 'backup',
    reason: 'User-bookmarked field locations and notes.',
  },
  findHotspotSignals: {
    classification: 'backup',
    reason: 'Durable find-to-hotspot evidence derived from irreplaceable user finds.',
  },
  hotspotPredictions: {
    classification: 'backup',
    reason: 'Prediction outcomes encode user fieldwork history and calibration evidence.',
  },
  hotspotPredictionAggregates: {
    classification: 'backup',
    reason: 'Long-term calibration denominators survive raw prediction retention sweeps.',
  },
  undugSignals: {
    classification: 'backup',
    reason: 'User-recorded detector signals and follow-up outcomes.',
  },
  outstandingQuestions: {
    classification: 'backup',
    reason: 'Durable investigation state, dismissals and evolution history.',
  },
  questionNotes: {
    classification: 'backup',
    reason: 'User-authored and system investigation notes.',
  },
  fieldGuideCache: {
    classification: 'excluded',
    reason: 'Regenerable, engine-versioned FieldGuide scan cache.',
  },
  geologyContext: {
    classification: 'excluded',
    reason: 'Regenerable cache of public BGS geology responses and classifications.',
  },
  landscapeInterpretations: {
    classification: 'excluded',
    reason: 'Regenerable output from the versioned landscape interpretation engine.',
  },
  diagnosticLog: {
    classification: 'excluded',
    reason: 'Bounded operational diagnostics are separately exportable and should not be restored.',
  },
  geocodeCache: {
    classification: 'excluded',
    reason: 'Regenerable cache of public geocoding responses with its own expiry policy.',
  },
} as const satisfies Record<string, BackupTableRegistration>;

export type RegisteredTableName = keyof typeof BACKUP_TABLE_REGISTRY;

function registeredNamesWith(
  classification: BackupTableClassification,
): RegisteredTableName[] {
  return (Object.keys(BACKUP_TABLE_REGISTRY) as RegisteredTableName[])
    .filter(name => BACKUP_TABLE_REGISTRY[name].classification === classification);
}

export const BACKED_UP_TABLE_NAMES = registeredNamesWith('backup');
export const EXCLUDED_TABLE_NAMES = registeredNamesWith('excluded');
