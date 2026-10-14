import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HistoricRoute, Cluster } from '../../src/pages/fieldGuideTypes';
import type { NHLEFeature } from '../../src/services/historicScanService';
import { buildSupportingContext, type SupportingContextInput, type ScanAssessmentSources } from '../../src/services/fieldguide/supportingContext';
import { contextRelationship, distanceToContextGeometryM } from '../../src/services/fieldguide/historicContextSpatial';
import { adaptSupportingContextForLandscape } from '../../src/services/fieldguide/landscapeInterpretation/signalAdapters';
import { SupportingContextEvidence, RecordedHeritageDetails } from '../../src/components/fieldGuide/SupportingContextEvidence';
import { isScheduledMonumentOverlap } from '../../src/services/fieldguide/landscapeInterpretation/scheduledMonumentGate';
import { SMUnavailableBanner } from '../../src/components/fieldGuide/SMUnavailableBanner';
import { scanContextFromTerrain } from '../../src/services/fieldguide/scanOrchestrator';
import type { TerrainScanResult } from '../../src/hooks/useTerrainScan';
import { safeParseFieldGuideScanCache } from '../../src/services/persistenceValidation';
import { HistoricLayerManager } from '../../src/components/fieldGuide/HistoricLayerManager';
import { FieldGuideContext, type FieldGuideContextValue } from '../../src/components/fieldGuide/FieldGuideContext';

// Synthetic Flag Fen-style wetland/site scenario, NOT surveyed Flag Fen geometry.
const centre = { lat: 52, lng: 0.1 };
const bounds = { west: 0.099, east: 0.101, south: 51.999, north: 52.001 };
const monument: NHLEFeature = {
    type: 'Feature', properties: { Name: 'Synthetic Flag Fen regression monument', ListEntry: 'synthetic-1' },
    geometry: { type: 'Polygon', coordinates: [[[0.08, 51.99], [0.12, 51.99], [0.12, 52.01], [0.08, 52.01], [0.08, 51.99]]] },
};
const road: HistoricRoute = {
    id: 'segment-1', type: 'roman_road', source: 'rrra', name: 'Synthetic alignment', reference: 'fixture-road',
    confidenceClass: 'C', certaintyScore: 40, period: 'roman',
    geometry: [[0.09, 52], [0.11, 52]], bbox: [[0.09, 52], [0.11, 52]],
};
function input(overrides: Partial<SupportingContextInput> = {}): SupportingContextInput {
    return { centre, bounds, finds: [], nhle: { features: [], available: true }, aim: { features: [], available: true },
        routes: [], placeSignals: [], historicContextAvailable: true, historicRoutesAvailable: true, ...overrides };
}
function sources(overrides: Partial<ScanAssessmentSources> = {}): ScanAssessmentSources {
    return { availability: { terrain: true, satellite_spring: true }, status: { terrain: 'ok', satellite_spring: 'ok' },
        completeness: { terrain: true, satellite_spring: true }, observations: [], ...overrides };
}
const text = (value: unknown) => JSON.stringify(value);

