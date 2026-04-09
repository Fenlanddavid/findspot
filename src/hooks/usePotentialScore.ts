// ─── Hook: potential score calculation ───────────────────────────────────────
import { useState } from 'react';
import { HistoricFind, PlaceSignal } from '../pages/fieldGuideTypes';

export interface PotentialScore {
    score: number;
    reasons: string[];
    breakdown?: {
        terrain: number;
        hydro: number;
        historic: number;
        signals: number;
    };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function usePotentialScore() {
    const [potentialScore, setPotentialScore] = useState<PotentialScore | null>(null);
    const [scanConfidence, setScanConfidence] = useState<'High Probability' | 'Developing Signal' | 'Low Confidence' | null>(null);

    const calculatePotentialScore = (
        pas: HistoricFind[],
        monuments: [number, number][],
        signals: PlaceSignal[],
        centerLat: number,
        centerLng: number
    ) => {
        const reasons: string[] = [];

        // 1. Terrain/Anomaly Potential (Derived from general surroundings)
        const terrainPoints = 20;

        // 2. Hydrology Strength
        const nearbyHydroSignals = signals.filter(s => (s.type.includes('stream') || s.type.includes('river') || s.type.includes('water')) && s.distance < 1.0);
        const hydroScore = Math.min(100, nearbyHydroSignals.length * 30 + 10);
        if (nearbyHydroSignals.length > 0) reasons.push("Strategic water proximity");

        // 3. Historic Proximity (OSM + NHLE)
        const nearbyHeritage = pas.filter(f => haversineKm(centerLat, centerLng, f.lat, f.lon) < 1.5);
        const nearbyMonuments = monuments.filter(m => haversineKm(centerLat, centerLng, m[1], m[0]) < 0.6);

        let historicPoints = 0;
        if (nearbyHeritage.length >= 3) historicPoints += 45;
        else if (nearbyHeritage.length > 0) historicPoints += 25;
        if (nearbyMonuments.length > 0) historicPoints += 35;

        if (nearbyHeritage.length > 0) reasons.push(`${nearbyHeritage.length} historic features nearby`);
        if (nearbyMonuments.length > 0) reasons.push("Adjacent to Scheduled Monument");

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

        const finalScore = Math.min(98, Math.max(15, (terrainPoints * 0.2) + (hydroScore * 0.2) + (historicPoints * 0.4) + (signalPoints * 0.2)));

        setPotentialScore({
            score: Math.round(finalScore),
            reasons,
            breakdown: {
                terrain: terrainPoints,
                hydro: hydroScore,
                historic: Math.min(100, historicPoints),
                signals: signalPoints
            }
        });

        let confidence: 'High Probability' | 'Developing Signal' | 'Low Confidence' = 'Developing Signal';
        const hasHistoricSupport = historicPoints > 0 || signalPoints > 15;

        if (hasHistoricSupport && (pas.length + signals.length) > 5) confidence = 'High Probability';
        else if (!hasHistoricSupport) confidence = 'Low Confidence';

        setScanConfidence(confidence);
    };

    return { potentialScore, scanConfidence, setPotentialScore, setScanConfidence, calculatePotentialScore };
}
