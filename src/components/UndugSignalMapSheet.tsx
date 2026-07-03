// ─── Undug Signal Map Sheet ────────────────────────────────────────────────────
// Full-screen OSM map overlay centred on an un-dug signal's location.
// Shows the user's live GPS position so they can navigate toward the signal.
// Tapping the (static) signal marker opens the detail sheet on top.

import React from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { UndugSignal } from '../db';
import { UndugSignalDetailSheet } from './UndugSignalLog';
import { cacheBackedTileUrl, ensureTileCacheProtocolRegistered } from '../utils/mapTileCache';

type Props = {
  signal: UndugSignal;
  onClose: () => void;
  onConvertToFind?: (signal: UndugSignal) => void;
};

// Inline SVG string for the signal marker (kebab-case SVG attributes).
const SIGNAL_MARKER_SVG = `<svg width="22" height="22" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M10 2.25c-2.42 0-4.4 1.9-4.4 4.25 0 3.15 3.35 6.35 4.05 6.98.2.18.5.18.7 0 .7-.63 4.05-3.83 4.05-6.98 0-2.35-1.98-4.25-4.4-4.25Z" stroke="white" stroke-width="1.6"/>
  <circle cx="10" cy="6.6" r="1.35" fill="white"/>
  <path d="M5.1 14.5c1.22.78 2.9 1.25 4.9 1.25s3.68-.47 4.9-1.25M7.65 12.85c.68.26 1.48.4 2.35.4s1.67-.14 2.35-.4" stroke="white" stroke-width="1.4" stroke-linecap="round"/>
</svg>`;

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDist(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

export function UndugSignalMapSheet({ signal, onClose, onConvertToFind }: Props) {
  const mapContainerRef  = React.useRef<HTMLDivElement>(null);
  const mapRef           = React.useRef<maplibregl.Map | null>(null);
  const signalMarkerRef  = React.useRef<maplibregl.Marker | null>(null);
  const userMarkerRef    = React.useRef<maplibregl.Marker | null>(null);
  const [ready, setReady]             = React.useState(false);
  const [showDetail, setShowDetail]   = React.useState(false);
  const [userPos, setUserPos]         = React.useState<{ lat: number; lng: number } | null>(null);

  // ── Initialise map ────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!mapContainerRef.current || signal.lat == null || signal.lng == null) return;

    ensureTileCacheProtocolRegistered();
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: [cacheBackedTileUrl('https://a.tile.openstreetmap.org/{z}/{x}/{y}.png')],
            tileSize: 256,
            maxzoom: 19,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [signal.lng, signal.lat],
      zoom: 17,
      attributionControl: false,
    });

    mapRef.current = map;

    map.once('load', () => {
      // Signal marker — stopPropagation prevents map re-centering on tap.
      const sigEl = document.createElement('div');
      sigEl.setAttribute('aria-label', 'Un-dug signal — tap to view details');
      sigEl.style.cssText = [
        'width:44px', 'height:44px', 'cursor:pointer',
        'display:flex', 'align-items:center', 'justify-content:center',
        'background:rgba(5,150,105,0.92)',
        'border-radius:50%',
        'border:3px solid white',
        'box-shadow:0 3px 12px rgba(0,0,0,0.40)',
      ].join(';');
      sigEl.innerHTML = SIGNAL_MARKER_SVG;
      sigEl.addEventListener('click', (e) => {
        e.stopPropagation();
        setShowDetail(true);
      });

      signalMarkerRef.current = new maplibregl.Marker({ element: sigEl, anchor: 'center' })
        .setLngLat([signal.lng!, signal.lat!])
        .addTo(map);

      setReady(true);
    });

    return () => {
      signalMarkerRef.current?.remove();
      signalMarkerRef.current = null;
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal.id]);

  // ── Watch GPS ─────────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!('geolocation' in navigator)) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // ── Add / update user location marker ────────────────────────────────────
  React.useEffect(() => {
    if (!mapRef.current || !ready || !userPos) return;

    if (!userMarkerRef.current) {
      const el = document.createElement('div');
      el.setAttribute('aria-label', 'Your location');
      el.style.cssText = [
        'width:18px', 'height:18px',
        'border-radius:50%',
        'background:#3b82f6',
        'border:2.5px solid white',
        'box-shadow:0 2px 8px rgba(59,130,246,0.55)',
      ].join(';');

      userMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([userPos.lng, userPos.lat])
        .addTo(mapRef.current);
    } else {
      userMarkerRef.current.setLngLat([userPos.lng, userPos.lat]);
    }
  }, [userPos, ready]);

  const distToSignal =
    userPos != null && signal.lat != null && signal.lng != null
      ? haversineM(userPos.lat, userPos.lng, signal.lat, signal.lng)
      : null;

  return (
    <>
      {/* ── Full-screen map overlay ── */}
      <div className="fixed inset-0 z-[115] bg-black">
        {/* Map canvas */}
        <div ref={mapContainerRef} className="absolute inset-0" />

        {/* Back button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Back"
          className="absolute left-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-black/60 text-white shadow-lg backdrop-blur-sm"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M11 4L6 9l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Title pill */}
        <div className="absolute left-16 top-4 z-10 flex items-center gap-2 rounded-full border border-white/20 bg-black/60 px-3 py-2 text-xs font-black uppercase tracking-widest text-white shadow-lg backdrop-blur-sm">
          <div className="h-2 w-2 rounded-full bg-emerald-400" />
          Signal location
        </div>

        {/* Distance readout */}
        {distToSignal != null && (
          <div className="absolute bottom-10 left-1/2 z-10 -translate-x-1/2 flex items-center gap-2 rounded-full border border-white/20 bg-black/70 px-4 py-2 text-xs font-black text-white shadow-lg backdrop-blur-sm pointer-events-none">
            <div className="h-2 w-2 rounded-full bg-blue-400" />
            <span>{formatDist(distToSignal)} to signal</span>
          </div>
        )}

        {/* Tap hint — only when no GPS yet */}
        {ready && !showDetail && distToSignal == null && (
          <div className="pointer-events-none absolute bottom-10 left-1/2 z-10 -translate-x-1/2 rounded-full border border-white/20 bg-black/60 px-4 py-2 text-xs font-bold text-white/90 shadow-lg backdrop-blur-sm">
            Tap the marker to view signal details
          </div>
        )}
      </div>

      {/* ── Detail sheet rendered above the map ── */}
      {showDetail && (
        <UndugSignalDetailSheet
          signal={signal}
          onClose={() => setShowDetail(false)}
          onConvertToFind={
            onConvertToFind
              ? (s) => {
                  setShowDetail(false);
                  onClose();
                  onConvertToFind(s);
                }
              : undefined
          }
          onShowOnMap={() => setShowDetail(false)}
        />
      )}
    </>
  );
}
