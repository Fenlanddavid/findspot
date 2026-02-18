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

  notes: string;

  createdAt: string;
  updatedAt: string;
};

export type Session = {
  id: string;
  projectId: string;
  permissionId: string;

  date: string; // ISO datetime
  lat: number | null;
  lon: number | null;
  gpsAccuracyM: number | null;

  landUse: string;
  cropType: string;
  isStubble: boolean;

  notes: string;
  isFinished: boolean;

  createdAt: string;
  updatedAt: string;
};

export type Find = {
  id: string;
  projectId: string;
  permissionId: string;
  sessionId: string | null;

  findCode: string;
  objectType: string;
  coinType?: string;
  coinDenomination?: string;

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

  storageLocation: string;
  notes: string;

  createdAt: string;
  updatedAt: string;
};

export type Media = {
  id: string;
  projectId: string;
  findId: string;

  type: "photo";
  photoType?: "in-situ" | "cleaned" | "other";
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
  }
}

export const db = new FindSpotDB();