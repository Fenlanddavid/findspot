import React, { useEffect, useState, useMemo } from "react";
import { db, Permission, Session, Find, Media, Track } from "../db";
import { v4 as uuid } from "uuid";
import { captureGPS } from "../services/gps";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { FindRow } from "../components/FindRow";
import { FindModal } from "../components/FindModal";
import { startTracking, stopTracking, isTrackingActive, getCurrentTrackId } from "../services/tracking";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const DEFAULT_CENTER: [number, number] = [-2.0, 54.5];
const DEFAULT_ZOOM = 13;

export default function SessionPage(props: {
  projectId: string;
}) {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const permissionId = searchParams.get("permissionId");
  const nav = useNavigate();
  const isEdit = !!id;

  const [date, setDate] = useState(new Date().toISOString().slice(0, 16));
  const [lat, setLat] = useState<number | null>(null);
  const [lon, setLon] = useState<number | null>(null);
  const [acc, setAcc] = useState<number | null>(null);

  const [landUse, setLandUse] = useState("");
  const [cropType, setCropType] = useState("");
  const [isStubble, setIsStubble] = useState(false);
  const [notes, setNotes] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  
  const [openFindId, setOpenFindId] = useState<string | null>(null);
  
  const [isTracking, setIsTracking] = useState(isTrackingActive());

  const permission = useLiveQuery(
    async () => (permissionId ? db.permissions.get(permissionId) : (id ? db.sessions.get(id).then(s => s ? db.permissions.get(s.permissionId) : null) : null)),
    [permissionId, id]
  );

  const finds = useLiveQuery(async () => {
    if (!id) return [];
    return db.finds.where("sessionId").equals(id).reverse().sortBy("createdAt");
  }, [id]);

  const allMedia = useLiveQuery(async () => {
    if (!id || !finds) return [];
    const ids = finds.map(s => s.id);
    return db.media.where("findId").anyOf(ids).toArray();
  }, [id, finds]);

  const tracks = useLiveQuery(async () => {
    if (!id) return [];
    return db.tracks.where("sessionId").equals(id).toArray();
  }, [id]);

  const findThumbMedia = useMemo(() => {
    const info = new Map<string, Media>();
    if (!allMedia || !finds) return info;
    const sortedMedia = [...allMedia].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const row of sortedMedia) {
      if (!info.has(row.findId)) info.set(row.findId, row);
    }
    return info;
  }, [allMedia, finds]);

  const mapDivRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!mapDivRef.current || !tracks || tracks.length === 0) return;

    if (!mapRef.current) {
      const map = new maplibregl.Map({
        container: mapDivRef.current,
        style: {
          version: 8,
          sources: {
            "raster-tiles": {
              type: "raster",
              tiles: ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: "© OpenStreetMap"
            }
          },
          layers: [{ id: "simple-tiles", type: "raster", source: "raster-tiles", minzoom: 0, maxzoom: 22 }]
        },
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
      });

      map.on("load", () => {
        map.addSource("tracks", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] }
        });

        map.addLayer({
          id: "tracks-line",
          type: "line",
          source: "tracks",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": ["get", "color"],
            "line-width": 4,
            "line-opacity": 0.8
          }
        });
      });
      mapRef.current = map;
    }

    const map = mapRef.current;
    if (map.isStyleLoaded()) {
      const source = map.getSource("tracks") as maplibregl.GeoJSONSource;
      if (source) {
        const geojson = {
          type: "FeatureCollection",
          features: tracks.map(t => ({
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: t.points.map(p => [p.lon, p.lat])
            },
            properties: { color: t.color }
          }))
        };
        source.setData(geojson as any);

        // Fit bounds
        const allPoints = tracks.flatMap(t => t.points);
        if (allPoints.length > 0) {
          const bounds = new maplibregl.LngLatBounds();
          allPoints.forEach(p => bounds.extend([p.lon, p.lat]));
          map.fitBounds(bounds, { padding: 40, duration: 1000 });
        }
      }
    }

    return () => {
      // Don't remove map on every update, just let it exist
    };
  }, [tracks]);

  useEffect(() => {
    if (id) {
      db.sessions.get(id).then(s => {
        if (s) {
          setDate(new Date(s.date).toISOString().slice(0, 16));
          setLat(s.lat);
          setLon(s.lon);
          setAcc(s.gpsAccuracyM);
          setLandUse(s.landUse);
          setCropType(s.cropType);
          setIsStubble(s.isStubble);
          setNotes(s.notes);
        }
        setLoading(false);
      });
    }
  }, [id]);

  async function doGPS() {
    setError(null);
    try {
      const fix = await captureGPS();
      setLat(fix.lat);
      setLon(fix.lon);
      setAcc(fix.accuracyM);
    } catch (e: any) {
      setError(e?.message ?? "GPS failed");
    }
  }

  async function save() {
    if (!permissionId && !isEdit) {
        setError("Missing permission ID");
        return;
    }
    setSaving(true);
    setError(null);
    try {
      const isoDate = new Date(date).toISOString();
      const now = new Date().toISOString();
      const finalId = id || uuid();

      const session: Session = {
        id: finalId,
        projectId: props.projectId,
        permissionId: isEdit ? (await db.sessions.get(id))!.permissionId : permissionId!,
        date: isoDate,
        lat,
        lon,
        gpsAccuracyM: acc,
        landUse,
        cropType,
        isStubble,
        notes,
        createdAt: isEdit ? undefined as any : now, 
        updatedAt: now,
      };

      if (isEdit) {
        await db.sessions.update(id, session);
        alert("Session updated!");
      } else {
        (session as any).createdAt = now;
        await db.sessions.add(session);
        nav(`/session/${finalId}`, { replace: true });
      }
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleTracking() {
    if (isTracking) {
        await stopTracking();
        setIsTracking(false);
    } else {
        await startTracking(props.projectId, id || null, permission?.name ? `Hunt @ ${permission.name}` : "New Hunt");
        setIsTracking(true);
    }
  }

  if (loading) return <div className="p-10 text-center opacity-50 font-medium">Loading session...</div>;

  return (
    <div className="max-w-4xl mx-auto pb-20">
      <div className="grid gap-8">
        <div className="flex justify-between items-center px-1">
            <div>
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">
                    {isEdit ? "Session Details" : "New Session"}
                </h2>
                {permission && (
                    <p className="text-emerald-600 font-bold text-sm">📍 {permission.name}</p>
                )}
            </div>
            <div className="flex gap-2">
                <button onClick={() => nav(permission ? `/permission/${permission.id}` : "/")} className="text-sm font-medium text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 bg-gray-50 dark:bg-gray-800 px-3 py-1 rounded-lg border border-gray-200 dark:border-gray-700 transition-colors">Back</button>
            </div>
        </div>

        {error && (
            <div className="border-2 border-red-200 bg-red-50 text-red-800 p-4 rounded-xl shadow-sm flex gap-3 items-center">
                <span className="text-xl">⚠️</span> {error}
            </div>
        )}

        <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-sm grid gap-6 h-fit">
                {tracks && tracks.length > 0 && (
                    <div className="bg-emerald-50/30 dark:bg-emerald-900/10 p-4 rounded-xl border border-emerald-100 dark:border-emerald-800/30">
                        <div className="flex justify-between items-center mb-2">
                            <h4 className="text-xs font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Recorded Trail Tracks</h4>
                            <div className="flex items-center gap-2">
                                {tracks.map(t => (
                                    <div key={t.id} className="flex items-center gap-2 bg-white dark:bg-gray-900 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[10px] font-bold">
                                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />
                                        <span>{t.points.length} pts</span>
                                        {t.isActive && <span className="ml-1 text-[8px] bg-red-600 text-white px-1 rounded animate-pulse">LIVE</span>}
                                    </div>
                                ))}
                            </div>
                        </div>
                        
                        {/* Map Preview */}
                        <div className="relative h-64 w-full rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 shadow-inner bg-gray-100 dark:bg-gray-900 mb-4">
                            <div ref={mapDivRef} className="absolute inset-0" />
                            {isTracking && (
                                <div className="absolute top-2 left-2 z-10 bg-red-600 text-white text-[8px] font-black px-2 py-1 rounded-full animate-pulse shadow-lg">
                                    RECORDING LIVE TRAIL...
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <label className="block">
                    <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Date & Time</div>
                    <input 
                        type="datetime-local" 
                        value={date} 
                        onChange={(e) => setDate(e.target.value)} 
                        className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium"
                    />
                </label>

                <div className="bg-emerald-50/50 dark:bg-emerald-900/20 p-5 rounded-2xl border-2 border-emerald-100/50 dark:border-emerald-800/30 flex flex-col sm:flex-row gap-4 items-center justify-between">
                    <div className="flex flex-col gap-1">
                        <div className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">GPS Location</div>
                        <div className="text-lg font-mono font-bold text-gray-800 dark:text-gray-100">
                            {lat && lon ? (
                            <div className="flex items-center gap-2">
                                {lat.toFixed(6)}, {lon.toFixed(6)}
                                {acc ? <span className="text-xs bg-emerald-600 text-white px-2 py-0.5 rounded-full">±{Math.round(acc)}m</span> : ""}
                            </div>
                            ) : (
                            <span className="opacity-40 italic">Coordinates not set</span>
                            )}
                        </div>
                    </div>
                    <button type="button" onClick={doGPS} className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl font-bold shadow-md flex items-center gap-2 whitespace-nowrap">
                        📍 {lat ? "Update GPS" : "Get Current GPS"}
                    </button>
                </div>

                <div className="flex flex-wrap gap-4 items-center bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
                    <div className="flex flex-col gap-2">
                        <div className="text-xs font-black uppercase tracking-widest opacity-50">Ground Condition</div>
                        <div className="flex flex-wrap gap-2">
                            <button 
                                type="button"
                                onClick={() => setIsStubble(!isStubble)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${isStubble ? 'bg-amber-100 border-amber-300 text-amber-800' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500'}`}
                            >
                                {isStubble ? '🌾 Stubble ✓' : '🌾 Stubble'}
                            </button>
                            <button 
                                type="button"
                                onClick={() => setLandUse(landUse === 'Ploughed' ? '' : 'Ploughed')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${landUse === 'Ploughed' ? 'bg-orange-100 border-orange-300 text-orange-800' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500'}`}
                            >
                                {landUse === 'Ploughed' ? '🚜 Ploughed ✓' : '🚜 Ploughed'}
                            </button>
                            <button 
                                type="button"
                                onClick={() => setLandUse(landUse === 'Pasture' ? '' : 'Pasture')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${landUse === 'Pasture' ? 'bg-emerald-100 border-emerald-300 text-emerald-800' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500'}`}
                            >
                                {landUse === 'Pasture' ? '🍃 Pasture ✓' : '🍃 Pasture'}
                            </button>
                        </div>
                    </div>

                    <div className="flex flex-col gap-2 ml-auto">
                        <div className="text-xs font-black uppercase tracking-widest opacity-50">Mapping</div>
                        <button 
                            type="button"
                            onClick={toggleTracking}
                            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg font-bold shadow-sm transition-all transform active:scale-95 text-xs ${isTracking ? 'bg-red-600 text-white animate-pulse' : 'bg-white dark:bg-gray-800 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700'}`}
                        >
                            <span>{isTracking ? '⏹️ Stop' : '👣 Map Session'}</span>
                        </button>
                    </div>
                </div>

                <label className="block">
                    <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Session Notes</div>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium" />
                </label>

                <button onClick={save} disabled={saving} className="mt-4 w-full bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-4 rounded-2xl font-black text-xl shadow-xl transition-all disabled:opacity-50">
                    {saving ? "Saving..." : isEdit ? "Save Session Details ✓" : "Start Session →"}
                </button>
            </div>

            <div className="bg-gray-50 dark:bg-gray-900/30 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-inner h-fit">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100 m-0">Finds</h3>
                    <div className="text-xs font-mono bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded font-bold">{finds?.length ?? 0} total</div>
                </div>

                {!isEdit && (
                    <div className="text-center py-10 opacity-50 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl italic text-sm">
                        Save this session first to start recording finds!
                    </div>
                )}

                {isEdit && (
                    <div className="grid gap-3">
                        <button 
                            onClick={() => nav(`/find?permissionId=${permission?.id}&sessionId=${id}`)}
                            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl font-bold shadow-md transition-all flex items-center justify-center gap-2 mb-2"
                        >
                            Add Find to Session
                        </button>

                        {finds && finds.length > 0 ? (
                            finds.map((s) => (
                                <FindRow 
                                    key={s.id} 
                                    find={s} 
                                    thumbMedia={findThumbMedia?.get(s.id) ?? null} 
                                    onOpen={() => setOpenFindId(s.id)} 
                                />
                            ))
                        ) : (
                            <div className="text-center py-10 opacity-50 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl italic text-sm">
                                No finds yet for this session.
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
      </div>
      {openFindId && <FindModal findId={openFindId} onClose={() => setOpenFindId(null)} />}
    </div>
  );
}
