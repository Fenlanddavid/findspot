import type { Find, Permission } from '../../db';
import type { ScanContext } from '../../hooks/useTerrainScan';
import type { RuleId } from '../../outstandingQuestions/types';
import { updateQuestionsAfterScan } from '../../outstandingQuestions/updateAfterScan';
import { diagLog, reportNonFatal } from '../diagLog';
import { recordFindHotspotSignals } from '../findHotspotService';
import { recordHotspotPredictions } from '../hotspotPredictionService';
import type { HistoricScanResult } from './historicScanCoordinator';

export type PostScanOrchestratorOptions = {
  result: HistoricScanResult;
  context: ScanContext;
  requestedPermissionId?: string;
  questionRuleIds?: readonly RuleId[];
  projectFinds: Find[];
  permissions: Permission[];
};

/**
 * Persist the post-scan evidence pipeline independently of page/UI state.
 * Recording failures are deliberately non-fatal; question evaluation remains
 * awaited because it is part of a complete permission scan.
 */
export async function persistPostScanOutcomes({
  result,
  context,
  requestedPermissionId,
  questionRuleIds,
  projectFinds,
  permissions,
}: PostScanOrchestratorOptions): Promise<boolean> {
  if (!result.drifted && result.enhancedHotspots.length > 0) {
    void recordFindHotspotSignals(result.enhancedHotspots, projectFinds)
      .catch(error => {
        reportNonFatal('field-guide', 'Find hotspot signal recording failed', error);
      });
    void recordHotspotPredictions(result.enhancedHotspots, {
      permissionId: requestedPermissionId ?? null,
    }).catch(error => {
      reportNonFatal('field-guide', 'Hotspot prediction recording failed', error);
    });
  }

  if (result.drifted || !context.analysisBounds) return false;

  try {
    await updateQuestionsAfterScan({
      permissionId: requestedPermissionId,
      scanCenter: context.scanCenter ?? result.center,
      hotspots: result.enhancedHotspots,
      clusters: context.terrainClusters,
      routes: result.routes,
      scanBounds: context.analysisBounds,
      sourceAvailability: result.questionSourceAvailability,
      permissions,
      scheduledMonuments: result.scheduledMonuments,
      pasRecordCountInScanCell: result.pasCell?.c,
      pasTopPeriods: result.pasCell?.p,
      pasTopTypes: result.pasCell?.t,
      ruleIds: questionRuleIds,
    });
    return true;
  } catch (error) {
    void diagLog.error(
      'outstanding_questions',
      'Post-scan question update failed',
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}
