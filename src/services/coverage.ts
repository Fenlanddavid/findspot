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
        const fieldPolygon = boundary.type === "Polygon" 
            ? turf.polygon(boundary.coordinates) 
            : turf.multiPolygon(boundary.coordinates);
            
        const totalAreaM2 = turf.area(fieldPolygon);

        if (totalAreaM2 === 0) return null;

        // 1. Combine all valid track points into a single MultiLineString
        const validTrackPaths = tracks
            .filter(t => t.points && t.points.length >= 2)
            .map(t => t.points.map((p: any) => [p.lon, p.lat]));

        if (validTrackPaths.length === 0) {
            return {
                undetectionsGeoJSON: turf.featureCollection([fieldPolygon as any]),
                detectedAreaM2: 0,
                totalAreaM2,
                percentCovered: 0,
                percentUndetected: 100
            };
        }

        // 2. Create a single MultiLineString and buffer it
        // This is MUCH faster and more stable than unioning individual buffers
        const trackLines = turf.multiLineString(validTrackPaths);
        const combinedDetected = turf.buffer(trackLines, coilWidthM / 1000, { units: "kilometers" });

        if (!combinedDetected) {
            return {
                undetectionsGeoJSON: turf.featureCollection([fieldPolygon as any]),
                detectedAreaM2: 0,
                totalAreaM2,
                percentCovered: 0,
                percentUndetected: 100
            };
        }

        // 3. Calculate "Undetected Area" (Field - Tracks)
        // We subtract the detected area from the original field to get the gaps
        const diff = turf.difference(turf.featureCollection([fieldPolygon, combinedDetected]));

        let gaps: any[] = [];
        let gapAreaM2 = totalAreaM2;

        if (diff) {
            // Flatten MultiPolygons into individual Polygons for better rendering reliability
            const flattened = turf.flatten(diff);
            gaps = flattened.features;
            gapAreaM2 = turf.area(diff);
        } else {
            // If diff is null, it means the entire field was covered
            gaps = [];
            gapAreaM2 = 0;
        }

        const detectedAreaM2 = Math.max(0, totalAreaM2 - gapAreaM2);
        const percentCovered = (detectedAreaM2 / totalAreaM2) * 100;

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
