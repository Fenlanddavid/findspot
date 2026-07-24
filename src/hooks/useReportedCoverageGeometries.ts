import { useLiveQuery } from 'dexie-react-hooks';
import type { GeoJSONArea } from '../shared/coverageTypes';
import { sectionGeometryAtVersion } from '../shared/coverageRecords';
import { pagePersistence } from '../services/pagePersistence';

export type ReportedCoverageGeometry = {
  fieldId: string | null;
  sessionId: string;
  geometry: GeoJSONArea;
};

export function useReportedCoverageGeometries(
  permissionId: string | undefined,
  sessionId?: string,
): ReportedCoverageGeometry[] {
  return useLiveQuery(async () => {
    if (!permissionId) return [];
    const [sections, observations] = await Promise.all([
      pagePersistence.permissionSections
        .where('permissionId')
        .equals(permissionId)
        .toArray(),
      sessionId
        ? pagePersistence.sessionCoverage
            .where('sessionId')
            .equals(sessionId)
            .filter(observation => observation.evidence === 'reported')
            .toArray()
        : pagePersistence.sessionCoverage
            .where('permissionId')
            .equals(permissionId)
            .filter(observation => observation.evidence === 'reported')
            .toArray(),
    ]);
    const sectionById = new Map(sections.map(section => [section.id, section]));
    const seenGeometryVersions = new Set<string>();
    return observations.flatMap(observation => {
      const geometryKey = `${observation.sectionId}:v${observation.sectionGeometryVersion}`;
      if (seenGeometryVersions.has(geometryKey)) return [];
      const section = sectionById.get(observation.sectionId);
      const version = section
        ? sectionGeometryAtVersion(section, observation.sectionGeometryVersion)
        : null;
      if (section && version) seenGeometryVersions.add(geometryKey);
      return section && version
        ? [{
            fieldId: section.fieldId,
            sessionId: observation.sessionId,
            geometry: version.geometry,
          }]
        : [];
    });
  }, [permissionId, sessionId]) ?? [];
}
