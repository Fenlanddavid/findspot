// ─── Hook: potential score calculation ───────────────────────────────────────
import { useState } from 'react';
import { HistoricFind, PlaceSignal } from '../pages/fieldGuideTypes';
import { distanceKilometers } from '../utils/geo';
import type { NHLEResponse } from '../services/historicScanService';
import type { ScanBounds } from '../pages/fieldGuideTypes';
import { contextRelationship, distanceToContextGeometryM } from '../services/fieldguide/historicContextSpatial';

export interface PotentialScore {
    score: number;
    reasons: string[];
    breakdown?: {
        terrain: number;
        hydro: number;
        historic: number;
        placeNames: number;
        imagery: number;
    };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    return distanceKilometers({ lat: lat1, lon: lon1 }, { lat: lat2, lon: lon2 });
}

export function usePotentialScore() {
    const [potentialScore, setPotentialScore] = useState<PotentialScore | null>(null);
    const [scanConfidence, setScanConfidence] = useState<'Corroborated Signal' | 'Developing Signal' | 'Limited Signal' | null>(null);

    const calculatePotentialScore = (
        pas: HistoricFind[],
        monuments: [number, number][],
        signals: PlaceSignal[],
        centerLat: number,
        centerLng: number,
        scheduledContext?: { monuments: NHLEResponse; bounds: ScanBounds | null },
    ) => {
        const reasons: string[] = [];

        // 1. Terrain/Anomaly Potential (Derived from general surroundings)
        const terrainPoints = 0;

        // 2. Hydrology Strength
        const nearbyHydroSignals = signals.filter(s => (s.type.includes('stream') || s.type.includes('river') || s.type.includes('water')) && s.distance < 1.0);
        const hydroScore = Math.min(100, nearbyHydroSignals.length * 30);
        if (nearbyHydroSignals.length > 0) reasons.push("Water-edge landscape signal");

        // 3. Historic Proximity (OSM + NHLE)
        // NHLE mirrors in pasFinds are the same monuments, not independent evidence.
        const nearbyHeritage = pas.filter(f => !f.id.startsWith('NHLE-') && haversineKm(centerLat, centerLng, f.lat, f.lon) < 1.5);
        const nearbyMonuments = scheduledContext
            ? scheduledContext.monuments.features.filter(feature => {
                try {
                    const geometry = feature.geometry;
                    const centre: [number, number] = [centerLng, centerLat];
                    const relationship = scheduledContext.bounds ? contextRelationship(geometry, scheduledContext.bounds, centre, 600) : null;
                    return ['contains_scan_centre', 'intersects_scan', 'point_within_scan'].includes(relationship ?? '')
                        || distanceToContextGeometryM(centre, geometry) < 600;
                } catch { return false; }
            })
            : monuments.filter(m => haversineKm(centerLat, centerLng, m[1], m[0]) < 0.6);

        let historicPoints = 0;
        if (nearbyHeritage.length >= 3) historicPoints += 45;
        else if (nearbyHeritage.length > 0) historicPoints += 25;
        if (nearbyMonuments.length > 0) historicPoints += 35;

        if (nearbyHeritage.length > 0) reasons.push(`${nearbyHeritage.length} historic features nearby`);
        if (nearbyMonuments.length > 0) reasons.push('Recorded scheduled monument context (geometry or point proximity)');

        // 4. Etymological Signals (with RARITY WEIGHTING & DISTANCE DECAY)
        let signalPoints = 0;
        const nearbySignals = signals.filter(s => s.distance < 2.0);

        nearbySignals.forEach(s => {
            let weight = 1.0;
            if (s.name.toLowerCase().includes('chester') || s.name.toLowerCase().includes('caster')) weight = 2.0;
            else if (s.name.toLowerCase().includes('bury') || s.name.toLowerCase().includes('burgh')) weight = 1.5;
            else if (s.name.toLowerCase().includes('field') || s.name.toLowerCase().includes('acre')) weight = 0.8;

            let distFactor = 1.0;
            if (s.distance < 0.5) distFactor = 1.0;
            else if (s.distance < 1.5) distFactor = 0.5;
            else distFactor = 0.2;

            signalPoints += Math.round(s.confidence * 20 * weight * distFactor);
        });
        signalPoints = Math.min(100, signalPoints);

        if (nearbySignals.length > 0) {
            const bestSignal = [...nearbySignals].sort((a, b) => b.confidence - a.confidence)[0];
            reasons.push(`Local signal: ${bestSignal.name} (${bestSignal.meaning})`);
        }

        const finalScore = Math.min(98, Math.max(0, (terrainPoints * 0.2) + (hydroScore * 0.2) + (historicPoints * 0.5) + (signalPoints * 0.3)));

        setPotentialScore({
            score: Math.round(finalScore),
            reasons,
            breakdown: {
                terrain: terrainPoints,
                hydro: hydroScore,
                historic: Math.min(100, historicPoints),
                placeNames: signalPoints,
                imagery: 0,
            }
        });

        let confidence: 'Corroborated Signal' | 'Developing Signal' | 'Limited Signal' = 'Developing Signal';
        const hasHistoricSupport = historicPoints > 0 || signalPoints > 15;

        if (hasHistoricSupport && (pas.length + signals.length) > 5) confidence = 'Corroborated Signal';
        else if (!hasHistoricSupport) confidence = 'Limited Signal';

        setScanConfidence(confidence);
    };

    return { potentialScore, scanConfidence, setPotentialScore, setScanConfidence, calculatePotentialScore };
}
