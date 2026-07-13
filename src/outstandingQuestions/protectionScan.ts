import type { Permission } from '../db';
import { fetchScheduledMonuments } from '../services/historicScanService';
import { getPASDensityNear } from '../services/pasDensityService';
import { fetchRomanRoadsResult } from '../services/romanRoadService';
import type { QuestionSourceAvailability } from './types';
import { getPermissionScanTarget } from './permissionScanTarget';
import { updateQuestionsAfterScan } from './updateAfterScan';
import { PERMISSION_WIDE_RULE_IDS } from './rules';

const PERMISSION_SCAN_SOURCES: QuestionSourceAvailability = {
  terrain: false,
  terrain_global: false,
  slope: false,
  hydrology: false,
  satellite_spring: false,
  satellite_summer: false,
  scheduled_monuments: true,
  aim: false,
  historic_context: false,
  historic_routes: false,
  pas_density: false,
};

export async function updatePermissionIntelligenceQuestions(permission: Permission): Promise<boolean> {
  const ring = permission.boundary?.coordinates?.[0];
  const scanCenter = getPermissionScanTarget(permission);
  if (!ring?.length || !scanCenter) return false;

  const lons = ring.map(point => point[0]).filter(Number.isFinite);
  const lats = ring.map(point => point[1]).filter(Number.isFinite);
  if (!lons.length || !lats.length) return false;

  const scanBounds = {
    west: Math.min(...lons),
    south: Math.min(...lats),
    east: Math.max(...lons),
    north: Math.max(...lats),
  };
  const [scheduledMonuments, romanRoadResult, pasCell] = await Promise.all([
    fetchScheduledMonuments(
      scanBounds.west,
      scanBounds.south,
      scanBounds.east,
      scanBounds.north,
    ),
    fetchRomanRoadsResult(
      scanBounds.west,
      scanBounds.south,
      scanBounds.east,
      scanBounds.north,
    ),
    getPASDensityNear(scanCenter.lat, scanCenter.lon),
  ]);
  if (scheduledMonuments.available === false) return false;

  const sourceAvailability: QuestionSourceAvailability = {
    ...PERMISSION_SCAN_SOURCES,
    scheduled_monuments: true,
    historic_routes: romanRoadResult.available,
    pas_density: pasCell !== null,
  };

  await updateQuestionsAfterScan({
    permissionId: permission.id,
    scanCenter: { lat: scanCenter.lat, lng: scanCenter.lon },
    hotspots: [],
    clusters: [],
    routes: romanRoadResult.routes,
    scanBounds,
    sourceAvailability,
    permissions: [permission],
    scheduledMonuments,
    pasRecordCountInScanCell: pasCell?.c,
    pasTopPeriods: pasCell?.p,
    pasTopTypes: pasCell?.t,
    ruleIds: PERMISSION_WIDE_RULE_IDS,
  });
  return true;
}
