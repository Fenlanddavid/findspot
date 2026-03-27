import Dexie, { Table } from "dexie";

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

  boundary?: any; // GeoJSON Polygon object

  notes: string;

  validFrom?: string; // ISO date string

  createdAt: string;
  updatedAt: string;
};

export type Field = {
  id: string;
  projectId: string;
  permissionId: string;
  name: string;
  boundary: any; // GeoJSON Polygon
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
  coinType?: string;
  coinDenomination?: string;
  pasId?: string;
  
  isFavorite?: boolean;
  isPending?: boolean;

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
    | "Copper alloy"
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
  dateRange?: string;

  storageLocation: string;
  notes: string;

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
};

export type Setting = {
  key: string;
  value: any;
};

export class FindSpotDB extends Dexie {
  projects!: Table<Project, string>;
  permissions!: Table<Permission, string>;
  fields!: Table<Field, string>;
  sessions!: Table<Session, string>;
  finds!: Table<Find, string>;
  media!: Table<Media, string>;
  tracks!: Table<Track, string>;
  settings!: Table<Setting, string>;

  constructor() {
    super("findspot_uk");

    this.version(1).stores({
      projects: "id, name, region, createdAt",
      permissions: "id, projectId, name, type, observedAt, permissionGranted, createdAt",
      finds: "id, projectId, permissionId, findCode, objectType, createdAt",
      media: "id, projectId, findId, createdAt",
    });

    this.version(2).stores({
      projects: "id, name, region, createdAt",
      permissions: "id, projectId, name, type, permissionGranted, createdAt",
      sessions: "id, projectId, permissionId, date, createdAt",
      finds: "id, projectId, permissionId, sessionId, findCode, objectType, createdAt",
      media: "id, projectId, findId, createdAt",
    });

    this.version(3).stores({
      projects: "id, name, region, createdAt",
      permissions: "id, projectId, name, type, permissionGranted, createdAt",
      sessions: "id, projectId, permissionId, date, createdAt",
      finds: "id, projectId, permissionId, sessionId, findCode, objectType, createdAt",
      media: "id, projectId, findId, createdAt",
      settings: "key",
    });

    this.version(4).stores({
      projects: "id, name, region, createdAt",
      permissions: "id, projectId, name, type, permissionGranted, createdAt",
      sessions: "id, projectId, permissionId, date, createdAt",
      finds: "id, projectId, permissionId, sessionId, findCode, objectType, createdAt",
      media: "id, projectId, findId, createdAt",
      settings: "key",
    });

    this.version(5).stores({
      projects: "id, name, region, createdAt",
      permissions: "id, projectId, name, type, permissionGranted, createdAt",
      sessions: "id, projectId, permissionId, date, createdAt",
      finds: "id, projectId, permissionId, sessionId, findCode, objectType, createdAt",
      media: "id, projectId, findId, createdAt",
      tracks: "id, projectId, sessionId, isActive, createdAt",
      settings: "key",
    });

    this.version(6).stores({
      projects: "id, name, region, createdAt",
      permissions: "id, projectId, name, type, permissionGranted, createdAt",
      sessions: "id, projectId, permissionId, date, isFinished, createdAt",
      finds: "id, projectId, permissionId, sessionId, findCode, objectType, createdAt",
      media: "id, projectId, findId, createdAt",
      tracks: "id, projectId, sessionId, isActive, createdAt",
      settings: "key",
    });

    this.version(7).stores({
      projects: "id, name, region, createdAt",
      permissions: "id, projectId, name, type, permissionGranted, createdAt",
      sessions: "id, projectId, permissionId, date, isFinished, createdAt",
      finds: "id, projectId, permissionId, sessionId, findCode, objectType, isFavorite, createdAt",
      media: "id, projectId, findId, createdAt",
      tracks: "id, projectId, sessionId, isActive, createdAt",
      settings: "key",
    });

    this.version(8).stores({
      finds: "id, projectId, permissionId, sessionId, findCode, objectType, isFavorite, targetId, detector, createdAt",
    });

    this.version(9).stores({
      media: "id, projectId, findId, permissionId, createdAt",
    });

    this.version(10).stores({
      permissions: "id, projectId, name, type, permissionGranted, boundary, createdAt",
    });

    this.version(11).stores({
      fields: "id, projectId, permissionId, name, createdAt",
      sessions: "id, projectId, permissionId, fieldId, date, isFinished, createdAt",
      finds: "id, projectId, permissionId, fieldId, sessionId, findCode, objectType, isFavorite, targetId, detector, createdAt",
    }).upgrade(async tx => {
        const permissions = await tx.table("permissions").toArray();
        const now = new Date().toISOString();
        
        for (const p of permissions) {
            if (p.boundary) {
                // Browser-safe ID generation within transaction
                const fieldId = Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
                
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

    this.version(12).stores({
      finds: "id, projectId, permissionId, fieldId, sessionId, findCode, objectType, isFavorite, targetId, detector, ruler, dateRange, createdAt",
    });

    this.version(13).stores({
      finds: "id, projectId, permissionId, fieldId, sessionId, findCode, objectType, isFavorite, isPending, targetId, detector, ruler, dateRange, createdAt",
    });

    this.version(14).stores({
      permissions: "id, projectId, name, type, permissionGranted, boundary, validFrom, createdAt",
    });

    this.version(15).stores({
      sessions: "id, projectId, permissionId, fieldId, date, isFinished, startTime, endTime, createdAt",
    });
  }
}

export const db = new FindSpotDB();