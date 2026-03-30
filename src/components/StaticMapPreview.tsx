import React, { useMemo, useState } from "react";

/**
 * A robust satellite/street snapshot component.
 * It uses a layered approach to ensure SOMETHING is always displayed.
 */
export function StaticMapPreview({ lat, lon, boundary, tracks, className = "" }: { lat?: number | null, lon?: number | null, boundary?: any, tracks?: any[], className?: string }) {
    const [errorCount, setErrorCount] = useState(0);
    const zoom = 15;

    // Guard: If no coordinates, show a placeholder
    const isValid = typeof lat === "number" && typeof lon === "number" && lat !== 0 && lon !== 0;

    const tileX = useMemo(() => isValid ? Math.floor(lonToTileFloat(lon!, zoom)) : 0, [lon, isValid, zoom]);
    const tileY = useMemo(() => isValid ? Math.floor(latToTileFloat(lat!, zoom)) : 0, [lat, isValid, zoom]);

    // Primary: Esri Satellite. Secondary: OpenStreetMap (via Error handling)
    const satelliteUrl = isValid 
        ? `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${tileY}/${tileX}`
        : "";
    
    const fallbackUrl = isValid
        ? `https://a.tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png`
        : "";

    // SVG Projection Logic for Boundary
    const svgPath = useMemo(() => {
        if (!isValid || !boundary || (boundary.type !== "Polygon" && boundary.type !== "MultiPolygon")) return null;
        
        try {
            // Handle both Polygon and MultiPolygon
            const polygons = boundary.type === "Polygon" ? [boundary.coordinates] : boundary.coordinates;
            
            return polygons.map((poly: any) => {
                const coords = poly[0]; // Exterior ring
                return coords.map((p: [number, number]) => {
                    const x = (lonToTileFloat(p[0], zoom) - tileX) * 256;
                    const y = (latToTileFloat(p[1], zoom) - tileY) * 256;
                    return `${x},${y}`;
                }).join(" ");
            });
        } catch (e) {
            return null;
        }
    }, [boundary, tileX, tileY, zoom, isValid]);

    // SVG Projection Logic for Tracks
    const svgTracks = useMemo(() => {
        if (!isValid || !tracks || tracks.length === 0) return [];
        
        return tracks.map(t => {
            const points = (t.points || []).map((p: any) => {
                const x = (lonToTileFloat(p.lon, zoom) - tileX) * 256;
                const y = (latToTileFloat(p.lat, zoom) - tileY) * 256;
                return `${x},${y}`;
            }).join(" ");
            return { points, color: t.color || "#10b981" };
        }).filter(t => t.points.length > 0);
    }, [tracks, tileX, tileY, zoom, isValid]);

    if (!isValid) {
        return (
            <div className={`flex items-center justify-center bg-gray-100 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 ${className}`}>
                <div className="text-[10px] font-bold opacity-20 uppercase tracking-tighter">No Location Set</div>
            </div>
        );
    }

    return (
        <div className={`relative overflow-hidden bg-gray-200 dark:bg-gray-900 shadow-inner group/map ${className}`}>
            {/* The Image — falls back to OSM on first error, shows placeholder on second */}
            {errorCount < 2 ? (
                <img
                    src={errorCount === 0 ? satelliteUrl : fallbackUrl}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover/map:scale-110"
                    alt="Field Preview"
                    onError={() => setErrorCount(c => c + 1)}
                    loading="lazy"
                />
            ) : (
                <div className="w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800">
                    <span className="text-[10px] font-bold opacity-30 uppercase tracking-tighter">Map unavailable</span>
                </div>
            )}
            
            {/* SVG Overlay for Boundary and Tracks */}
            <svg 
                viewBox="0 0 256 256" 
                className="absolute inset-0 w-full h-full pointer-events-none"
                preserveAspectRatio="xMidYMid slice"
            >
                {/* Boundary */}
                {svgPath && svgPath.map((path: string, i: number) => (
                    <polygon 
                        key={`poly-${i}`}
                        points={path} 
                        fill="rgba(16, 185, 129, 0.25)" 
                        stroke="#10b981" 
                        strokeWidth="3" 
                        strokeDasharray="6,3"
                    />
                ))}

                {/* Tracks */}
                {svgTracks.map((t, i) => (
                    <polyline 
                        key={`track-${i}`}
                        points={t.points}
                        fill="none"
                        stroke={t.color}
                        strokeWidth="4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeOpacity="0.8"
                    />
                ))}
            </svg>

            {/* Simple Marker if no boundary or tracks */}
            {!svgPath && svgTracks.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-6 h-6 border-2 border-emerald-500/40 rounded-full animate-pulse flex items-center justify-center">
                        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                    </div>
                </div>
            )}

            {errorCount < 2 && (
                <div className="absolute bottom-1 right-1 bg-black/50 backdrop-blur-sm text-[6px] text-white px-1 rounded font-black uppercase tracking-widest opacity-50">
                    {errorCount === 0 ? "ESRI" : "OSM"}
                </div>
            )}
        </div>
    );
}

function lonToTileFloat(lon: number, zoom: number) {
    return (lon + 180) / 360 * Math.pow(2, zoom);
}

function latToTileFloat(lat: number, zoom: number) {
    const rad = lat * Math.PI / 180;
    return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, zoom);
}
