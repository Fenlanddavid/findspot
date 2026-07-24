import Dexie, { Table, type Transaction } from "dexie";
import { v4 as uuid } from "uuid";
import type { OutstandingQuestion, QuestionNote } from "./outstandingQuestions/types";
import type {
  GeoJSONPolygon,
  PermissionSection,
  SessionCoverageObservation,
} from './shared/coverageTypes';
export type {
  CoverageEvidence,
  GeoJSONArea,
  GeoJSONPolygon,
  PermissionSection,
  PermissionSectionGeometryVersion,
  SessionCoverageObservation,
} from './shared/coverageTypes';

export type TreasureOutcome =
  | "not_treasure_returned"
  | "disclaimed_returned"
  | "museum_acquiring"
  | "donated_reward_waived"
  | "reward_paid"
  | "transferred_to_museum"
  | "closed";

export type ScatterOutcome =
  | "pas_recorded"
  | "research_complete"
  | TreasureOutcome;

export type NotableOutcome =
  | "pas_recorded"
  | "identified_not_recorded"
  | "returned"
  | "museum_interest"
  | TreasureOutcome;

export type Project = {
  id: string;
  name: string;
  region: "England" | "Wales" | "Scotland" | "Northern Ireland" | "UK";
  createdAt: string;
};

export type Permission = {
  id: string;
  projectId: string;

  name: string;
  type: "individual" | "rally";
  
  // These are now more "default" or "location" based
  lat: number | null;
  lon: number | null;
  gpsAccuracyM: number | null;
  
  collector: string;

  landownerName?: string;
  landownerPhone?: string;
  landownerEmail?: string;
  landownerAddress?: string;

  landType:
    | "arable"
    | "pasture"
    | "woodland"
    | "scrub"
    | "parkland"
    | "beach"
    | "foreshore"
    | "other";

  permissionGranted: boolean;

  agreementId?: string; // Reference to Media table for the signed PDF

  boundary?: GeoJSONPolygon;

  notes: string;

  validFrom?: string; // ISO date string

  isPinned?: boolean;
  isDefault?: boolean;

  // Last Historic FieldGuide scan that evaluated this permission for questions.
  questionsEvaluatedAt?: string;

  // Protection banner — fail-safe scheduled monument status (Phase A).
  // absent = unknown (G2: absence never reads as clear).
  protectionStatus?: {
    state: 'present' | 'clear' | 'unknown';
    evaluatedAt: string;        // ISO — updated on every evaluation
    monumentCount?: number;     // populated when state is 'present'
  };

  // PAS density context — permission-level summary of public records.
  pasContext?: {
    count: number;
    topPeriods: string[];       // max 3
    topTypes: string[];         // max 3
    evaluatedAt: string;
  };

  // Club Day — organiser side
  sharedPermissionId?: string;   // Merge anchor; set when "Create Club Day Pack" is used
  isSharedPermission?: boolean;  // True on organiser's permission once a pack has been created

  // Club Day — member side
  isClubDayMember?: boolean;            // True on synthetic read-only pack permissions
  isPersonalRallyRecord?: boolean;      // True when a member keeps a club day locally after leaving organiser export
  organiserContactNumber?: string;      // Included in pack; shown to members
  organiserEmail?: string;              // Included in pack; used for export mailto link
  significantFindInstructions?: string; // Shown prominently on member permission
  clubDayPublicNotes?: string;          // Optional rally/event notes for members
  submittedAt?: string;                 // ISO timestamp set when member exports their data

  createdAt: string;
  updatedAt: string;
};

