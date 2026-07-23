import {
    ETYMOLOGY_SIGNALS,
    type HistoricFind,
    type PlaceSignal,
} from '../../pages/fieldGuideTypes';
import type {
    AIMResponse,
    NominatimResponse,
    NHLEResponse,
    OverpassElement,
    OverpassResponse,
} from '../historicScanService';
import { getDistanceKm } from '../../utils/fieldGuideAnalysis';
import { isHeritageElement } from './historicScanSupport';

const OSM_TYPE_PERIOD: Record<string, string> = {
    roman_road: 'Roman',
    villa: 'Roman',
    amphitheatre: 'Roman',
    fort: 'Roman',
    aqueduct: 'Roman',
    temple: 'Roman',
    bathhouse: 'Roman',
    milestone: 'Roman',
    castle: 'Medieval',
    monastery: 'Medieval',
    abbey: 'Medieval',
    church: 'Medieval',
    moat: 'Medieval',
    manor: 'Medieval',
    village: 'Medieval',
    standing_stone: 'Prehistoric',
    stone_circle: 'Prehistoric',
    cairn: 'Prehistoric',
    barrow: 'Prehistoric',
    tumulus: 'Prehistoric',
    hill_fort: 'Iron Age',
    minster: 'Anglo-Saxon',
};

function inferOsmPeriod(element: OverpassElement): string {
    if (element.tags?.period) return element.tags.period;
    const type = element.tags?.historic || element.tags?.archaeological_site || '';
    return OSM_TYPE_PERIOD[type.toLowerCase()] ?? 'Unknown';
}

export function buildPlaceSignals(
    contextData: OverpassResponse | null,
    geoData: NominatimResponse | null,
    center: { lat: number; lng: number },
): { placeSignals: PlaceSignal[]; overpassSignalCount: number } {
    const placeSignals: PlaceSignal[] = [];
    for (const element of contextData?.elements ?? []) {
        const name = element.tags?.name || '';
        if (!name) continue;
        const lat = element.lat || element.center?.lat;
        const lon = element.lon || element.center?.lon;
        if (!lat || !lon) continue;
        for (const signal of ETYMOLOGY_SIGNALS) {
            if (!name.toLowerCase().includes(signal.pattern.toLowerCase())) continue;
            const typeValue = (
                element.tags?.historic
                || element.tags?.heritage
                || element.tags?.place
                || element.tags?.natural
                || element.tags?.landuse
                || element.tags?.standing_remains
                || 'Location'
            );
            placeSignals.push({
                name,
                meaning: signal.meaning,
                distance: getDistanceKm(center.lat, center.lng, lat, lon),
                period: signal.period,
                confidence: signal.confidence,
                type: String(typeValue),
            });
        }
    }
    const overpassSignalCount = placeSignals.length;

    const address = geoData?.address;
    const addressNames = [
        address?.hamlet,
        address?.village,
        address?.suburb,
        address?.town,
        address?.parish,
        address?.county,
        address?.state_district,
    ].filter((name): name is string => !!name);
    for (const name of addressNames) {
        for (const signal of ETYMOLOGY_SIGNALS) {
            if (!name.toLowerCase().includes(signal.pattern.toLowerCase())) continue;
            const alreadyFound = placeSignals.some(
                found => found.name === name && found.meaning === signal.meaning,
            );
            if (alreadyFound) continue;
            placeSignals.push({
                name,
                meaning: signal.meaning,
                distance: 0,
                period: signal.period,
                confidence: signal.confidence,
                type: 'Place Name',
            });
        }
    }
    return {
        placeSignals: placeSignals.sort((a, b) => b.confidence - a.confidence),
        overpassSignalCount,
    };
}

