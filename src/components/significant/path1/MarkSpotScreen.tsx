import React from "react";
import { WorkflowState } from "../../../types/significantFind";
import { captureGPS, toOSGridRef } from "../../../services/gps";
import { detectJurisdiction } from "../../../utils/jurisdictionDetect";
import { db } from "../../../db";
import { fileToBlob } from "../../../services/photos";
import { v4 as uuid } from "uuid";

type Props = {
  workflowState: WorkflowState;
  updateState: (patch: Partial<WorkflowState>) => void;
  onNext: () => void;
  onClose: () => void;
};

export default function MarkSpotScreen({ workflowState, updateState, onNext }: Props) {
  const [gpsState, setGpsState] = React.useState<"idle" | "capturing" | "captured" | "error">(
    workflowState.lat != null ? "captured" : "idle"
  );
  const [accuracy, setAccuracy] = React.useState<number | null>(workflowState.gpsAccuracyM);
  const [lat, setLat] = React.useState<number | null>(workflowState.lat);
  const [lon, setLon] = React.useState<number | null>(workflowState.lon);
  const [osGridRef, setOsGridRef] = React.useState(workflowState.osGridRef);
  const [w3w, setW3w] = React.useState(workflowState.w3w);
  const [photoSaved, setPhotoSaved] = React.useState(false);
  const [gpsError, setGpsError] = React.useState<string | null>(null);
  const watchRef = React.useRef<number | null>(null);

  // Live accuracy polling
  React.useEffect(() => {
    if (gpsState !== "capturing") return;
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const acc = Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null;
        setAccuracy(acc);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 0 }
    );
    return () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, [gpsState]);

  async function captureLocation() {
    setGpsState("capturing");
    setGpsError(null);
    try {
      const fix = await captureGPS();
      const gridRef = toOSGridRef(fix.lat, fix.lon);
      const jurisdiction = detectJurisdiction(fix.lat, fix.lon);
      setLat(fix.lat);
      setLon(fix.lon);
      setAccuracy(fix.accuracyM);
      setOsGridRef(gridRef);
      setGpsState("captured");
      updateState({
        lat: fix.lat,
        lon: fix.lon,
        gpsAccuracyM: fix.accuracyM,
        osGridRef: gridRef,
        jurisdiction,
      });
      // Update the in-progress DB record
      if (workflowState.significantFindId) {
        await db.significantFinds.update(workflowState.significantFindId, {
          lat: fix.lat,
          lon: fix.lon,
          gpsAccuracyM: fix.accuracyM,
          osGridRef: gridRef,
          jurisdiction,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (e: any) {
      setGpsError(e.message || "GPS capture failed");
      setGpsState("error");
    }
  }

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.currentTarget.value = "";
    if (!file || !workflowState.significantFindId) return;
    try {
      const blob = await fileToBlob(file);
      await db.media.add({
        id: uuid(),
        projectId: workflowState.projectId,
        findId: workflowState.significantFindId,
        type: "photo",
        photoType: "other",
        filename: file.name,
        mime: file.type || "image/jpeg",
        blob,
        caption: "Landmark photo",
        scalePresent: false,
        createdAt: new Date().toISOString(),
      });
      setPhotoSaved(true);
    } catch {}
  }

  function handleW3wChange(v: string) {
    setW3w(v);
    updateState({ w3w: v });
  }

  async function persistW3w() {
    if (!workflowState.significantFindId) return;
    await db.significantFinds.update(workflowState.significantFindId, {
      w3w,
      updatedAt: new Date().toISOString(),
    });
  }

  async function handleContinue() {
    await persistW3w();
    onNext();
  }

  const canContinue = gpsState === "captured";

  const accuracyLabel =
    accuracy == null
      ? null
      : accuracy <= 5
      ? { text: `±${Math.round(accuracy)}m — excellent`, cls: "text-emerald-600 dark:text-emerald-400" }
      : accuracy <= 15
      ? { text: `±${Math.round(accuracy)}m — good`, cls: "text-emerald-500 dark:text-emerald-400" }
      : accuracy <= 40
      ? { text: `±${Math.round(accuracy)}m — fair`, cls: "text-amber-500 dark:text-amber-400" }
      : { text: `±${Math.round(accuracy)}m — weak — move to open ground`, cls: "text-red-500 dark:text-red-400" };

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <div className="text-4xl mb-2">📍</div>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
          Lock your GPS position precisely. This is the location professional archaeologists will use when they arrive.
        </p>
      </div>

      {/* GPS capture */}
      <div className="bg-gray-50 dark:bg-gray-900 rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-gray-700 dark:text-gray-300">GPS Location</span>
          {gpsState === "captured" && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">✓ Locked</span>
          )}
          {gpsState === "capturing" && (
            <span className="text-xs text-amber-500 animate-pulse font-semibold">Capturing…</span>
          )}
        </div>

        {gpsState === "idle" || gpsState === "error" ? (
          <button
            onClick={captureLocation}
            className="bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-black uppercase tracking-widest py-3 rounded-xl text-sm transition-all"
          >
            Lock My Position
          </button>
        ) : gpsState === "capturing" ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="animate-spin w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full" />
              <span className="text-sm text-gray-600 dark:text-gray-400">Acquiring GPS…</span>
            </div>
            {accuracyLabel && (
              <span className={`text-xs font-semibold ${accuracyLabel.cls}`}>{accuracyLabel.text}</span>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="font-mono text-sm text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 border border-gray-200 dark:border-gray-700">
              {osGridRef || `${lat?.toFixed(6)}, ${lon?.toFixed(6)}`}
            </div>
            {accuracyLabel && (
              <span className={`text-xs font-semibold ${accuracyLabel.cls}`}>{accuracyLabel.text}</span>
            )}
            <button
              onClick={captureLocation}
              className="text-xs text-amber-600 dark:text-amber-400 hover:underline mt-1 text-left"
            >
              Re-capture for better accuracy
            </button>
          </div>
        )}

        {gpsError && (
          <p className="text-xs text-red-600 dark:text-red-400">{gpsError}</p>
        )}
      </div>

      {/* W3W */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-bold text-gray-700 dark:text-gray-300">
          What3Words address <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={w3w}
            onChange={e => handleW3wChange(e.target.value)}
            onBlur={persistW3w}
            placeholder="e.g. filled.count.soap"
            className="flex-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
          {lat != null && lon != null && (
            <a
              href={`https://what3words.com/map?coords=${lat},${lon}`}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-all"
            >
              Open w3w
            </a>
          )}
        </div>
        <p className="text-xs text-gray-400">Open w3w.co to find the three-word address, then paste it here.</p>
      </div>

      {/* Landmark photo */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-bold text-gray-700 dark:text-gray-300">
          Landmark photo <span className="font-normal text-gray-400">(optional but helpful)</span>
        </label>
        <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
          photoSaved
            ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700"
            : "bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 hover:border-amber-400"
        }`}>
          <span className="text-xl">{photoSaved ? "✓" : "📸"}</span>
          <span className="text-sm text-gray-700 dark:text-gray-300">
            {photoSaved ? "Photo saved" : "Photograph the surroundings from this spot"}
          </span>
          <input type="file" accept="image/*" capture="environment" onChange={handlePhoto} className="hidden" />
        </label>
        <p className="text-xs text-gray-400">A wide shot showing nearby features, trees, field edges, or structures — anything that helps locate this spot later.</p>
      </div>

      <button
        onClick={handleContinue}
        disabled={!canContinue}
        className="w-full bg-amber-600 hover:bg-amber-700 active:scale-95 disabled:opacity-40 text-white font-black uppercase tracking-widest py-4 rounded-2xl text-sm transition-all"
      >
        Location recorded — continue
      </button>
    </div>
  );
}
