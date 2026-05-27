import React from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { WorkflowState } from "../../../types/significantFind";
import { captureGPS, toOSGridRef } from "../../../services/gps";
import { db, Find } from "../../../db";
import { fileToBlob } from "../../../services/photos";
import { v4 as uuid } from "uuid";
import { detectJurisdiction } from "../../../utils/jurisdictionDetect";

type Props = {
  workflowState: WorkflowState;
  updateState: (patch: Partial<WorkflowState>) => void;
  onNext: () => void;
  onClose: () => void;
  onSwitchToInsitu: () => void;
};

type ScatterPoint = {
  findId: string;
  lat: number;
  lon: number;
  label: string;
  marker?: maplibregl.Marker;
};

export default function ScatterRecordingScreen({ workflowState, updateState, onNext, onSwitchToInsitu }: Props) {
  const mapContainerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const pointsRef = React.useRef<ScatterPoint[]>([]);
  const scatterIdRef = React.useRef<string>(workflowState.scatterId ?? uuid());
  const mapLoadedRef = React.useRef(false);
  const tileErrorCountRef = React.useRef(0);
  const tileErrorResetRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mapReady, setMapReady] = React.useState(false);
  const [mapIssue, setMapIssue] = React.useState(false);
  const [loadedScatterId, setLoadedScatterId] = React.useState<string | null>(null);

  const [isCapturing, setIsCapturing] = React.useState(false);
  const [captureError, setCaptureError] = React.useState<string | null>(null);
  const [showConcentrationAlert, setShowConcentrationAlert] = React.useState(false);
  const [activePointIdx, setActivePointIdx] = React.useState<number | null>(null);
  const [pointCount, setPointCount] = React.useState(workflowState.scatterFindIds.length);
  const [objectType, setObjectType] = React.useState("");
  const [photoSavedForIdx, setPhotoSavedForIdx] = React.useState<number | null>(null);
  const [photoError, setPhotoError] = React.useState<string | null>(null);
  const [depthCm, setDepthCm] = React.useState("");
  const [pointsSnapshot, setPointsSnapshot] = React.useState<ScatterPoint[]>([]);

  // Initialise scatterId on first render
  React.useEffect(() => {
    if (!workflowState.scatterId) {
      updateState({ scatterId: scatterIdRef.current });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Init map
  React.useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const center: [number, number] = workflowState.lon != null && workflowState.lat != null
      ? [workflowState.lon, workflowState.lat]
      : [-2, 54];

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: {
          version: 8,
          sources: {
            "osm": {
              type: "raster",
              tiles: ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: "© OpenStreetMap",
            },
          },
          layers: [{ id: "osm-tiles", type: "raster", source: "osm", minzoom: 0, maxzoom: 22 }],
        },
        center,
        zoom: 17,
      });
    } catch (e) {
      console.error("Scatter map init failed:", e);
      setMapIssue(true);
      return;
    }
    const registerTileError = () => {
      tileErrorCountRef.current += 1;
      if (tileErrorResetRef.current) clearTimeout(tileErrorResetRef.current);
      tileErrorResetRef.current = setTimeout(() => {
        tileErrorCountRef.current = 0;
      }, 6000);
      if (tileErrorCountRef.current >= 4) setMapIssue(true);
    };

    map.on("error", (event) => {
      const error = (event as any).error;
      const status = Number(error?.status);
      const message = String(error?.message ?? "");
      const isTileOrNetworkError = Number.isFinite(status) || /tile|resource|fetch|network/i.test(message);
      if (isTileOrNetworkError) {
        registerTileError();
        return;
      }
      setMapIssue(true);
    });
    map.on("load", () => {
      mapLoadedRef.current = true;
      tileErrorCountRef.current = 0;
      setMapIssue(false);
    });
    map.on("sourcedata", (event) => {
      if (event.sourceId === "osm" && event.isSourceLoaded && mapLoadedRef.current) {
        tileErrorCountRef.current = 0;
        setMapIssue(false);
      }
    });
    mapRef.current = map;
    setMapReady(true);
    return () => {
      if (tileErrorResetRef.current) clearTimeout(tileErrorResetRef.current);
      mapLoadedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function setRenderedPoints(points: ScatterPoint[]) {
    setPointsSnapshot(points.map(({ findId, lat, lon, label }) => ({ findId, lat, lon, label })));
  }

  function checkConcentration(points: ScatterPoint[]) {
    if (points.length < 3) return;
    // Check if any 3+ points are within 5m of each other using haversine
    for (let i = 0; i < points.length; i++) {
      let nearCount = 0;
      for (let j = 0; j < points.length; j++) {
        if (i === j) continue;
        const dlat = (points[j].lat - points[i].lat) * 111320;
        const dlon = (points[j].lon - points[i].lon) * 111320 * Math.cos(points[i].lat * Math.PI / 180);
        const dist = Math.sqrt(dlat * dlat + dlon * dlon);
        if (dist <= 5) nearCount++;
      }
      if (nearCount >= 2) { setShowConcentrationAlert(true); return; }
    }
  }

  function addMarkerToMap(point: ScatterPoint, index: number) {
    const map = mapRef.current;
    if (!map) return;
    const el = document.createElement("div");
    el.style.cssText = `
      width: 28px; height: 28px; border-radius: 50%;
      background: #f59e0b; border: 2px solid white;
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 900; color: white;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4); cursor: pointer;
    `;
    el.textContent = String(index + 1);
    el.onclick = () => setActivePointIdx(index);
    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([point.lon, point.lat])
      .addTo(map);
    point.marker = marker;
  }

  function fitMapToPoints(points: ScatterPoint[]) {
    const map = mapRef.current;
    if (!map || points.length === 0) return;
    if (points.length === 1) {
      map.flyTo({ center: [points[0].lon, points[0].lat], zoom: 17, duration: 0 });
      return;
    }

    const bounds = new maplibregl.LngLatBounds();
    points.forEach(point => bounds.extend([point.lon, point.lat]));
    map.fitBounds(bounds, { padding: 48, maxZoom: 18, duration: 0 });
  }

  function replaceScatterPoints(points: ScatterPoint[]) {
    pointsRef.current.forEach(point => point.marker?.remove());
    pointsRef.current = points.map(point => ({ ...point, marker: undefined }));
    pointsRef.current.forEach((point, index) => addMarkerToMap(point, index));
    setRenderedPoints(pointsRef.current);
    setPointCount(pointsRef.current.length);
    setActivePointIdx(prev =>
      prev != null && prev < pointsRef.current.length
        ? prev
        : pointsRef.current.length > 0
        ? pointsRef.current.length - 1
        : null
    );
    fitMapToPoints(pointsRef.current);
    checkConcentration(pointsRef.current);
  }

  React.useEffect(() => {
    const scatterId = workflowState.scatterId ?? scatterIdRef.current;
    if ((!mapReady && !mapIssue) || loadedScatterId === scatterId) return;

    let cancelled = false;
    db.finds.where("scatterId").equals(scatterId).toArray()
      .then(finds => {
        if (cancelled) return;
        const points = finds
          .filter(f => f.lat != null && f.lon != null)
          .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""))
          .map((find, index): ScatterPoint => ({
            findId: find.id,
            lat: find.lat!,
            lon: find.lon!,
            label: String(index + 1),
          }));

        replaceScatterPoints(points);
        if (finds.length > 0 || !workflowState.scatterId) {
          updateState({
            scatterId,
            scatterFindIds: finds.map(f => f.id),
          });
        }
        setLoadedScatterId(scatterId);
      })
      .catch(err => {
        if (!cancelled) setCaptureError(err?.message || "Could not load existing scatter finds.");
      });

    return () => { cancelled = true; };
  }, [mapReady, mapIssue, loadedScatterId, workflowState.scatterId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function captureScatterPoint() {
    if (isCapturing) return;
    setIsCapturing(true);
    setCaptureError(null);
    try {
      if (!workflowState.permissionId) {
        throw new Error("No permission context found. Reopen the workflow from a permission or active session.");
      }
      const fix = await captureGPS();
      const osGridRef = toOSGridRef(fix.lat, fix.lon);
      const jurisdiction = detectJurisdiction(fix.lat, fix.lon);
      const now = new Date().toISOString();
      const findId = uuid();
      const scatterId = scatterIdRef.current;
      const index = pointsRef.current.length;

      const find: Find = {
        id: findId,
        projectId: workflowState.projectId,
        permissionId: workflowState.permissionId,
        fieldId: null,
        sessionId: workflowState.sessionId,
        findCode: `SCATTER-${(index + 1).toString().padStart(2, "0")}`,
        objectType: objectType || "Scatter find",
        lat: fix.lat,
        lon: fix.lon,
        gpsAccuracyM: fix.accuracyM,
        osGridRef,
        w3w: "",
        period: "Unknown",
        material: "Other",
        weightG: null,
        widthMm: null,
        heightMm: null,
        depthMm: null,
        depthCm: depthCm ? parseFloat(depthCm) : undefined,
        decoration: "",
        completeness: "Complete",
        findContext: "Scatter find — Map Scatter workflow",
        storageLocation: "",
        notes: "",
        isPending: false,
        scatterId,
        createdAt: now,
        updatedAt: now,
      };
      await db.finds.add(find);

      const point: ScatterPoint = { findId, lat: fix.lat, lon: fix.lon, label: String(index + 1) };
      pointsRef.current = [...pointsRef.current, point];
      addMarkerToMap(point, index);
      setRenderedPoints(pointsRef.current);

      const newFindIds = pointsRef.current.map(p => p.findId);
      updateState({
        scatterFindIds: newFindIds,
        scatterId,
        ...(workflowState.lat == null ? {
          lat: fix.lat,
          lon: fix.lon,
          gpsAccuracyM: fix.accuracyM,
          osGridRef,
          jurisdiction,
        } : {}),
      });
      setPointCount(newFindIds.length);
      setActivePointIdx(index);
      setObjectType("");
      setDepthCm("");

      // Pan map to new point
      mapRef.current?.flyTo({ center: [fix.lon, fix.lat], zoom: 17, duration: 800 });

      // Check concentration
      checkConcentration(pointsRef.current);
    } catch (e: any) {
      setCaptureError(e.message || "GPS failed");
    } finally {
      setIsCapturing(false);
    }
  }

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>, findId: string) {
    const file = e.target.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    setPhotoError(null);
    try {
      const blob = await fileToBlob(file);
      await db.media.add({
        id: uuid(),
        projectId: workflowState.projectId,
        findId,
        type: "photo",
        photoType: "in-situ",
        filename: file.name,
        mime: file.type || "image/jpeg",
        blob,
        caption: `Scatter find ${activePointIdx != null ? activePointIdx + 1 : ""}`,
        scalePresent: false,
        createdAt: new Date().toISOString(),
      });
      setPhotoSavedForIdx(activePointIdx);
      setTimeout(() => setPhotoSavedForIdx(null), 2500);
    } catch (err: any) {
      setPhotoError("Photo failed: " + (err?.message ?? "unknown error"));
    }
  }

  const activeFind = activePointIdx != null ? pointsRef.current[activePointIdx] : null;

  return (
    <div className="flex flex-col gap-0 -mx-4 -mt-4">
      {/* Map */}
      <div className="w-full h-[45vh] relative bg-gray-100 dark:bg-gray-900">
        <div ref={mapContainerRef} className="w-full h-full" />
        {mapIssue && (
          <div className="absolute inset-x-4 bottom-4 rounded-xl border border-amber-300 bg-amber-50/95 p-3 text-xs text-amber-900 shadow-lg dark:border-amber-700 dark:bg-amber-950/90 dark:text-amber-100">
            <p className="font-black uppercase tracking-widest">Map tiles unavailable</p>
            <p className="mt-1 leading-relaxed">Keep adding GPS points. The numbered list below is saved and the map will fill in when tiles load.</p>
          </div>
        )}
      </div>

      {/* Concentration alert */}
      {showConcentrationAlert && (
        <div className="mx-4 mt-3 bg-red-50 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-xl p-3 flex items-start gap-3">
          <span className="text-xl shrink-0">⚠️</span>
          <div className="flex-1">
            <p className="text-xs font-bold text-red-800 dark:text-red-300">Several finds are very close together</p>
            <p className="text-xs text-red-700 dark:text-red-400 mt-1">Is there any chance of undisturbed material below? If so, stop here.</p>
          </div>
          <button
            onClick={onSwitchToInsitu}
            className="shrink-0 text-xs font-bold text-red-700 dark:text-red-400 underline"
          >
            Switch
          </button>
        </div>
      )}

      <div className="px-4 pt-4 pb-4 flex flex-col gap-4">
        {/* Counter */}
        <div className="flex items-center justify-between">
          <div>
            <span className="text-2xl font-black text-gray-900 dark:text-gray-100">{pointCount}</span>
            <span className="text-sm text-gray-500 ml-2">find{pointCount !== 1 ? "s" : ""} logged</span>
          </div>
          {pointCount > 0 && (
            <button
              onClick={onNext}
              className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-black uppercase tracking-widest px-4 py-2 rounded-xl transition-all active:scale-95"
            >
              Done — complete scatter
            </button>
          )}
        </div>

        {pointsSnapshot.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-900">
            <p className="px-1 pb-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400">Saved GPS points</p>
            <div className="grid gap-1.5">
              {pointsSnapshot.map((point, index) => (
                <button
                  key={point.findId}
                  type="button"
                  onClick={() => setActivePointIdx(index)}
                  className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs ${
                    activePointIdx === index
                      ? "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                      : "bg-white text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                  }`}
                >
                  <span className="font-black">#{index + 1}</span>
                  <span className="font-mono">{point.lat.toFixed(5)}, {point.lon.toFixed(5)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Per-find quick fields */}
        <div className="flex gap-2">
          <input
            type="text"
            value={objectType}
            onChange={e => setObjectType(e.target.value)}
            placeholder="Object type (e.g. Roman coin)"
            className="flex-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
          <input
            type="number"
            value={depthCm}
            onChange={e => setDepthCm(e.target.value)}
            placeholder="cm"
            className="w-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
        </div>

        {/* Add point button */}
        <button
          onClick={captureScatterPoint}
          disabled={isCapturing}
          className="w-full bg-amber-600 hover:bg-amber-700 active:scale-95 disabled:opacity-60 text-white font-black uppercase tracking-widest py-4 rounded-2xl text-sm transition-all flex items-center justify-center gap-2"
        >
          {isCapturing ? (
            <>
              <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              Getting GPS…
            </>
          ) : (
            <>📍 Add find at my position</>
          )}
        </button>

        {captureError && (
          <p className="text-xs text-red-500">{captureError}</p>
        )}

        {/* Active point photo */}
        {activeFind && (
          <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-3 flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Find #{(activePointIdx ?? 0) + 1}
            </span>
            {photoSavedForIdx === activePointIdx ? (
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">✓ Photo saved</span>
            ) : (
              <label className="flex items-center gap-2 text-xs font-bold text-amber-600 dark:text-amber-400 cursor-pointer">
                📸 Add photo
                <input type="file" accept="image/*" capture="environment" onChange={e => handlePhoto(e, activeFind.findId)} className="hidden" />
              </label>
            )}
          </div>
        )}
        {photoError && (
          <p className="text-xs text-red-500 px-1">{photoError}</p>
        )}
      </div>
    </div>
  );
}