export function buildOsmHistoricFinds(
    contextData: OverpassResponse | null,
    center: { lat: number; lng: number },
): HistoricFind[] {
    return (contextData?.elements ?? [])
        .filter(isHeritageElement)
        .map((element): HistoricFind | null => {
            const lat = element.lat || element.center?.lat;
            const lon = element.lon || element.center?.lon;
            if (!lat || !lon) return null;
            if (getDistanceKm(center.lat, center.lng, lat, lon) > 2) return null;
            const type = (
                element.tags?.historic
                || element.tags?.archaeological_site
                || element.tags?.heritage
                || element.tags?.standing_remains
                || element.tags?.site_type
                || 'Heritage Site'
            );
            const name = element.tags?.name;
            const descriptiveType = name ? `${name} (${type})` : type;
            return {
                id: `OSM-${element.id}`,
                internalId: String(element.id),
                objectType: (
                    String(descriptiveType).charAt(0).toUpperCase()
                    + String(descriptiveType).slice(1)
                ),
                broadperiod: inferOsmPeriod(element),
                county: 'Local Area',
                workflow: 'PAS' as const,
                lat,
                lon,
                isApprox: false,
                osmType: element.type,
            };
        })
        .filter((find): find is HistoricFind => find !== null);
}

export function extractMonumentPoints(nhleData: NHLEResponse): [number, number][] {
    return (nhleData.features ?? []).map(feature => {
        if (feature.geometry?.type === 'Point') {
            return feature.geometry.coordinates as [number, number];
        }
        if (feature.geometry?.type === 'Polygon') {
            return (feature.geometry.coordinates as number[][][])[0][0] as [number, number];
        }
        if (feature.geometry?.type === 'MultiPolygon') {
            return (feature.geometry.coordinates as number[][][][])[0][0][0] as [number, number];
        }
        return [0, 0] as [number, number];
    });
}

export function buildNhleHistoricFinds(nhleData: NHLEResponse): HistoricFind[] {
    return (nhleData.features ?? []).map((feature, index): HistoricFind | null => {
        let lat = 0;
        let lon = 0;
        if (feature.geometry?.type === 'Point') {
            [lon, lat] = feature.geometry.coordinates as number[];
        } else if (feature.geometry?.type === 'Polygon') {
            [lon, lat] = (feature.geometry.coordinates as number[][][])[0][0];
        } else if (feature.geometry?.type === 'MultiPolygon') {
            [lon, lat] = (feature.geometry.coordinates as number[][][][])[0][0][0];
        }
        if (!lat || !lon) return null;
        const name = feature.properties?.Name || 'Scheduled Monument';
        return {
            id: `NHLE-${feature.properties?.ListEntry ?? index}`,
            internalId: String(feature.properties?.ListEntry ?? index),
            objectType: `${name} (Scheduled Monument)`,
            broadperiod: 'Prehistoric–Medieval',
            county: 'Local Area',
            workflow: 'PAS' as const,
            lat,
            lon,
            isApprox: false,
            osmType: 'way' as const,
        };
    }).filter((find): find is HistoricFind => find !== null);
}

export function mergeHistoricFinds(
    osmFinds: HistoricFind[],
    nhleFinds: HistoricFind[],
): HistoricFind[] {
    const osmCoords = osmFinds.map(find => ({ lat: find.lat, lon: find.lon }));
    const dedupedNhle = nhleFinds.filter(nhleFind => (
        !osmCoords.some(osm => (
            Math.abs(osm.lat - nhleFind.lat) < 0.0005
            && Math.abs(osm.lon - nhleFind.lon) < 0.0005
        ))
    ));
    return [...dedupedNhle, ...osmFinds];
}

export function buildAimFeatures(aimData: AIMResponse): Array<{
    center: [number, number];
    type: string;
    period: string;
}> {
    return (aimData.features ?? []).flatMap(feature => {
        const geometry = feature.geometry;
        if (!geometry) return [];
        let center: [number, number];
        if (geometry.type === 'Point') {
            center = geometry.coordinates as [number, number];
        } else {
            const ring = geometry.type === 'Polygon'
                ? (geometry.coordinates as number[][][])[0]
                : geometry.type === 'MultiPolygon'
                    ? (geometry.coordinates as number[][][][])[0][0]
                    : null;
            if (!ring?.length) return [];
            center = [
                ring.reduce((sum, point) => sum + point[0], 0) / ring.length,
                ring.reduce((sum, point) => sum + point[1], 0) / ring.length,
            ];
        }
        return [{
            center,
            type: feature.properties?.MONUMENT_TYPE ?? 'Cropmark',
            period: feature.properties?.PERIOD ?? '',
        }];
    });
}
