import type { PermissionSection } from './coverageTypes';

export function currentSectionGeometry(
  section: PermissionSection,
): PermissionSection['geometryVersions'][number] | null {
  return section.geometryVersions.find(
    version => version.version === section.currentGeometryVersion,
  ) ?? null;
}

export function sectionGeometryAtVersion(
  section: PermissionSection,
  versionNumber: number,
): PermissionSection['geometryVersions'][number] | null {
  return section.geometryVersions.find(version => version.version === versionNumber) ?? null;
}
