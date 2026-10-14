import type { Cluster, HistoricFind, HistoricRoute, LayerFetchStatus, PlaceSignal, ScanBounds } from '../../pages/fieldGuideTypes';
import type { AIMFeature, AIMResponse, NHLEFeature, NHLEResponse } from '../historicScanService';
import { buildNhleHistoricFinds, mergeHistoricFinds } from './historicScanRecords';
import { contextRelationship, type ContextGeometry, type ContextRelationship } from './historicContextSpatial';

export type AssessmentState = 'supporting_signal' | 'no_supporting_signal' | 'unavailable' | 'not_assessed' | 'failed' | 'incomplete';
export interface SourceAssessment {
    key: string;
    label: string;
    state: AssessmentState;
}
export interface ScanAssessmentSources {
    availability: Record<string, boolean>;
    status: Record<string, LayerFetchStatus>;
    completeness: Record<string, boolean>;
    usability?: Record<string, 'usable' | 'loaded' | 'none'>;
    /** Raw observations, before contextual enrichment or display filtering. */
    observations: Cluster[];
}
export interface HeritageContextRecord {
    id: string;
    source: 'osm' | 'nhle' | 'aim';
    recordType: string;
    period?: string;
    uncertainty?: string;
    geometryBasis: 'mapped_geometry' | 'recorded_point' | 'bounding_box' | 'unknown';
    relationship: ContextRelationship;
    feature: HistoricFind | NHLEFeature | AIMFeature;
}
export interface RouteContextRecord {
    id: string;
    segments: HistoricRoute[];
    relationship: ContextRelationship;
    explanation: string;
}
export interface SupportingContextSummary {
    title: string;
    subtitle: string;
    recordedHeritage: HeritageContextRecord[];
    historicRoutes: RouteContextRecord[];
    terrain: SourceAssessment[];
    imagery: SourceAssessment[];
    environment: { sources: SourceAssessment[]; placeNames: PlaceSignal[] };
    coverage: { sources: SourceAssessment[]; limitations: string[]; scheduledDataset?: NHLEResponse['dataset']; aerialProjectCoverage?: AIMResponse['projectCoverage'] };
    lines: string[];
    centre: { lat: number; lng: number } | null;
    bounds: ScanBounds | null;
}
export interface SupportingContextInput {
    centre: { lat: number; lng: number };
    bounds: ScanBounds;
    finds: HistoricFind[];
    nhle: NHLEResponse;
    aim: AIMResponse;
    routes: HistoricRoute[];
    placeSignals: PlaceSignal[];
    historicContextAvailable: boolean;
    historicRoutesAvailable: boolean;
    assessmentSources?: ScanAssessmentSources;
}

const terrainLabels = { terrain: 'LiDAR observations', terrain_global: 'Rendered terrain observations', slope: 'Slope observations', elevation_dem: 'Elevation measurements' };
const imageryLabels = { satellite_spring: 'Imagery A', satellite_summer: 'Imagery B' };
const assessed = (state: AssessmentState) => state === 'supporting_signal' || state === 'no_supporting_signal';
const stateLabels: Record<AssessmentState, string> = {
    supporting_signal: 'assessed; landscape observations present, with no specific archaeological interpretation established',
    no_supporting_signal: 'assessed; no additional corroboration identified',
    unavailable: 'unavailable', not_assessed: 'not assessed', failed: 'assessment failed', incomplete: 'assessment incomplete',
};

export function sourceAssessmentLine(source: SourceAssessment): string {
    return `${source.label}: ${stateLabels[source.state]}.`;
}

function assessSources(labels: Record<string, string>, input?: ScanAssessmentSources): SourceAssessment[] {
    return Object.entries(labels).map(([key, label]) => {
        let state: AssessmentState = 'not_assessed';
        if (input && key in input.availability) {
            const status = input.status[key];
            if (status === 'processing_failed') state = 'failed';
            else if (status === 'unavailable' || !input.availability[key]) state = 'unavailable';
            else if (status === 'partial' || input.completeness[key] !== true || !status) state = 'incomplete';
            else if (input.usability?.[key] === 'loaded') state = 'not_assessed';
            else if (input.usability?.[key] === 'none') state = 'unavailable';
            else state = input.observations.some(c => c.source === key || c.sources?.includes(key as Cluster['source']))
                ? 'supporting_signal' : 'no_supporting_signal';
        }
        return { key, label, state };
    });
}

