export type GeoJSONPolygon = {
  type: 'Polygon';
  coordinates: number[][][];
};

export type GeoJSONArea = GeoJSONPolygon | {
  type: 'MultiPolygon';
  coordinates: number[][][][];
};

export type PermissionSectionGeometryVersion = {
  version: number;
  boundaryHash: string;
  geometry: GeoJSONArea;
  areaM2: number;
  effectiveFrom: string;
};

export type PermissionSection = {
  id: string;
  permissionId: string;
  fieldId: string | null;
  layoutKey: string;
  label: string;
  currentGeometryVersion: number;
  geometryVersions: PermissionSectionGeometryVersion[];
  createdAt: string;
  updatedAt: string;
  retiredAt?: string;
};

export type CoverageEvidence = 'reported' | 'tracked' | 'find-visited';

export type SessionCoverageObservation = {
  id: string;
  sessionId: string;
  permissionId: string;
  sectionId: string;
  sectionGeometryVersion: number;
  evidence: CoverageEvidence;
  startedAt: number;
  observedAt: number;
  coverageFraction?: number;
  calculationVersion?: string;
  sourceRecordIds?: string[];
  createdAt: string;
  updatedAt: string;
};
