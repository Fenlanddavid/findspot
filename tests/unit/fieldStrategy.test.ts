import { describe, it, expect } from 'vitest';
import { buildFieldStrategy } from '../../src/services/fieldguide/fieldStrategy';

const hs = (o: Partial<any> = {}): any => ({
    id: 'h1',
    type: 'Movement Corridor (Likely)',
    score: 50,
    confidence: 'Strong Signal',
    classification: 'Route-Side Activity Zone',
    classificationReason: 'On a historic route',
    explanation: ['a', 'b'],
    metrics: { convergence: 3, signalClassCount: 3 },
    ...o,
});

const ps = (id: string, finalScore: number): any => ({ processId: id, finalScore });

describe('buildFieldStrategy', () => {
    it('empty → no plan + uncertainty reasons', () => {
        const r = buildFieldStrategy([], []);
        expect(r.hasPlan).toBe(false);
        expect(r.uncertaintyReasons.length).toBeGreaterThan(0);
    });

    it('leads with behaviour from processScores, not hotspots', () => {
        const r = buildFieldStrategy(
            [hs({ classification: 'Settlement Edge Candidate' })],
            [ps('movement', 90), ps('occupation_potential', 40)],
        );
        expect(r.behaviours[0].processId).toBe('movement');
        expect(r.behaviours[0].emphasis).toBe('Primary');
    });

    it('attaches a representative hotspot via the class map', () => {
        const r = buildFieldStrategy(
            [hs({ id: 'm', classification: 'Crossing Point Candidate' })],
            [ps('movement', 100)],
        );
        expect(r.behaviours[0].representativeHotspotId).toBe('m');
    });

    it('orders by priority and softens the lead line', () => {
        const r = buildFieldStrategy(
            [
                hs({ id: 'low',  confidence: 'Developing Signal', score: 90 }),
                hs({ id: 'high', confidence: 'Strongest Signal',  score: 10 }),
            ],
            [ps('movement', 50)],
        );
        expect(r.searchOrder[0].hotspotId).toBe('high');
        expect(r.leadLine).toMatch(/points first/i);
    });

    it('routes disturbed low-confidence zones to avoid, with displacement reason', () => {
        const r = buildFieldStrategy(
            [hs({
                id: 'bad',
                confidence: 'Weak Signal',
                disturbanceRisk: 'High',
                soilMechanics: { interpretationClass: 'disturbed_plough_slope', userNote: '' },
            })],
            [ps('movement', 10)],
        );
        expect(r.searchOrder).toHaveLength(0);
        expect(r.avoidZones[0].reason).toMatch(/plough movement/i);
    });

    it('uses Roman road context when no target hotspot is dominant', () => {
        const r = buildFieldStrategy([], [], {
            historicRoutes: [{
                id: 'rr1',
                type: 'roman_road',
                source: 'itinere',
                confidenceClass: 'B',
                certaintyScore: 0.8,
                geometry: [],
                bbox: [[0, 0], [0, 0]],
                period: 'roman',
            }],
            pasFindPeriods: ['Medieval', 'Medieval', 'Roman'],
            potentialBreakdown: { terrain: 55, hydro: 10, historic: 70, signals: 55 },
        });

        expect(r.hasPlan).toBe(true);
        expect(r.searchOrder[0].title).toBe('Roman road corridor');
        expect(r.landscapeNote).toBeNull();
        expect(r.confidenceReason).toMatch(/Roman road/i);
    });

    it('surveyor note is advisory and has no time references', () => {
        const r = buildFieldStrategy([hs()], [ps('movement', 100)]);
        expect(r.surveyorNote).toMatch(/practical first pass/i);
        expect(r.surveyorNote).not.toMatch(/\b\d+\s*(min|minute|hour)/i);
        expect(r.surveyorNote).not.toMatch(/you (should|must)/i);
    });

    it('snapshot: mixed-behaviour scan', () => {
        const r = buildFieldStrategy(
            [
                hs({
                    id: 'a',
                    confidence: 'Strongest Signal',
                    classification: 'Crossing Point Candidate',
                    isHighConfidenceCrossing: true,
                    metrics: { convergence: 4, signalClassCount: 4 },
                }),
                hs({
                    id: 'b',
                    confidence: 'Strong Signal',
                    classification: 'Settlement Edge Candidate',
                }),
                hs({
                    id: 'c',
                    confidence: 'Developing Signal',
                    classification: 'Lowland Activity Zone',
                    disturbanceRisk: 'High',
                    soilMechanics: { interpretationClass: 'disturbed_plough_slope', userNote: '' },
                }),
            ],
            [
                ps('movement', 100),
                ps('occupation_potential', 70),
                ps('water_relationships', 20),
            ],
        );
        expect(r).toMatchSnapshot();
    });
});
