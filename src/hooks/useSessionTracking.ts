import { useEffect, useMemo, useState } from 'react';
import type { GeoJSONPolygon, Track } from '../db';
import type { GeoJSONArea } from '../shared/coverageTypes';
import {
    applyReportedCoverageToGaps,
    calculateCoverage,
    type CoverageResult,
} from '../services/coverage';
import { isTrackingActiveForSession } from '../services/tracking';

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const radiusKm = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Owns GPS recording state and all track-derived coverage/distance values. */
export function useSessionTracking(
    sessionId: string,
    boundary: GeoJSONPolygon | undefined,
    tracks: Track[] | undefined,
    reportedAreas: GeoJSONArea[] = [],
) {
    const [isTracking, setIsTracking] = useState(isTrackingActiveForSession(sessionId));
    const [showTrackingOverlay, setShowTrackingOverlay] = useState(false);
    const [showCoverage, setShowCoverage] = useState(false);
    const [coverageResult, setCoverageResult] = useState<CoverageResult | null>(null);
    const [coverageError, setCoverageError] = useState(false);

    useEffect(() => setIsTracking(isTrackingActiveForSession(sessionId)), [sessionId, tracks]);
    useEffect(() => {
        if (!showCoverage || !boundary) {
            setCoverageResult(null);
            setCoverageError(false);
            return;
        }
        const result = applyReportedCoverageToGaps(
            calculateCoverage(boundary, tracks ?? []),
            reportedAreas,
        );
        setCoverageResult(result);
        setCoverageError(result === null);
    }, [boundary, reportedAreas, showCoverage, tracks]);

    const activeDistanceKm = useMemo(() => {
        let total = 0;
        for (const track of tracks ?? []) {
            const points = [...(track.points ?? [])].sort((a, b) => a.timestamp - b.timestamp);
            for (let index = 1; index < points.length; index++) {
                total += haversineKm(points[index - 1].lat, points[index - 1].lon, points[index].lat, points[index].lon);
            }
        }
        return total > 0 ? total : null;
    }, [tracks]);
    const activeCoverage = useMemo(
        () => boundary && tracks?.length ? calculateCoverage(boundary, tracks) : null,
        [boundary, tracks],
    );

    return {
        isTracking, setIsTracking,
        showTrackingOverlay, setShowTrackingOverlay,
        showCoverage, setShowCoverage,
        coverageResult, coverageError,
        activeDistanceKm, activeCoverage,
    };
}
