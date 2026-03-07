import * as turf from "@turf/turf";

export interface CoverageResult {
    undetectionsGeoJSON: any; // FeatureCollection of polygons representing gaps
    detectedAreaM2: number;
    totalAreaM2: number;
    percentCovered: number;
    percentUndetected: number;
}

/**
 * Calculates coverage for a permission based on tracks.
 * @param boundary GeoJSON Polygon of the field
 * @param tracks Array of tracks (each with lat/lon points)
 * @param coilWidthM Width of the detector coil in meters (default 0.3m / ~12")
 */
export function calculateCoverage(boundary: any, tracks: any[], coilWidthM: number = 0.3): CoverageResult | null {
    if (!boundary || (boundary.type !== "Polygon" && boundary.type !== "MultiPolygon")) {
        return null;
    }

    try {
        // 1. Prepare Field Polygon
        let rawField: any = boundary.type === "Polygon" 
            ? turf.polygon(boundary.coordinates) 
            : turf.multiPolygon(boundary.coordinates);
        
        rawField = turf.rewind(rawField);
        
        const unkinked = turf.unkinkPolygon(rawField);
        let fieldPolygon: any = unkinked.features.length > 1 
            ? turf.union(unkinked) 
            : unkinked.features[0];

        if (!fieldPolygon) return null;
        const totalAreaM2 = turf.area(fieldPolygon);
        if (totalAreaM2 === 0) return null;

        // 2. Prepare Tracks
        const validTracks = tracks.filter(t => t.points && t.points.length >= 2);

        if (validTracks.length === 0) {
            return {
                undetectionsGeoJSON: turf.featureCollection([fieldPolygon]),
                detectedAreaM2: 0,
                totalAreaM2,
                percentCovered: 0,
                percentUndetected: 100
            };
        }

        // 3. Buffer Tracks (Aggressive Cleaning)
        // Use a 1m minimum radius for stability, or coilWidth/2 if larger
        const bufferRadiusM = Math.max(1.0, coilWidthM / 2);
        
        const bufferedSegments = validTracks.map(t => {
            const line = turf.lineString(t.points.map(p => [p.lon, p.lat]));
            const simplified = turf.simplify(line, { tolerance: 0.000001, highQuality: false });
            return turf.buffer(simplified, bufferRadiusM / 1000, { units: "kilometers" });
        }).filter(Boolean);

        if (bufferedSegments.length === 0) {
            return {
                undetectionsGeoJSON: turf.featureCollection([fieldPolygon]),
                detectedAreaM2: 0,
                totalAreaM2,
                percentCovered: 0,
                percentUndetected: 100
            };
        }

        // Union all tracks into one "Detected Area"
        let combinedDetected = bufferedSegments.length === 1 
            ? bufferedSegments[0] 
            : turf.union(turf.featureCollection(bufferedSegments as any));

        if (!combinedDetected) return null;
        combinedDetected = turf.rewind(combinedDetected);

        // 4. Find Intersection (Actual coverage within boundary)
        const detectedInsideField = turf.intersect(turf.featureCollection([fieldPolygon, combinedDetected]));

        if (!detectedInsideField) {
            return {
                undetectionsGeoJSON: turf.featureCollection([fieldPolygon]),
                detectedAreaM2: 0,
                totalAreaM2,
                percentCovered: 0,
                percentUndetected: 100
            };
        }

        const detectedAreaM2 = turf.area(detectedInsideField);
        const percentCovered = (detectedAreaM2 / totalAreaM2) * 100;

        // 5. Calculate Gaps (Field - Detected Area)
        const diff = turf.difference(turf.featureCollection([fieldPolygon, detectedInsideField]));

        let gaps: any[] = [];
        if (diff) {
            const flattened = turf.flatten(diff);
            gaps = flattened.features;
        } else {
            gaps = []; // 100% covered
        }

        return {
            undetectionsGeoJSON: turf.featureCollection(gaps),
            detectedAreaM2,
            totalAreaM2,
            percentCovered,
            percentUndetected: 100 - percentCovered
        };

    } catch (error) {
        console.error("Coverage calculation error:", error);
        return null;
    }
}
