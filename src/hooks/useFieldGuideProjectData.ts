import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Media, type SavedPoint } from '../db';
import type { WorkflowState } from '../types/significantFind';
import { getDistance } from '../utils/fieldGuideAnalysis';
import {
    computeHotspotLandscapeIntelligence,
    computeLandscapeSummary,
} from '../engines/landscape/landscapeIntelligenceEngine';
import { computeTraceTargets } from '../engines/hotspot/traceTargetEngine';
import type {
    Cluster,
    LandscapeIntelligence,
    LandscapeSummary,
    TraceTarget,
} from '../pages/fieldGuideTypes';
import type { FieldGuidePageState } from './useFieldGuidePageState';
import {
    hasLocalPhysicalEvidence,
    hasTargetEvidence,
} from '../services/fieldguide/fieldGuidePageSupport';

interface FieldGuideProjectDataOptions {
    projectId: string;
    onSignificantFind?: (initialContext?: Partial<WorkflowState>) => void;
    state: FieldGuidePageState;
}

export function useFieldGuideProjectData({
    projectId,
    onSignificantFind,
    state,
}: FieldGuideProjectDataOptions) {
    const { detectedFeatures, hotspots, terrainClusters } = state.engineState;
    const permissions =
        useLiveQuery(() => db.permissions.where('projectId').equals(projectId).toArray())
        || [];
    const realPermissions = permissions.filter(permission => !permission.isDefault);
    const fields =
        useLiveQuery(() => db.fields.where('projectId').equals(projectId).toArray())
        || [];
    const projectFinds = useLiveQuery(
        () => db.finds.where('projectId').equals(projectId).toArray(),
        [projectId],
    ) ?? [];
    const savedPoints = useLiveQuery(
        () => db.savedPoints.where('projectId').equals(projectId).sortBy('createdAt'),
        [projectId],
    ) ?? [] as SavedPoint[];
    const liveActiveSession = useLiveQuery(
        () => db.sessions
            .where('projectId')
            .equals(projectId)
            .filter(session => !session.isFinished)
            .sortBy('updatedAt')
            .then(sessions => sessions[sessions.length - 1]),
        [projectId],
    );
    const selectedUserFindMedia = useLiveQuery<Media | undefined>(
        () => state.selectedUserFind
            ? db.media
                .where('findId')
                .equals(state.selectedUserFind.id)
                .filter(media => media.type === 'photo')
                .first()
            : Promise.resolve(undefined),
        [state.selectedUserFind?.id],
    );

    const showConcentrationBanner = useMemo(() => {
        if (!onSignificantFind || state.sfBannerDismissed || !liveActiveSession) {
            return false;
        }
        const sessionFinds = projectFinds.filter(find => (
            find.sessionId === liveActiveSession.id
            && find.lat != null
            && find.lon != null
        ));
        if (sessionFinds.length < 6) return false;
        const centerLat = sessionFinds.reduce((sum, find) => sum + find.lat!, 0)
            / sessionFinds.length;
        const centerLon = sessionFinds.reduce((sum, find) => sum + find.lon!, 0)
            / sessionFinds.length;
        const averageDistance = sessionFinds.reduce((sum, find) => {
            const latDistance = (find.lat! - centerLat) * 111320;
            const lonDistance = (find.lon! - centerLon)
                * 111320
                * Math.cos(centerLat * Math.PI / 180);
            return sum + Math.sqrt(latDistance ** 2 + lonDistance ** 2);
        }, 0) / sessionFinds.length;
        return averageDistance <= 40;
    }, [
        projectFinds,
        liveActiveSession,
        state.sfBannerDismissed,
        onSignificantFind,
    ]);

    const hotspotFindContext = useMemo(() => {
        const context = new Map<string, { status: 'within' | 'nearby'; count: number }>();
        const locatedFinds = projectFinds.filter(find => find.lat !== null && find.lon !== null);
        for (const hotspot of hotspots) {
            const [[minLon, minLat], [maxLon, maxLat]] = hotspot.bounds;
            let withinCount = 0;
            let nearbyCount = 0;
            for (const find of locatedFinds) {
                if (
                    find.lon! >= minLon
                    && find.lon! <= maxLon
                    && find.lat! >= minLat
                    && find.lat! <= maxLat
                ) {
                    withinCount += 1;
                } else if (getDistance([find.lon!, find.lat!], hotspot.center) <= 150) {
                    nearbyCount += 1;
                }
            }
            if (withinCount > 0) {
                context.set(hotspot.id, { status: 'within', count: withinCount });
            } else if (nearbyCount > 0) {
                context.set(hotspot.id, { status: 'nearby', count: nearbyCount });
            }
        }
        return context;
    }, [projectFinds, hotspots]);

    const sortedHotspots = useMemo(() => {
        const sorted = [...hotspots].sort((a, b) => b.score - a.score);
        const strong = sorted.filter(hotspot => !(
            hotspot.classification === 'General Activity Zone'
            && hotspot.score < 35
        ));
        if (strong.length >= 3) return strong;
        return [
            ...strong,
            ...sorted.filter(hotspot => (
                hotspot.classification === 'General Activity Zone'
                && hotspot.score >= 25
            )),
        ];
    }, [hotspots]);

    const { landscapeIntelligenceMap, landscapeSummary } = useMemo(() => {
        const intelligenceMap = new Map<string, LandscapeIntelligence>();
        if (!hotspots.length) {
            return {
                landscapeIntelligenceMap: intelligenceMap,
                landscapeSummary: null as LandscapeSummary | null,
            };
        }
        const memberLookup = new Map<string, Cluster>(
            terrainClusters.map(cluster => [cluster.id, cluster]),
        );
        for (const hotspot of hotspots) {
            const members = hotspot.memberIds
                .map(id => memberLookup.get(id))
                .filter((cluster): cluster is Cluster => Boolean(cluster));
            intelligenceMap.set(
                hotspot.id,
                computeHotspotLandscapeIntelligence(hotspot, members),
            );
        }
        return {
            landscapeIntelligenceMap: intelligenceMap,
            landscapeSummary: computeLandscapeSummary(
                sortedHotspots.length ? sortedHotspots : hotspots,
                intelligenceMap,
            ),
        };
    }, [hotspots, sortedHotspots, terrainClusters]);

    const sourceUsability = useMemo(() => {
        const result: Record<string, 'usable' | 'loaded' | 'none'> = {};
        if (!state.sourceAvailability) return result;
        for (const key of [
            'terrain',
            'terrain_global',
            'slope',
            'hydrology',
            'satellite_spring',
            'satellite_summer',
        ]) {
            result[key] = state.sourceAvailability[key] ? 'usable' : 'none';
        }
        return result;
    }, [state.sourceAvailability]);

    const targetFindContext = useMemo(() => {
        const context = new Map<string, { status: 'within' | 'nearby'; count: number }>();
        const locatedFinds = projectFinds.filter(find => find.lat !== null && find.lon !== null);
        for (const target of detectedFeatures) {
            let withinCount = 0;
            let nearbyCount = 0;
            for (const find of locatedFinds) {
                const distance = getDistance([find.lon!, find.lat!], target.center);
                if (distance <= 35) withinCount += 1;
                else if (distance <= 100) nearbyCount += 1;
            }
            if (withinCount > 0) {
                context.set(target.id, { status: 'within', count: withinCount });
            } else if (nearbyCount > 0) {
                context.set(target.id, { status: 'nearby', count: nearbyCount });
            }
        }
        return context;
    }, [projectFinds, detectedFeatures]);

    const displayTargets = useMemo(() => {
        for (const feature of detectedFeatures) {
            if (feature.isProtected && !feature.monumentBufferM) continue;
            if (!hasTargetEvidence(feature)) {
                feature.suppressedBy ??= [];
                if (!feature.suppressedBy.includes('failed_evidence_gate')) {
                    feature.suppressedBy.push('failed_evidence_gate');
                }
            }
            if (!hasLocalPhysicalEvidence(feature)) {
                feature.suppressedBy ??= [];
                if (!feature.suppressedBy.includes('failed_physical_gate')) {
                    feature.suppressedBy.push('failed_physical_gate');
                }
            }
        }
        const visible = detectedFeatures
            .filter(feature => (
                (feature.isProtected && !feature.monumentBufferM)
                || (
                    hasTargetEvidence(feature)
                    && hasLocalPhysicalEvidence(feature)
                    && !feature.isRouteArtefactRisk
                )
            ))
            .sort((a, b) => b.findPotential - a.findPotential)
            .slice(0, 12);
        let targetNumber = 0;
        return visible.map(feature => feature.isProtected
            ? { ...feature, number: 0 }
            : { ...feature, number: ++targetNumber });
    }, [detectedFeatures]);

    const traceTargets = useMemo<TraceTarget[]>(() => (
        detectedFeatures.length
            ? computeTraceTargets(
                detectedFeatures,
                displayTargets,
                state.rawClusters,
                state.devMode,
                state.modernWaysRef.current,
            )
            : []
    ), [detectedFeatures, displayTargets, state.rawClusters, state.devMode, state.modernWaysRef]);

    const primaryTargetId = useMemo(() => {
        const candidates = displayTargets.filter(feature => !feature.isProtected);
        if (!candidates.length) return null;
        const center: [number, number] = [
            candidates.reduce((sum, feature) => sum + feature.center[0], 0) / candidates.length,
            candidates.reduce((sum, feature) => sum + feature.center[1], 0) / candidates.length,
        ];
        const reference = state.userGpsPos ?? center;
        const distance = (point: [number, number]) => (
            Math.sqrt((point[0] - reference[0]) ** 2 + (point[1] - reference[1]) ** 2)
        );
        const hash = (value: string) => value
            .split('')
            .reduce((result, char) => (result * 31 + char.charCodeAt(0)) | 0, 0);
        return [...candidates].sort((a, b) => {
            if (b.findPotential !== a.findPotential) {
                return b.findPotential - a.findPotential;
            }
            const distanceDifference = distance(a.center) - distance(b.center);
            if (Math.abs(distanceDifference) > 1e-9) return distanceDifference;
            return hash(a.id) - hash(b.id);
        })[0].id;
    }, [displayTargets, state.userGpsPos]);

    return {
        permissions,
        realPermissions,
        fields,
        projectFinds,
        savedPoints,
        selectedUserFindMedia,
        showConcentrationBanner,
        hotspotFindContext,
        sortedHotspots,
        landscapeIntelligenceMap,
        landscapeSummary,
        sourceUsability,
        targetFindContext,
        displayTargets,
        traceTargets,
        primaryTargetId,
    };
}

export type FieldGuideProjectData = ReturnType<typeof useFieldGuideProjectData>;
