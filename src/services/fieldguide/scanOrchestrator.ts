import type { Permission } from '../../db';
import type { ScanContext, TerrainScanResult } from '../../hooks/useTerrainScan';
import { positionMapForPermissionScan } from '../../outstandingQuestions/permissionScanTarget';
import { updatePermissionIntelligenceQuestions } from '../../outstandingQuestions/protectionScan';
import { historicQuestionRuleScope } from '../../outstandingQuestions/rules';
import type { RuleId } from '../../outstandingQuestions/types';
import { diagLog } from '../diagLog';
import { markPermissionQuestionsEvaluated } from '../fieldGuideMutations';

type PermissionScanMap = Parameters<typeof positionMapForPermissionScan>[0];

export interface FieldGuideScanOrchestratorOptions {
    map: PermissionScanMap | null;
    isBusy: boolean;
    permissions: readonly Permission[];
    requestedPermissionId?: string;
    runTerrainScan: () => Promise<TerrainScanResult | null>;
    runHistoricPhase: (
        context: ScanContext,
        requestedPermissionId?: string,
        questionRuleIds?: readonly RuleId[],
    ) => Promise<boolean>;
    onScanStart: () => void;
    onTerrainResult: (result: TerrainScanResult) => void;
    onHistoricStart: () => void;
    onScanFailure: () => void;
    onScanComplete: () => void;
    onNavigateToPermission: (permissionId: string) => void;
}

export interface FieldGuideScanOrchestratorDependencies {
    positionPermission: (map: PermissionScanMap, permission: Permission) => boolean;
    updatePermissionIntelligence: (permission: Permission) => Promise<boolean>;
    questionRuleScope: (
        permissionScanRequested: boolean,
        permissionWideUpdated: boolean,
    ) => readonly RuleId[] | undefined;
    markPermissionEvaluated: (permissionId: string, evaluatedAt: string) => Promise<void>;
    recordError: (message: string, detail: string) => void;
    now: () => string;
}

export type FieldGuideScanRun =
    | { status: 'ignored' | 'invalid_permission' | 'terrain_failed' }
    | { status: 'historic_started'; completion: Promise<void> };

const DEFAULT_DEPENDENCIES: FieldGuideScanOrchestratorDependencies = {
    positionPermission: positionMapForPermissionScan,
    updatePermissionIntelligence: updatePermissionIntelligenceQuestions,
    questionRuleScope: historicQuestionRuleScope,
    markPermissionEvaluated: markPermissionQuestionsEvaluated,
    recordError: (message, detail) => {
        void diagLog.error('outstanding_questions', message, detail);
    },
    now: () => new Date().toISOString(),
};

function errorDetail(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function scanContextFromTerrain(result: TerrainScanResult): ScanContext {
    return {
        terrainClusters: result.terrainClusters,
        monumentPoints: result.monumentPoints,
        routes: result.routes,
        nhleData: result.nhleData,
        aimData: result.aimData,
        scanCenter: result.scanStartCenter,
        analysisBounds: result.analysisBounds,
        questionTerrainAvailability: result.questionTerrainAvailability,
        historicRoutesAvailable: result.historicRoutesAvailable,
    };
}

export async function runFieldGuideScan(
    options: FieldGuideScanOrchestratorOptions,
    dependencyOverrides: Partial<FieldGuideScanOrchestratorDependencies> = {},
): Promise<FieldGuideScanRun> {
    const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
    if (!options.map || options.isBusy) return { status: 'ignored' };

    let requestedPermission: Permission | undefined;
    if (options.requestedPermissionId) {
        requestedPermission = options.permissions.find(
            permission => permission.id === options.requestedPermissionId,
        );
        if (
            !requestedPermission
            || !dependencies.positionPermission(options.map, requestedPermission)
        ) {
            dependencies.recordError(
                'Permission question scan could not be positioned',
                `Permission ${options.requestedPermissionId} has no usable scan location`,
            );
            return { status: 'invalid_permission' };
        }
    }

    const permissionIntelligence = requestedPermission
        ? dependencies.updatePermissionIntelligence(requestedPermission).catch(error => {
            dependencies.recordError(
                'Permission intelligence question update failed',
                errorDetail(error),
            );
            return false;
        })
        : Promise.resolve(false);

    options.onScanStart();
    const terrainResult = await options.runTerrainScan();
    if (!terrainResult) {
        await permissionIntelligence;
        options.onScanFailure();
        if (options.requestedPermissionId) {
            options.onNavigateToPermission(options.requestedPermissionId);
        }
        return { status: 'terrain_failed' };
    }

    options.onTerrainResult(terrainResult);
    const permissionIntelligenceUpdated = await permissionIntelligence;
    const questionRuleIds = dependencies.questionRuleScope(
        !!options.requestedPermissionId,
        permissionIntelligenceUpdated,
    );
    const context = scanContextFromTerrain(terrainResult);
    options.onHistoricStart();

    const completion = options.runHistoricPhase(
        context,
        options.requestedPermissionId,
        questionRuleIds,
    ).then(async questionsUpdated => {
        if (options.requestedPermissionId && !questionsUpdated) {
            try {
                await dependencies.markPermissionEvaluated(
                    options.requestedPermissionId,
                    dependencies.now(),
                );
            } catch (error) {
                dependencies.recordError(
                    'Could not record permission question scan',
                    errorDetail(error),
                );
            }
        }
        options.onScanComplete();
        if (options.requestedPermissionId) {
            options.onNavigateToPermission(options.requestedPermissionId);
        }
    }).catch(error => {
        dependencies.recordError(
            'Permission question scan completion failed',
            errorDetail(error),
        );
    });

    return { status: 'historic_started', completion };
}
