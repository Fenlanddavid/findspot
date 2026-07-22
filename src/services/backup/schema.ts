import type {
  Field,
  Find,
  FindHotspotSignal,
  HotspotPrediction,
  HotspotPredictionAggregate,
  ImportedPackage,
  Media,
  OutstandingQuestion,
  Permission,
  Project,
  QuestionNote,
  SavedPoint,
  Session,
  Setting,
  SignificantFind,
  Track,
  UndugSignal,
} from '../../db';
import type { BackedUpTableName } from './tableRegistry';

/** Untrusted bytes/JSON entering from outside IndexedDB. */
export type RawBackupData = unknown;

export type BackupValidationOptions = { zipMode?: boolean };

/** Validated manifest media before its Blob is reconstructed. */
export type ValidatedBackupMedia = Omit<Media, 'blob'> & (
  | { format: 'legacy'; blob: string }
  | { format: 'zip'; _zipEntry: string }
);

export type ValidatedBackupTables = {
  projects: Project[];
  permissions: Permission[];
  fields: Field[];
  sessions: Session[];
  finds: Find[];
  significantFinds: SignificantFind[];
  tracks: Track[];
  media: ValidatedBackupMedia[];
  settings: Setting[];
  importedPackages: ImportedPackage[];
  savedPoints: SavedPoint[];
  undugSignals: UndugSignal[];
  findHotspotSignals: FindHotspotSignal[];
  hotspotPredictions: HotspotPrediction[];
  hotspotPredictionAggregates: HotspotPredictionAggregate[];
  outstandingQuestions: OutstandingQuestion[];
  questionNotes: QuestionNote[];
};

/**
 * The only backup shape accepted by the write pipeline. Raw input cannot reach
 * restore writes without passing through normalization and persistence
 * validation.
 */
export type ValidatedBackupData = { version: number } & ValidatedBackupTables;

export type BackupTableKey = keyof ValidatedBackupTables;
export type UnvalidatedRow = Record<string, unknown>;
export type UnvalidatedBackupTables = Record<BackupTableKey, UnvalidatedRow[]>;

// Compile-time counterpart to the runtime schema/registry parity test.
type EqualKeys<Left, Right> =
  [Left] extends [Right]
    ? [Right] extends [Left]
      ? true
      : false
    : false;
type AssertTrue<Value extends true> = Value;
export type BackupRegistrySchemaParity = AssertTrue<EqualKeys<
  BackupTableKey,
  BackedUpTableName
>>;

export const MAX_BACKUP_RECORDS = 100_000;
