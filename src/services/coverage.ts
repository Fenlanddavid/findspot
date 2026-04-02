import * as turf from "@turf/turf";

export interface CoverageResult {
    undetectionsGeoJSON: any; // FeatureCollection of polygons representing gaps
    detectedAreaM2: number;
    totalAreaM2: number;
    percentCovered: number;
    percentUndetected: number;
}

/**
 * Filters out points that represent micro-movements (e.g. < 2m)
 */
function filterMicroMovements(points: any[], thresholdM: number = 2.0): any[] {
    if (points.length < 2) return points;
    
    const filtered = [points[0]];
    let lastPoint = points[0];
    
    for (let i = 1; i < points.length; i++) {
        const dist = turf.distance(
            turf.point([lastPoint.lon, lastPoint.lat]),
            turf.point([points[i].lon, points[i].lat]),
            { units: "meters" }
        );
        
        if (dist >= thresholdM) {
            filtered.push(points[i]);
            lastPoint = points[i];
        }
    }
    return filtered;
}

/**
 * Smooths track points using a moving average window
 */
function smoothTrack(points: any[], windowSize: number = 5): any[] {
    if (points.length < windowSize) return points;
    
    const smoothed = [];
    for (let i = 0; i < points.length; i++) {
        const start = Math.max(0, i - Math.floor(windowSize / 2));
        const end = Math.min(points.length - 1, i + Math.floor(windowSize / 2));
        
        let sumLat = 0;
        let sumLon = 0;
        let count = 0;
        for (let j = start; j <= end; j++) {
            sumLat += points[j].lat;
            sumLon += points[j].lon;
            count++;
        }
        smoothed.push({ 
            ...points[i],
            lat: sumLat / count, 
            lon: sumLon / count 
        });
    }
    return smoothed;
}

/**
 * Calculates coverage for a permission based on tracks.
 * @param boundary GeoJSON Polygon of the field
 * @param tracks Array of tracks (each with lat/lon points)
 * @param coilWidthM Width of the detector coverage in meters (default 1.5m / ~5ft swing)
 */
export function calculateCoverage(boundary: any, tracks: any[], coilWidthM: number = 1.5): CoverageResult | null {
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
            ? (turf.union(unkinked) ?? unkinked.features[0])
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

        // 3. Buffer Tracks (Aggressive Cleaning & Smoothing)
        // Use a 0.75m radius for a 1.5m realistic swing width
        const bufferRadiusM = coilWidthM / 2;
        
        const bufferedSegments = validTracks.map(t => {
            // Apply smoothing and movement filtering
            let processedPoints = filterMicroMovements(t.points, 2.0);
            processedPoints = smoothTrack(processedPoints, 5);
            
            if (processedPoints.length < 2) return null;

            const line = turf.lineString(processedPoints.map((p: any) => [p.lon, p.lat]));
            // Moderate simplification for cleaner geometry
            const simplified = turf.simplify(line, { tolerance: 0.000005, highQuality: true });
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
        let combinedDetected: any = bufferedSegments.length === 1
            ? bufferedSegments[0]
            : (turf.union(turf.featureCollection(bufferedSegments as any)) ?? bufferedSegments[0]);

        if (!combinedDetected) return null;
        combinedDetected = turf.rewind(combinedDetected);

        // 4. Find Intersection (Actual coverage within boundary)
        const detectedInsideField: any = turf.intersect(turf.featureCollection([fieldPolygon, combinedDetected]));

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

        // 5. Calculate Gaps (Field - Detected Area)
        const diff: any = turf.difference(turf.featureCollection([fieldPolygon, detectedInsideField]));

        let gaps: any[] = [];
        if (diff) {
            const flattened = turf.flatten(diff);
            // FILTER: Remove gaps smaller than 2.5m² (False Gaps)
            gaps = flattened.features.filter(gap => turf.area(gap) > 2.5);
            
            // Visual Cleanup: Simplify gap polygons slightly
            gaps = gaps.map(gap => turf.simplify(gap, { tolerance: 0.000005, highQuality: true }));
        } else {
            gaps = []; // 100% covered
        }

        // Final Percentages based on cleaned geometry
        const effectiveDetectedArea = totalAreaM2 - turf.area(turf.featureCollection(gaps));
        const percentCovered = (effectiveDetectedArea / totalAreaM2) * 100;

        return {
            undetectionsGeoJSON: turf.featureCollection(gaps),
            detectedAreaM2: effectiveDetectedArea,
            totalAreaM2,
            percentCovered: Math.min(100, percentCovered),
            percentUndetected: Math.max(0, 100 - percentCovered)
        };

    } catch (error) {
        console.error("Coverage calculation error:", error);
        return null;
    }
}
