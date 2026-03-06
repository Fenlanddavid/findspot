import React, { useMemo, useState } from "react";

/**
 * A robust satellite/street snapshot component.
 * It uses a layered approach to ensure SOMETHING is always displayed.
 */
export function StaticMapPreview({ lat, lon, boundary, className = "" }: { lat?: number | null, lon?: number | null, boundary?: any, className?: string }) {
    const [hasError, setHasError] = useState(false);
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

    // SVG Projection Logic
    const svgPath = useMemo(() => {
        if (!isValid || !boundary || boundary.type !== "Polygon" || !boundary.coordinates?.[0]) return null;
        
        try {
            const coords = boundary.coordinates[0];
            const points = coords.map((p: [number, number]) => {
                const x = (lonToTileFloat(p[0], zoom) - tileX) * 256;
                const y = (latToTileFloat(p[1], zoom) - tileY) * 256;
                return `${x},${y}`;
            });
            return points.join(" ");
        } catch (e) {
            return null;
        }
    }, [boundary, tileX, tileY, zoom, isValid]);

    if (!isValid) {
        return (
            <div className={`flex items-center justify-center bg-gray-100 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 ${className}`}>
                <div className="text-[10px] font-bold opacity-20 uppercase tracking-tighter">No Location Set</div>
            </div>
        );
    }

    return (
        <div className={`relative overflow-hidden bg-gray-200 dark:bg-gray-900 shadow-inner group/map ${className}`}>
            {/* The Image */}
            <img 
                src={hasError ? fallbackUrl : satelliteUrl}
                className="w-full h-full object-cover transition-transform duration-700 group-hover/map:scale-110"
                alt="Field Preview"
                onError={() => setHasError(true)}
                loading="lazy"
            />
            
            {/* Boundary Overlay */}
            {svgPath && (
                <svg 
                    viewBox="0 0 256 256" 
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    preserveAspectRatio="xMidYMid slice"
                >
                    <polygon 
                        points={svgPath} 
                        fill="rgba(16, 185, 129, 0.25)" 
                        stroke="#10b981" 
                        strokeWidth="3" 
                        strokeDasharray="6,3"
                    />
                </svg>
            )}

            {/* Simple Marker if no boundary */}
            {!svgPath && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-6 h-6 border-2 border-emerald-500/40 rounded-full animate-pulse flex items-center justify-center">
                        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                    </div>
                </div>
            )}

            <div className="absolute bottom-1 right-1 bg-black/50 backdrop-blur-sm text-[6px] text-white px-1 rounded font-black uppercase tracking-widest opacity-50">
                {hasError ? "OSM" : "ESRI"}
            </div>
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