describe('supporting historic context (Flag Fen regression)', () => {
    it('A: acknowledges a recorded monument independently of a legacy score of 35', () => {
        const summary = buildSupportingContext(input({ nhle: { features: [monument], available: true } }));
        expect(summary.title).toBe('Recorded archaeological context present');
        expect(summary.recordedHeritage).toHaveLength(1);
        expect(summary.subtitle).toContain('within this scan area');
        expect(text(summary)).not.toMatch(/Low historic density|Limited historic alignment|worth investigating/i);
    });

    it('B: acknowledges a Roman route without numeric heritage points and retains uncertainty', () => {
        const summary = buildSupportingContext(input({ routes: [road] }));
        expect(summary.title).toBe('Recorded archaeological context present');
        expect(summary.historicRoutes[0].explanation).toContain('intersects this scan area');
        expect(summary.historicRoutes[0].explanation).toContain('RRRA, confidence C, roman');
        expect(summary.historicRoutes[0].segments[0].certaintyScore).toBe(40);
    });

    it('preserves supplied dataset provenance and project coverage through the landscape adapter', () => {
        const dataset = { sources: ['NHLE', 'Cadw'], coverage: ['england', 'wales'], builtAt: '2026-01-01T00:00:00Z' };
        const projectCoverage = { state: 'partial' as const, projectNames: ['Synthetic mapping project'] };
        const summary = buildSupportingContext(input({ nhle: { features: [monument], available: true, dataset }, aim: { features: [], available: true, projectCoverage } }));
        const adapted = adaptSupportingContextForLandscape(summary);
        expect(adapted.recordedContext.coverage.scheduledDataset).toEqual(dataset);
        expect(adapted.recordedContext.coverage.aerialProjectCoverage).toEqual(projectCoverage);
        expect(summary.coverage.sources.find(source => source.key === 'aim')?.state).toBe('incomplete');
    });

    it('C: keeps unassessed terrain and imagery distinct from measured negative evidence', () => {
        const summary = buildSupportingContext(input());
        expect([...summary.terrain, ...summary.imagery].every(s => s.state === 'not_assessed')).toBe(true);
        expect(summary.lines.join(' ')).not.toMatch(/weak|no additional corroboration|not present/i);
        expect(summary.lines.join(' ')).toContain('Imagery A: not assessed');
    });

    it('D: distinguishes successful assessment with no corroboration from unavailable sources', () => {
        const summary = buildSupportingContext(input({ assessmentSources: sources({ availability: { terrain: true, satellite_spring: false } }) }));
        expect(summary.terrain[0].state).toBe('no_supporting_signal');
        expect(summary.imagery[0].state).toBe('unavailable');
        expect(summary.lines.join(' ')).toContain('LiDAR observations: assessed; no additional corroboration identified');
        expect(summary.lines.join(' ')).toContain('Imagery A: unavailable');
    });

    it('retains positive observations without asserting archaeological corroboration', () => {
        const observation = { source: 'terrain', sources: ['terrain'] } as Cluster;
        const summary = buildSupportingContext(input({ assessmentSources: sources({ observations: [observation] }) }));
        expect(summary.terrain[0].state).toBe('supporting_signal');
        expect(summary.lines.join(' ')).toContain('no specific archaeological interpretation established');
        expect(summary.title).toBe('No heritage records returned');
    });

    it.each(['processing_failed', 'partial'] as const)('preserves %s instead of claiming no signal', status => {
        const summary = buildSupportingContext(input({ assessmentSources: sources({ status: { terrain: status } }) }));
        expect(summary.terrain[0].state).toBe(status === 'processing_failed' ? 'failed' : 'incomplete');
    });

    it('does not promote a merely loaded source into a completed assessment', () => {
        const summary = buildSupportingContext(input({ assessmentSources: sources({ usability: { terrain: 'loaded' } }) }));
        expect(summary.terrain[0].state).toBe('not_assessed');
    });

    it('E: recognises a containing polygon whose representative vertex is beyond 600 m', () => {
        const representativePoint = monument.geometry.coordinates[0][0] as [number, number];
        expect(distanceToContextGeometryM([centre.lng, centre.lat], { type: 'Point', coordinates: representativePoint })).toBeGreaterThan(600);
        expect(distanceToContextGeometryM([centre.lng, centre.lat], monument.geometry)).toBe(0);
        expect(contextRelationship(monument.geometry, bounds, [centre.lng, centre.lat])).toBe('contains_scan_centre');
        const summary = buildSupportingContext(input({ nhle: { features: [monument], available: true } }));
        expect(summary.recordedHeritage[0].relationship).toBe('contains_scan_centre');
    });

    it('uses polygon boundaries for distance and respects holes', () => {
        const geometry: GeoJSON.Polygon = { type: 'Polygon', coordinates: [
            [[0.08, 51.98], [0.12, 51.98], [0.12, 52.02], [0.08, 52.02], [0.08, 51.98]],
            [[0.095, 51.995], [0.105, 51.995], [0.105, 52.005], [0.095, 52.005], [0.095, 51.995]],
        ] };
        expect(distanceToContextGeometryM([0.1, 52], geometry)).toBeGreaterThan(300);
        expect(contextRelationship(geometry, bounds, [0.1, 52])).toBe('nearby');
    });

    it('retains point proximity semantics without claiming polygon overlap', () => {
        const point: NHLEFeature = { ...monument, geometry: { type: 'Point', coordinates: [0.1, 52] } };
        const summary = buildSupportingContext(input({ nhle: { features: [point], available: true } }));
        expect(summary.recordedHeritage[0].relationship).toBe('point_within_scan');
        const html = renderToStaticMarkup(<RecordedHeritageDetails summary={summary} />);
        expect(html).toContain('extent unknown');
        expect(html).not.toContain('contains the scan centre');
    });

    it('F: says nearby for a road outside the footprint', () => {
        const nearby = { ...road, geometry: [[0.09, 52.005], [0.11, 52.005]] as [number, number][] };
        const summary = buildSupportingContext(input({ routes: [nearby] }));
        expect(summary.historicRoutes[0].relationship).toBe('nearby');
        expect(summary.historicRoutes[0].explanation).toContain('lies nearby');
        expect(summary.subtitle).toContain('surrounding query area');
        expect(text(summary)).not.toContain('runs through');
    });

    it('does not promote bbox retrieval alone into a nearby or intersecting route', () => {
        const broader = { ...road, geometry: [[0, 51.99], [0, 52.1], [0.2, 52.1]] as [number, number][] };
        const summary = buildSupportingContext(input({ routes: [broader] }));
        expect(summary.historicRoutes[0].relationship).toBe('query_extent');
        expect(summary.historicRoutes[0].explanation).toContain('intersection with this scan area is not established');
    });

    it('G: reports incomplete heritage retrieval and names missing sources', () => {
        const summary = buildSupportingContext(input({ nhle: { features: [], available: false }, historicContextAvailable: false }));
        expect(summary.title).toBe('Historic context could not be fully assessed');
        expect(summary.coverage.limitations.join(' ')).toContain('Scheduled monument records: unavailable');
        expect(summary.coverage.limitations.join(' ')).toContain('OSM heritage records: unavailable');
        expect(text(summary)).not.toMatch(/low historic density|weak signals/i);
    });

    it('H: deduplicates source records and route segments, preserving all segment provenance', () => {
        const summary = buildSupportingContext(input({ nhle: { features: [monument, monument], available: true },
            routes: [road, road, { ...road, id: 'segment-2' }] }));
        expect(summary.recordedHeritage).toHaveLength(1);
        expect(summary.historicRoutes).toHaveLength(1);
        expect(summary.historicRoutes[0].segments).toHaveLength(2);
        const adapted = adaptSupportingContextForLandscape(summary);
        expect(adapted.nhleFeatures).toHaveLength(1);
        expect(adapted.routeFeatures).toHaveLength(1);
        expect(adapted.recordedContext.historicRoutes[0].segments).toHaveLength(2);
    });

    it('groups unnamed split routes by parent ID but keeps unrelated unnamed routes distinct', () => {
        const summary = buildSupportingContext(input({ routes: [
            { ...road, name: undefined, reference: undefined, parentRouteId: 'parent-1' },
            { ...road, id: 'segment-2', name: undefined, reference: undefined, parentRouteId: 'parent-1' },
            { ...road, id: 'other', name: undefined, reference: undefined },
        ] }));
        expect(summary.historicRoutes).toHaveLength(2);
    });

    it('does not add personal finds or public PAS records to Sites', () => {
        const summary = buildSupportingContext(input({ finds: [{ id: 'PAS-1' } as SupportingContextInput['finds'][number]] }));
        expect(summary.recordedHeritage).toHaveLength(0);
    });

    it('deduplicates OSM source identities and the existing OSM/NHLE mirror rule', () => {
        const find = { id: 'OSM-1', internalId: '1', osmType: 'way', objectType: 'Site', lat: 51.99, lon: 0.08 } as SupportingContextInput['finds'][number];
        const summary = buildSupportingContext(input({ finds: [find, find], nhle: { features: [monument], available: true } }));
        expect(summary.recordedHeritage).toHaveLength(1);
        expect(summary.recordedHeritage[0].source).toBe('nhle');
    });

    it('distinguishes index extents from mapped aerial-monument geometry', () => {
        const summary = buildSupportingContext(input({ aim: { available: true, features: [{ type: 'Feature', geometry: monument.geometry,
            properties: { MONUMENT_TYPE: 'Enclosure', PERIOD: 'Bronze Age', GEOMETRY_BASIS: 'bounding_box' } }] } }));
        expect(summary.recordedHeritage[0].geometryBasis).toBe('bounding_box');
        expect(summary.subtitle).not.toContain('occur within this scan area');
        expect(renderToStaticMarkup(<RecordedHeritageDetails summary={summary} />)).toContain('index extent only');
    });

    it('I: retains the independent protection gate and avoids detecting recommendations', () => {
        const summary = buildSupportingContext(input({ nhle: { features: [monument], available: true }, routes: [road] }));
        expect(isScheduledMonumentOverlap('fixture', adaptSupportingContextForLandscape(summary).nhleFeatures)).toBe(true);
        const html = renderToStaticMarkup(<SupportingContextEvidence summary={summary} />);
        expect(html).toContain('Scheduled monument overlap');
        expect(html).toContain('role="alert"');
        expect(html).not.toMatch(/worth investigating|focus detection|detect here|high-value target|unrestricted/i);
        expect(renderToStaticMarkup(<SMUnavailableBanner reason="coverage_scotland" />)).toContain('Scotland');
    });

    it('J: derives identical cached and fresh summaries from evidence and source states', () => {
        const fresh = input({ nhle: { features: [monument], available: true }, routes: [road], assessmentSources: sources() });
        const cache = safeParseFieldGuideScanCache({ id: 'fixture', createdAt: 1, rawClusters: [],
            sourceAvailability: fresh.assessmentSources!.availability, sourceCompleteness: fresh.assessmentSources!.completeness,
            sourceStatus: fresh.assessmentSources!.status });
        expect(cache).not.toBeNull();
        const scanContext = scanContextFromTerrain({ ...cache, sourceStatus: cache!.sourceStatus,
            questionTerrainAvailability: cache!.sourceCompleteness, fromCache: true, scanStartCenter: centre,
            analysisBounds: bounds } as unknown as TerrainScanResult);
        const cached = buildSupportingContext({ ...fresh, assessmentSources: scanContext.assessmentSources });
        expect(cached).toEqual(buildSupportingContext(fresh));
    });

    it('requires a fresh scan when legacy cached assessment details are insufficient', () => {
        const summary = buildSupportingContext(input({ assessmentSources: sources({ status: {}, completeness: {} }) }));
        expect(summary.terrain[0].state).toBe('incomplete');
        expect(summary.coverage.limitations.join(' ')).toContain('A fresh scan is required');
        expect(summary.lines.join(' ')).not.toContain('no additional corroboration');
    });

    it('renders the active panel with consistent counters, source limitations and independent protection', () => {
        const summary = buildSupportingContext(input({ nhle: { features: [monument, monument], available: true },
            routes: [road, { ...road, id: 'segment-2' }], assessmentSources: sources({ availability: { terrain: true, satellite_spring: false } }) }));
        const value = {
            supportingContext: summary, historicMode: true, historicScanComplete: true, loadingPAS: false,
            intelDetailsOpen: true, pasDensityCell: null, sortedHotspots: [], terrainClusters: [], displayTargets: [],
            pasFinds: [], historicRoutes: [road, road], placeSignals: [], projectFinds: [], landscapeIntelligenceMap: new Map(),
            mapRef: { current: null }, nhleDataRef: { current: null }, aimDataRef: { current: null }, terrainScanCenterRef: { current: centre },
            potentialScore: { score: 18, breakdown: { terrain: 0, historic: 35, imagery: 0, hydro: 0, placeNames: 0 } },
        } as unknown as FieldGuideContextValue;
        const html = renderToStaticMarkup(<FieldGuideContext.Provider value={value}><HistoricLayerManager /></FieldGuideContext.Provider>);
        expect(html).toContain('Recorded archaeological context present');
        expect(html).toContain('Scheduled monument overlap');
        expect(html).toContain('Imagery A: unavailable');
        expect(html).toContain('intersects this scan area');
        expect(html).toContain('synthetic-1');
        expect(html).not.toMatch(/historic density|limited historic alignment|focus detection|high-value targets/i);
    });
});