export type Field = {
  id: string;
  projectId: string;
  permissionId: string;
  name: string;
  boundary: GeoJSONPolygon;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type Session = {
  id: string;
  projectId: string;
  permissionId: string;
  fieldId: string | null;

  date: string; // ISO datetime
  lat: number | null;
  lon: number | null;
  gpsAccuracyM: number | null;

  landUse: string;
  cropType: string;
  isStubble: boolean;

  notes: string;
  isFinished: boolean;

  startTime?: string; // ISO datetime when tracking started
  endTime?: string;   // ISO datetime when session was finished

  keyNotes?: string[]; // Farmer-facing checklist items for field report

  // Club Day attribution
  sharedPermissionId?: string;
  recorderId?: string;
  recorderName?: string;

  createdAt: string;
  updatedAt: string;
};

export type SignificantFind = {
  id: string;
  projectId: string;
  permissionId: string;
  sessionId: string | null;
  path: "stop_secure" | "map_scatter" | "notable_find";
  status: "in_progress" | "awaiting_excavation" | "excavation_complete" | "coroner_notified" | "pas_recorded";
  jurisdiction: "england_wales" | "scotland" | "northern_ireland" | "unknown";

  lat: number | null;
  lon: number | null;
  gpsAccuracyM: number | null;
  osGridRef: string;
  w3w: string;

  // Path 1 pre-excavation observations
  preExcavationNotes: string;
  soilObservations: string;
  secureCoverNotes?: string;
  groundSurfacePhotoCaptured: boolean;

  // Path 2 scatter
  scatterId: string | null;
  scatterFindIds: string[];

  // Path 3
  linkedFindId: string | null;
  treasureActResult?: "may_be_reportable" | "probably_not" | "unknown" | null;

  // Generated outputs
  treasureActDraft: string;
  landownerSummary: string;

  // User-provided description / hoard type
  findDescription?: string;
  landownerNotified?: boolean;

  // Post-excavation findings — updated after professional excavation
  excavationFindings?: string;

  // Observation and narrative fields
  initialObservations?: string;   // What was visible before touching
  firstPersonAccount?: string;    // First-person account of the discovery
  depthCm?: number | null;
  periodEstimate?: string;        // "What period do you think this might be"
  orientationNotes?: string;      // Path 3: how was it oriented in the ground

  // Path 2 (scatter) — co-recorder and recovery details
  coRecorderName?: string;
  coRecorderContact?: string;
  allFindsRecovered?: "yes" | "partial" | "no";

  // Paths 2 + 3 — follow-up fields
  floContactDate?: string;
  pasRecordNumber?: string;

  // Path 1 — treasure process closure
  treasureReference?: string;
  treasureOutcome?: TreasureOutcome;
  coronerDecisionDate?: string;
  museumName?: string;
  valuationAmount?: string;
  rewardStatus?: "not_applicable" | "pending" | "waived" | "paid";
  rewardReceivedDate?: string;
  rewardSplitNotes?: string;
  finalDispositionNotes?: string;

  // Paths 2 + 3 — final outcome closure
  outcomeDate?: string;
  scatterOutcome?: ScatterOutcome;
  notableOutcome?: NotableOutcome;

  // Post-recovery follow-up
  currentLocation?: "with_finder" | "with_flo" | "at_museum" | "other";
  preliminaryId?: string;         // FLO's preliminary identification
  pasRecordUrl?: string;          // finds.org.uk URL once PAS-recorded

  // Resume support — persisted while the wizard is active, cleared on clean exit.
  // Non-indexed: no .stores() change required.
  workflowStep?: string | null;

  createdAt: string;
  updatedAt: string;
};

export type Find = {
  id: string;
  projectId: string;
  permissionId: string;
  fieldId: string | null;
  sessionId: string | null;

  findCode: string;
  objectType: string;
  findCategory?: "Coin" | "Artefact" | "Jewellery" | "Button / Fastener" | "Token / Jetton" | "Other";
  coinType?: string;
  coinDenomination?: string;
  coinSpink?: string;
  pasId?: string;

  isFavorite?: boolean;
  isPending?: boolean;
  scatterId?: string;
  isNotableFind?: boolean;

  // Specific Findspot Location
  lat: number | null;
  lon: number | null;
  gpsAccuracyM: number | null;
  osGridRef: string;
  w3w: string;

  period:
    | "Prehistoric"
    | "Bronze Age"
    | "Iron Age"
    | "Celtic"
    | "Roman"
    | "Anglo-Saxon"
    | "Early Medieval"
    | "Medieval"
    | "Post-medieval"
    | "Modern"
    | "Unknown";

  material:
    | "Gold"
    | "Silver"
    | "50% Silver"
    | "Copper alloy"
    | "Copper"
    | "Cupro-Nickel"
    | "Lead"
    | "Iron"
    | "Tin"
    | "Pewter"
    | "Pottery"
    | "Flint"
    | "Stone"
    | "Glass"
    | "Bone"
    | "Other";

  weightG: number | null;
  widthMm: number | null;
  heightMm: number | null;
  depthMm: number | null;

  decoration: string;
  completeness: "Complete" | "Incomplete" | "Fragment";
  findContext: string;

  detector?: string;
  targetId?: number;
  depthCm?: number;
  ruler?: string;
  mint?: string;
  dateRange?: string;

  storageLocation: string;
  notes: string;

  foundAt?: string; // ISO datetime — when the find was actually made (may differ from createdAt)

  // Club Day attribution
  sharedPermissionId?: string;
  recorderId?: string;
  recorderName?: string;

  // Undug signal link — set when this find was created from the dug-find resolution flow
  sourceSignalId?: string;

  createdAt: string;
  updatedAt: string;
};

export type Media = {
  id: string;
  projectId: string;
  findId?: string;
  permissionId?: string;

  type: "photo" | "document";
  photoType?: "in-situ" | "cleaned" | "photo1" | "photo2" | "photo3" | "photo4" | "other";
  filename: string;
  mime: string;
  blob: Blob;
  caption: string;
  scalePresent: boolean;
  pxPerMm?: number;

  createdAt: string;
};

export type Track = {
  id: string;
  projectId: string;
  sessionId: string | null;
  name: string;
  points: Array<{ lat: number; lon: number; timestamp: number; accuracy?: number }>;
  isActive: boolean;
  color: string;
  createdAt: string;
  updatedAt: string;
  gaps?: { start: number; end: number }[];
};

export type Setting = {
  key: string;
  // Settings are a heterogeneous persistence boundary (strings, booleans,
  // arrays and nullable values are all currently stored). Consumers must
  // validate/narrow the value they request rather than trusting the row;
  // clientStorage.ts performs that validation for UI preferences.
  value: unknown;
};

// Regenerable Nominatim proxy cache. `response` deliberately remains unknown
// at the persistence boundary and is validated by services/geocode.ts on read.
export type GeocodeCacheRecord = {
  cacheKey: string;
  response: unknown;
  fetchedAt: number;
};

export type ImportedPackage = {
  id: string;
  packageHash: string;
  importedAt: string;
  sharedPermissionId?: string;
  recorderId?: string;
  recorderName?: string;
};

// ─── Geology context cache ────────────────────────────────────────────────────
// Caches BGS geology context results per tile, keyed by compound geohash string.
// TTL: 90 days. Invalidated when classifierVersion or sourceVersion changes.
// context is typed as any to avoid coupling db.ts to the engine layer.
// See: src/engines/geologyContext/geologyContextTypes.ts

export type GeologyContextRecord = {
    tileKey:           string;   // Primary key — geology:{geohash6}:classifier:{v}:source:{sv}
    centroid:          { lat: number; lon: number };
    context:           unknown;  // validated by the geology engine on read
    fetchedAt:         number;   // Unix ms — used for 90-day TTL sweep
    classifierVersion: number;
    sourceVersion:     string;
};

// ─── Find–hotspot feedback signal ────────────────────────────────────────────
// Lightweight history record written whenever the feedback service detects that
// user finds fall inside or near a FieldGuide hotspot. One record per permission
// and geohash6 cell. Used by future on-device compounding to calibrate
// persistence scoring. Does not store engine internals — only observable user
// find data.

export type FindHotspotSignal = {
    signalKey:                  string;              // Primary key — `${permissionId}:${geohash6}`
    geohash6:                   string;              // Geohash precision 6 of hotspot center
    permissionId:               string;              // Which land permission this covers
    lastFindAt:                 string;              // ISO datetime of most recent matched find
    findCount:                  number;              // Total logged finds in/near a hotspot at this geohash
    periodCounts:               Record<string, number>; // e.g. { "Roman": 3, "Medieval": 1 }
    lastHotspotClassification:  string;              // Classification of the matched hotspot
    lastHotspotScore:           number;              // Score of matched hotspot at time of recording
    findIds?:                   string[];             // Matched find IDs; deduplicates overlapping hotspots
    updatedAt:                  number;              // Unix ms — for TTL sweep
};

export type HotspotPredictionOutcome = 'hit' | 'searched_no_find' | 'unvisited';

/** Raw surfaced hotspot needed to measure the engine's denominator honestly. */
export type HotspotPrediction = {
  id: string;
  engineVersion: string;
  confidence: 'Weak Signal' | 'Developing Signal' | 'Strong Signal' | 'Strongest Signal';
  classification: string;
  surfacedAt: number;
  permissionId: string | null;
  sessionId: string | null;
  center: [number, number];
  bounds: [[number, number], [number, number]];
  geohash6: string;
  outcome: HotspotPredictionOutcome;
  searchedCoverage?: number;
  matchedFindId?: string;
  resolvedAt?: number;
  resolutionEvidence?: 'find' | 'tracked' | 'reported' | 'mixed';
  reportedConfirmationCount?: number;
};

/** Long-lived evidence retained after raw prediction records expire. */
export type HotspotPredictionAggregate = {
  id: string; // `${engineVersion}:${confidence}`
  engineVersion: string;
  confidence: HotspotPrediction['confidence'];
  surfacedCount: number;
  searchedCount: number;
  hitCount: number;
  trackedSearchedCount?: number;
  trackedHitCount?: number;
  reportedSearchedCount?: number;
  reportedHitCount?: number;
  mixedSearchedCount?: number;
  mixedHitCount?: number;
  findOnlyHitCount?: number;
  updatedAt: number;
};

// ─── Saved Points ─────────────────────────────────────────────────────────────
// User-bookmarked map positions in FieldGuide, scoped to a project.

export type SavedPoint = {
  id:        string;
  projectId: string;
  label:     string;
  lat:       number;
  lon:       number;
  zoom:      number;
  note:      string;
  scanSnapshot?: {
    hotspotCount:    number;
    topHotspotTitle: string;
  };
  createdAt: string;
};

// ─── FieldGuide scan cache ────────────────────────────────────────────────────
// Caches raw cluster data from the tile workers so that identical viewports
// skip the expensive pixel processing on revisit. TTL: 24 hours.
// rawClusters is typed as any[] to avoid importing Cluster from fieldGuideTypes
// (which would couple db.ts to the domain layer).

export type FieldGuideScanCache = {
  id: string;           // '${zoom}-${tX_start}-${tY_start}' — deterministic tile key
  createdAt: number;    // Unix ms
  rawClusters: unknown;
  sourceAvailability: Record<string, boolean>;
  sourceCompleteness?: Record<string, boolean>;
  modernWays?: unknown;
  modernWaysFetchedAt?: number;
  engineVersion?: string; // scoring engine version — stale caches are discarded on mismatch
  historicLookup?: unknown; // standalone Historic button source cache
};

// ─── On-device diagnostic ring buffer ────────────────────────────────────────
// Never transmitted. User-exportable from Settings > Backup.
// Hard cap 2,000 entries — oldest are pruned on write past the cap.

export type DiagLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type DiagLogEntry = {
  id: string;
  ts: string;         // ISO 8601
  level: DiagLogLevel;
  scope: string;      // e.g. 'export', 'restore', 'alie', 'historicScan'
  message: string;
  detail?: string;    // stringified error or extra context
};

// ─── Landscape interpretation cache ──────────────────────────────────────────
// Caches ALIE v5 LandscapeInterpretation results per geohash6 cell.
// Last-write-wins. Typed as any to avoid coupling db.ts to the engine layer.
// See: src/types/landscapeInterpretation.ts

export type LandscapeInterpretationRecord = {
    geohash6:     string;   // Primary key
    generatedAt:  number;   // Unix ms
    engineVersion?: string;
    geologyTileKey?: string;
    inputSignature?: string;
    interpretation: unknown; // validated by ALIE on read
};

// ─── Outstanding Questions ───────────────────────────────────────────────────
// Deterministic archaeological enquiries derived from FieldGuide scan output.
// Separate table — not stored on Permission; included in user backup/restore.

export type { OutstandingQuestion, QuestionNote } from "./outstandingQuestions/types";

// ─── Undug Signals ────────────────────────────────────────────────────────────
// One-tap logging of detector signals the user chose not to dig.
// Local-first, Dexie-only — no network dependency.
// Seed data for the future on-device yield engine.

export type UndugSignalStatus = 'open' | 'dug-find' | 'dug-nothing' | 'dismissed';

export type UndugSignalDirection = 'one-way' | 'two-way';
export type UndugSignalStability = 'repeatable' | 'inconsistent' | 'broken';
export type UndugSignalConditions = 'dry' | 'wet' | 'ploughed';
export type UndugSignalDugNothingCause = 'iron' | 'ground-noise' | 'could-not-locate' | 'other';

export type UndugSignal = {
  id: string;
  createdAt: number;          // epoch ms
  lat: number;
  lng: number;
  gpsAccuracy?: number;       // metres, from position if available
  sessionId?: string;         // link to active session if one exists
  permissionId?: string;      // resolved from active session/permission context
  direction?: UndugSignalDirection;
  stability?: UndugSignalStability;
  vdi?: string;               // free text/number — detector-agnostic
  conditions?: UndugSignalConditions;
  notes?: string;
  status: UndugSignalStatus;  // defaults 'open'
  resolvedAt?: number;
  resolvedFindId?: string;    // set when converted to a find (dug-find path)
  dugNothingCause?: UndugSignalDugNothingCause;
};

export type FindSpotVersionSpec = {
  version: number;
  stores: Record<string, string | null>;
  upgrade?: (transaction: Transaction) => void | PromiseLike<void>;
};

/**
 * Canonical Dexie history. The production declarations below populate this
 * registry once; migration fixtures replay the same stores and upgrade
 * callbacks rather than maintaining a hand-copied native IndexedDB schema.
 */
export const FINDSPOT_VERSION_SPECS: FindSpotVersionSpec[] = [];
export const FINDSPOT_CURRENT_VERSION = 41;

function declareFindSpotVersion(versionNumber: number) {
  return {
    stores(stores: Record<string, string | null>) {
      let spec = FINDSPOT_VERSION_SPECS.find(({ version }) => version === versionNumber);
      if (!spec) {
        spec = { version: versionNumber, stores };
        FINDSPOT_VERSION_SPECS.push(spec);
      }

      return {
        upgrade(upgrade: NonNullable<FindSpotVersionSpec["upgrade"]>) {
          if (!spec!.upgrade) spec!.upgrade = upgrade;
        },
      };
    },
  };
}

export function applyFindSpotVersions(database: Dexie, upTo = FINDSPOT_CURRENT_VERSION): void {
  for (const spec of FINDSPOT_VERSION_SPECS) {
    if (spec.version > upTo) break;
    const version = database.version(spec.version).stores(spec.stores);
    if (spec.upgrade) version.upgrade(spec.upgrade);
  }
}

export class FindSpotDB extends Dexie {
  projects!: Table<Project, string>;
  permissions!: Table<Permission, string>;
  fields!: Table<Field, string>;
  sessions!: Table<Session, string>;
  finds!: Table<Find, string>;
  media!: Table<Media, string>;
  tracks!: Table<Track, string>;
  settings!: Table<Setting, string>;
  importedPackages!: Table<ImportedPackage, string>;
  fieldGuideCache!: Table<FieldGuideScanCache, string>;
  significantFinds!: Table<SignificantFind, string>;
  savedPoints!: Table<SavedPoint, string>;
  geologyContext!: Table<GeologyContextRecord, string>;
  findHotspotSignals!: Table<FindHotspotSignal, string>;
  hotspotPredictions!: Table<HotspotPrediction, string>;
  hotspotPredictionAggregates!: Table<HotspotPredictionAggregate, string>;
  permissionSections!: Table<PermissionSection, string>;
  sessionCoverage!: Table<SessionCoverageObservation, string>;
  landscapeInterpretations!: Table<LandscapeInterpretationRecord, string>;
  diagnosticLog!: Table<DiagLogEntry, string>;
  undugSignals!: Table<UndugSignal, string>;
  outstandingQuestions!: Table<OutstandingQuestion, string>;
  questionNotes!: Table<QuestionNote, string>;
  geocodeCache!: Table<GeocodeCacheRecord, string>;

  constructor(name = "findspot_uk") {
    super(name);

    declareFindSpotVersion(1).stores({
      projects: "id, name, region, createdAt",
      permissions: "id, projectId, name, type, observedAt, permissionGranted, createdAt",
      finds: "id, projectId, permissionId, findCode, objectType, createdAt",
      media: "id, projectId, findId, createdAt",
    });

    declareFindSpotVersion(2).stores({
      projects: "id, name, region, createdAt",
      permissions: "id, projectId, name, type, permissionGranted, createdAt",
      sessions: "id, projectId, permissionId, date, createdAt",
      finds: "id, projectId, permissionId, sessionId, findCode, objectType, createdAt",
      media: "id, projectId, findId, createdAt",
    });

    declareFindSpotVersion(3).stores({
      projects: "id, name, region, createdAt",
      permissions: "id, projectId, name, type, permissionGranted, createdAt",
      sessions: "id, projectId, permissionId, date, createdAt",
      finds: "id, projectId, permissionId, sessionId, findCode, objectType, createdAt",
      media: "id, projectId, findId, createdAt",
      settings: "key",
    });

    // v4: schema identical to v3 — no-op bump kept for continuity with deployed clients
    declareFindSpotVersion(4).stores({
      projects: "id, name, region, createdAt",
      permissions: "id, projectId, name, type, permissionGranted, createdAt",
      sessions: "id, projectId, permissionId, date, createdAt",
      finds: "id, projectId, permissionId, sessionId, findCode, objectType, createdAt",
      media: "id, projectId, findId, createdAt",
      settings: "key",
    });

    declareFindSpotVersion(5).stores({
      projects: "id, name, region, createdAt",
      permissions: "id, projectId, name, type, permissionGranted, createdAt",
      sessions: "id, projectId, permissionId, date, createdAt",
      finds: "id, projectId, permissionId, sessionId, findCode, objectType, createdAt",
      media: "id, projectId, findId, createdAt",
      tracks: "id, projectId, sessionId, isActive, createdAt",
      settings: "key",
    });

    declareFindSpotVersion(6).stores({
      projects: "id, name, region, createdAt",
      permissions: "id, projectId, name, type, permissionGranted, createdAt",
      sessions: "id, projectId, permissionId, date, isFinished, createdAt",
      finds: "id, projectId, permissionId, sessionId, findCode, objectType, createdAt",
      media: "id, projectId, findId, createdAt",
      tracks: "id, projectId, sessionId, isActive, createdAt",
      settings: "key",
    });

    declareFindSpotVersion(7).stores({
      projects: "id, name, region, createdAt",
      permissions: "id, projectId, name, type, permissionGranted, createdAt",
      sessions: "id, projectId, permissionId, date, isFinished, createdAt",
      finds: "id, projectId, permissionId, sessionId, findCode, objectType, isFavorite, createdAt",
      media: "id, projectId, findId, createdAt",
      tracks: "id, projectId, sessionId, isActive, createdAt",
      settings: "key",
    });

    declareFindSpotVersion(8).stores({
      finds: "id, projectId, permissionId, sessionId, findCode, objectType, isFavorite, targetId, detector, createdAt",
    });

    declareFindSpotVersion(9).stores({
      media: "id, projectId, findId, permissionId, createdAt",
    });

    declareFindSpotVersion(10).stores({
      permissions: "id, projectId, name, type, permissionGranted, boundary, createdAt",
    });

    declareFindSpotVersion(11).stores({
      fields: "id, projectId, permissionId, name, createdAt",
      sessions: "id, projectId, permissionId, fieldId, date, isFinished, createdAt",
      finds: "id, projectId, permissionId, fieldId, sessionId, findCode, objectType, isFavorite, targetId, detector, createdAt",
    }).upgrade(async tx => {
        const permissions = await tx.table("permissions").toArray();
        const now = new Date().toISOString();
        
        for (const p of permissions) {
            if (p.boundary) {
                // Browser-safe ID generation within transaction
                const fieldId = uuid();
                
                await tx.table("fields").add({
                    id: fieldId,
                    projectId: p.projectId,
                    permissionId: p.id,
                    name: "Main Field",
                    boundary: p.boundary,
                    notes: "Migrated from permission boundary",
                    createdAt: now,
                    updatedAt: now
                });

                // Update existing sessions to point to this field
                await tx.table("sessions").where("permissionId").equals(p.id).modify({ fieldId: fieldId });
                // Update existing finds to point to this field
                await tx.table("finds").where("permissionId").equals(p.id).modify({ fieldId: fieldId });
            }
        }
    });

    declareFindSpotVersion(12).stores({
      finds: "id, projectId, permissionId, fieldId, sessionId, findCode, objectType, isFavorite, targetId, detector, ruler, dateRange, createdAt",
    });

    declareFindSpotVersion(13).stores({
      finds: "id, projectId, permissionId, fieldId, sessionId, findCode, objectType, isFavorite, isPending, targetId, detector, ruler, dateRange, createdAt",
    });

    declareFindSpotVersion(14).stores({
      permissions: "id, projectId, name, type, permissionGranted, boundary, validFrom, createdAt",
    });

    declareFindSpotVersion(15).stores({
      sessions: "id, projectId, permissionId, fieldId, date, isFinished, startTime, endTime, createdAt",
    });

    declareFindSpotVersion(16).stores({
      sessions: "id, projectId, permissionId, fieldId, date, isFinished, startTime, endTime, createdAt",
    });

    declareFindSpotVersion(17).stores({
      permissions: "id, projectId, name, type, permissionGranted, boundary, validFrom, isPinned, createdAt",
    });

    declareFindSpotVersion(18).stores({
      finds: "id, projectId, permissionId, fieldId, sessionId, findCode, objectType, isFavorite, isPending, targetId, detector, ruler, dateRange, foundAt, createdAt",
    });

    declareFindSpotVersion(19).stores({}).upgrade(async tx => {
      const permissionIds = new Set((await tx.table("permissions").toArray()).map((p: any) => p.id));
      const orphanedFields = await tx.table("fields").filter((f: any) => !permissionIds.has(f.permissionId)).toArray();
      await tx.table("fields").bulkDelete(orphanedFields.map((f: any) => f.id));
    });

    declareFindSpotVersion(20).stores({
      importedPackages: "id, packageHash, sharedPermissionId, importedAt",
    });

    declareFindSpotVersion(21).stores({
      fieldGuideCache: "id, createdAt",
    });

    // v22: engineVersion added to FieldGuideScanCache — stale caches are
    // discarded when scoring logic changes rather than silently serving old results.
    // No schema change needed; Dexie stores the field automatically.
    declareFindSpotVersion(22).stores({});

    declareFindSpotVersion(23).stores({
      fieldGuideInvestigations: "id, projectId, hotspotId, status, updatedAt",
    });

    declareFindSpotVersion(24).stores({
      autoBackups: "id, createdAt, reason",
    });

    // v25: remove the unused FieldGuide investigation status store.
    declareFindSpotVersion(25).stores({
      fieldGuideInvestigations: null,
    });

    // v26: significant finds workflow — new table + scatterId index on finds.
    declareFindSpotVersion(26).stores({
      significantFinds: "id, projectId, permissionId, sessionId, path, status, scatterId, createdAt",
      finds: "id, projectId, permissionId, fieldId, sessionId, findCode, objectType, isFavorite, isPending, targetId, detector, ruler, dateRange, foundAt, scatterId, createdAt",
    });

    // v27: saved map points — bookmarked positions in FieldGuide, scoped to project.
    declareFindSpotVersion(27).stores({
      savedPoints: "id, projectId, createdAt",
    });

    // v28: BGS geology context cache — stores landscape classification per tile.
    // Existing user data (finds, permissions, sessions) is untouched.
    // Missing geology records regenerate automatically on next scan.
    // fetchedAt is indexed to support the 90-day TTL sweep in sweepStaleGeologyCache().
    declareFindSpotVersion(28).stores({
      geologyContext: "tileKey, fetchedAt",
    });

    // v29: find–hotspot feedback signal table.
    // Records a lightweight history entry per permission/geohash6 cell when the
    // user has logged finds that fall inside or near a FieldGuide hotspot. Used by
    // future on-device compounding to calibrate persistence scoring. No upgrade()
    // handler needed — new empty table; existing user data is untouched.
    declareFindSpotVersion(29).stores({
      findHotspotSignals: "signalKey, permissionId, geohash6, updatedAt",
    });

    // v30: Drop the unused autoBackups object store (added in v24, feature
    // removed May 2026). No user data — snapshots excluded photo blobs and the
    // feature was pulled before any meaningful data accumulated.
    declareFindSpotVersion(30).stores({
      autoBackups: null,
    });

    // v31: ALIE v5 landscape interpretation cache.
    // Stores the most recent LandscapeInterpretation result per geohash6 cell.
    // Last-write-wins — new results overwrite old ones. No upgrade() handler
    // needed — new empty table; existing user data is untouched.
    declareFindSpotVersion(31).stores({
      landscapeInterpretations: "&geohash6, generatedAt",
    });

    // v32: on-device diagnostic ring buffer (2,000 entry cap).
    // Additive — no user data migration. Existing records untouched.
    // Privacy: never transmitted; user-exportable from Settings.
    declareFindSpotVersion(32).stores({
      diagnosticLog: 'id, ts, level, scope',
    });

    // v33: undug signals table.
    // One-tap logging of detector signals the user chose not to dig.
    // Additive — no user data migration. Existing records untouched.
    // Compound index [permissionId+status] supports the permission-scoped
    // revisit list query. sourceSignalId on finds is a TypeScript-only
    // additive field — no index change needed there.
    declareFindSpotVersion(33).stores({
      undugSignals: 'id, [permissionId+status], sessionId, status, createdAt',
    });

    // v34: outstanding questions table.
    // Deterministic archaeological enquiries derived from FieldGuide scans.
    // Additive — no user data migration. Existing records untouched.
    // Indexed by permissionId for permission-scoped queries and deletion cascade.
    declareFindSpotVersion(34).stores({
      outstandingQuestions: 'id, permissionId, ruleId, status',
    });

    // v35: retire PROTECTED_AREA_EXCLUSION, COVERAGE_GAP, PUBLIC_RECORD_CONTEXT
    // question rules. Their information now lives on the Permission row
    // (protectionStatus, pasContext) and PermissionPulse context lines.
    // Delete any persisted question rows with retired ruleIds — they are
    // derived data, regenerable, and no user notes exist yet.
    declareFindSpotVersion(35).stores({}).upgrade(async tx => {
      const RETIRED_RULE_IDS = new Set([
        'PROTECTED_AREA_EXCLUSION',
        'COVERAGE_GAP',
        'PUBLIC_RECORD_CONTEXT',
      ]);
      const questions = tx.table('outstandingQuestions');
      const all = await questions.toArray();
      const retiredIds = all
        .filter((q: any) => RETIRED_RULE_IDS.has(q.ruleId))
        .map((q: any) => q.id);
      if (retiredIds.length > 0) {
        await questions.bulkDelete(retiredIds);
      }
    });

    // v36: question notes table (Phase B — Dialogue).
    // User and system notes attached to investigations by questionId.
    // Additive — no user data migration.
    declareFindSpotVersion(36).stores({
      questionNotes: 'id, questionId, createdAt',
    });

    // v37: Phase C investigation state fields on outstandingQuestions.
    // No indexes change; Dexie persists additive object fields automatically.
    declareFindSpotVersion(37).stores({});

    // v38: Phase E transition history and supersede ancestry metadata.
    // Existing indexes already cover questionNotes and outstandingQuestions.
    declareFindSpotVersion(38).stores({});

    // v39: durable, regenerable geocoding cache. Kept outside backup/restore;
    // invalid or stale rows are discarded by the geocoding service.
    declareFindSpotVersion(39).stores({
      geocodeCache: 'cacheKey, fetchedAt',
    });

    // v40: honest hotspot calibration denominator. Raw surfaced predictions
    // retain explicit unvisited/searched/hit outcomes; aggregates survive the
    // raw-record TTL sweep by engine version and confidence label.
    declareFindSpotVersion(40).stores({
      hotspotPredictions: 'id, engineVersion, confidence, surfacedAt, permissionId, sessionId, outcome',
      hotspotPredictionAggregates: 'id, engineVersion, confidence, updatedAt',
    });

    // v41: stable permission sections and source-specific session coverage
    // observations. Both are additive; section geometry is created lazily so
    // opening an existing database does not perform heavy spatial work.
    declareFindSpotVersion(41).stores({
      permissionSections: 'id, permissionId, fieldId, retiredAt',
      sessionCoverage: 'id, sessionId, permissionId, sectionId, evidence, observedAt, [sectionId+evidence]',
    });

    // Production and migration fixtures both replay this exact registry.
    applyFindSpotVersions(this);
  }
}

export const db = new FindSpotDB();