function geometryOf(feature: NHLEFeature | AIMFeature): ContextGeometry | null {
    if (!['Point', 'Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) return null;
    return feature.geometry as ContextGeometry;
}

/** Identity falls back to content when the dataset supplies no stable source ID. */
export function heritageFeatureKey(source: 'nhle' | 'aim', feature: NHLEFeature | AIMFeature): string {
    const properties = feature.properties as Record<string, unknown>;
    const id = source === 'nhle' ? properties.ListEntry : properties.MONUMENT_ID;
    return `${source}:${id ?? JSON.stringify([feature.geometry, feature.properties])}`;
}

/** Shared parent IDs/references group split features; unnamed unrelated ways stay distinct. */
export function historicRouteIdentity(route: HistoricRoute): string {
    return `${route.source}:${route.type}:${route.reference?.trim() || route.parentRouteId || route.name?.trim().toLowerCase() || route.id}`;
}

function routeContexts(input: SupportingContextInput): RouteContextRecord[] {
    const groups = new Map<string, HistoricRoute[]>();
    for (const route of input.routes) {
        const key = historicRouteIdentity(route);
        const group = groups.get(key) ?? [];
        if (!group.some(segment => segment.id === route.id)) group.push(route);
        groups.set(key, group);
    }
    return [...groups].map(([id, segments]) => {
        const relationships = segments.map(route => {
            try {
                return contextRelationship({ type: 'LineString', coordinates: route.geometry }, input.bounds, [input.centre.lng, input.centre.lat]);
            } catch { return 'query_extent' as const; }
        });
        const relationship = relationships.includes('intersects_scan') ? 'intersects_scan' : relationships.includes('nearby') ? 'nearby' : 'query_extent';
        const representativeIndex = Math.max(0, relationships.indexOf(relationship));
        const route = segments[representativeIndex];
        const orderedSegments = [route, ...segments.filter((_, index) => index !== representativeIndex)];
        const label = route.type === 'roman_road' ? 'Mapped Roman-road alignment' : route.type === 'holloway' ? 'Mapped holloway' : 'Mapped historic route';
        const location = relationship === 'intersects_scan' ? 'intersects this scan area' : relationship === 'nearby' ? 'lies nearby' : 'was returned within the broader query extent; intersection with this scan area is not established';
        const sources = [...new Set(segments.map(r => `${r.source.toUpperCase()}, confidence ${r.confidenceClass}${r.period ? `, ${r.period}` : ''}`))].join('; ');
        return { id, segments: orderedSegments, relationship, explanation: `${label}${route.name ? ` (${route.name})` : ''} ${location}. Source: ${sources}.` };
    });
}

export function buildSupportingContext(input: SupportingContextInput): SupportingContextSummary {
    const recordedHeritage: HeritageContextRecord[] = [];
    const seen = new Set<string>();
    const relationshipFor = (geometry: ContextGeometry): ContextRelationship => {
        try { return contextRelationship(geometry, input.bounds, [input.centre.lng, input.centre.lat]); }
        catch { return 'query_extent'; }
    };
    for (const [source, features] of [['nhle', input.nhle.features], ['aim', input.aim.features]] as const) {
        for (const feature of features) {
            const id = heritageFeatureKey(source, feature);
            if (seen.has(id)) continue;
            seen.add(id);
            const geometry = geometryOf(feature);
            const properties = feature.properties as Record<string, string | undefined>;
            recordedHeritage.push({ id, source, recordType: source === 'nhle' ? 'Scheduled monument' : properties.MONUMENT_TYPE ?? 'Aerial mapping record',
                period: properties.PERIOD, uncertainty: properties.EVIDENCE_1,
                geometryBasis: properties.GEOMETRY_BASIS === 'bounding_box' ? 'bounding_box' : geometry?.type === 'Point' ? 'recorded_point' : source === 'aim' && !properties.GEOMETRY_BASIS ? 'unknown' : 'mapped_geometry',
                relationship: geometry ? relationshipFor(geometry) : 'query_extent', feature });
        }
    }
    // Keep the established cross-source identity policy for OSM/NHLE mirrors.
    const nhleFinds = buildNhleHistoricFinds(input.nhle);
    const osmFinds = input.finds.filter(f => f.id.startsWith('OSM-')
        && !(f.osmType === 'way' && input.routes.some(route => route.source === 'osm' && route.id === `route-${f.internalId}`)));
    const merged = mergeHistoricFinds(osmFinds, nhleFinds);
    const mirroredOsm = new Set(osmFinds.filter(osm => nhleFinds.some(nhle => !merged.includes(nhle)
        && Math.abs(osm.lat - nhle.lat) < 0.0005 && Math.abs(osm.lon - nhle.lon) < 0.0005)).map(f => f.id));
    for (const find of osmFinds) {
        const id = `osm:${find.osmType ?? 'unknown'}:${find.internalId || find.id}`;
        if (seen.has(id) || mirroredOsm.has(find.id)) continue;
        seen.add(id);
        recordedHeritage.push({ id, source: 'osm', recordType: find.objectType, period: find.broadperiod,
            geometryBasis: 'recorded_point',
            uncertainty: find.isApprox ? 'Approximate point location' : 'Point record; extent unknown',
            relationship: relationshipFor({ type: 'Point', coordinates: [find.lon, find.lat] }), feature: find });
    }
    const historicRoutes = routeContexts(input);
    const terrain = assessSources(terrainLabels, input.assessmentSources);
    const imagery = assessSources(imageryLabels, input.assessmentSources);
    const environment = { sources: assessSources({ hydrology: 'Water context' }, input.assessmentSources), placeNames: [...new Map(input.placeSignals.map(s => [`${s.name}:${s.meaning}`, s])).values()] };
    const recordSources: SourceAssessment[] = [
        { key: 'scheduled_monuments', label: 'Scheduled monument records', state: input.nhle.available === false ? input.nhle.features.length ? 'incomplete' : 'unavailable' : input.nhle.available === true ? input.nhle.features.length ? 'supporting_signal' : 'no_supporting_signal' : 'not_assessed' },
        { key: 'aim', label: 'Aerial mapping records', state: input.aim.available === false ? input.aim.features.length ? 'incomplete' : 'unavailable' : input.aim.available === true ? input.aim.projectCoverage && input.aim.projectCoverage.state !== 'mapped' ? 'incomplete' : input.aim.features.length ? 'supporting_signal' : 'no_supporting_signal' : 'not_assessed' },
        { key: 'historic_context', label: 'OSM heritage records', state: input.historicContextAvailable ? osmFinds.length ? 'supporting_signal' : 'no_supporting_signal' : 'unavailable' },
        { key: 'historic_routes', label: 'Historic route datasets', state: input.historicRoutesAvailable ? historicRoutes.length ? 'supporting_signal' : 'no_supporting_signal' : 'incomplete' },
    ];
    const limitations = ['Dataset returns reflect mapping and recording coverage, not archaeological significance or absence. Sites counts deduplicated OSM heritage, scheduled monument and aerial mapping records in the scan and surrounding query area; personal finds and public PAS records are separate.'];
    for (const source of recordSources.filter(s => !assessed(s.state))) limitations.push(`${source.label}: ${stateLabels[source.state]}.`);
    if (input.nhle.unavailableReason) limitations.push(`Scheduled monument coverage: ${input.nhle.unavailableReason.replaceAll('_', ' ')}.`);
    if (input.aim.projectCoverage) limitations.push(`Aerial mapping project coverage: ${input.aim.projectCoverage.state.replaceAll('_', ' ')}${input.aim.projectCoverage.projectNames.length ? ` (${input.aim.projectCoverage.projectNames.join(', ')})` : ''}.`);
    else limitations.push('Aerial mapping project coverage was not supplied.');
    if (input.assessmentSources && [...terrain, ...imagery].some(s => s.state === 'incomplete')) limitations.push('Some source assessments are incomplete. A fresh scan is required to resolve unassessed coverage or missing assessment details.');
    const present = recordedHeritage.length > 0 || historicRoutes.length > 0;
    const within = recordedHeritage.some(r => !['bounding_box', 'unknown'].includes(r.geometryBasis) && ['contains_scan_centre', 'intersects_scan', 'point_within_scan'].includes(r.relationship)) || historicRoutes.some(r => r.relationship === 'intersects_scan');
    const incomplete = recordSources.some(s => !assessed(s.state));
    const title = present ? 'Recorded archaeological context present' : incomplete ? 'Historic context could not be fully assessed' : 'No heritage records returned';
    const subtitle = present ? within ? 'Heritage records or historic routes occur within this scan area.' : 'Heritage records or historic routes were returned in the surrounding query area; this does not establish archaeology within the scan footprint.' : incomplete ? 'Some historic sources were unavailable or incomplete. See source limitations.' : 'No records were returned by the available datasets. This does not establish an absence of archaeology.';
    const observations = [...terrain, ...imagery];
    const lines = [
        ...(recordedHeritage.length > 0 && recordedHeritage.length <= 3 ? ['Few records returned by the available datasets. Record count does not measure archaeological significance.'] : []),
        ...observations.map(sourceAssessmentLine),
        ...(environment.sources.some(s => s.state === 'supporting_signal') ? ['Water-related landscape observations are present; water context alone does not establish settlement.'] : []),
        ...(environment.placeNames.length ? ['Place-name signals are contextual clues, not confirmation of archaeology.'] : []),
    ];
    return { title, subtitle, recordedHeritage, historicRoutes, terrain, imagery, environment, coverage: { sources: recordSources, limitations, scheduledDataset: input.nhle.dataset, aerialProjectCoverage: input.aim.projectCoverage }, lines, centre: input.centre, bounds: input.bounds };
}

export function emptySupportingContext(): SupportingContextSummary {
    return { title: 'No completed scan data yet', subtitle: 'Run a scan to read the recorded historic context and source assessments for this area.', recordedHeritage: [], historicRoutes: [], terrain: [], imagery: [], environment: { sources: [], placeNames: [] }, coverage: { sources: [], limitations: [] }, lines: [], centre: null, bounds: null };
}
