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
    if (!boundary || boundary.type !== "Polygon") {
        return null;
    }

    try {
        const fieldPolygon = turf.polygon(boundary.coordinates);
        const totalAreaM2 = turf.area(fieldPolygon);

        if (totalAreaM2 === 0) return null;

        // If no tracks or empty tracks, the entire field is undetected
        if (!tracks || tracks.length === 0) {
            console.log("Coverage: No tracks, returning 100% gap");
            return {
                undetectionsGeoJSON: turf.featureCollection([fieldPolygon]),
                detectedAreaM2: 0,
                totalAreaM2,
                percentCovered: 0,
                percentUndetected: 100
            };
        }

        // 1. Combine all tracks into a single MultiLineString or array of lines
        const trackFeatures = tracks
            .filter(t => t.points && t.points.length >= 2)
            .map(t => turf.lineString(t.points.map((p: any) => [p.lon, p.lat])));

        if (trackFeatures.length === 0) {
            console.log("Coverage: No valid track features, returning 100% gap");
            return {
                undetectionsGeoJSON: turf.featureCollection([fieldPolygon]),
                detectedAreaM2: 0,
                totalAreaM2,
                percentCovered: 0,
                percentUndetected: 100
            };
        }

        // 2. Buffer the tracks (the area detected)
        const bufferedTracks = trackFeatures
            .map(f => turf.buffer(f, coilWidthM / 1000, { units: "kilometers" }))
            .filter((f): f is any => !!f);
        
        // 3. Union all buffers into one big "Detected Area"
        let combinedDetected: any = null;
        if (bufferedTracks.length > 0) {
            combinedDetected = bufferedTracks.length === 1 
                ? bufferedTracks[0] 
                : turf.union(turf.featureCollection(bufferedTracks));
        }

        if (!combinedDetected) {
            return {
                undetectionsGeoJSON: turf.featureCollection([fieldPolygon]),
                detectedAreaM2: 0,
                totalAreaM2,
                percentCovered: 0,
                percentUndetected: 100
            };
        }

        // 4. Intersect with the field boundary
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

        // 5. Calculate "Undetected Area" (Field - Detected)
        const diff = turf.difference(turf.featureCollection([fieldPolygon, detectedInsideField]));

        let gaps: any[] = [];
        if (diff) {
            // Flatten MultiPolygons into individual Polygons for better rendering reliability
            const flattened = turf.flatten(diff);
            gaps = flattened.features;
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
