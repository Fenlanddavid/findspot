import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { captureGPS } from "../services/gps";
import { v4 as uuid } from "uuid";
import { fileToBlob } from "../services/photos";

export default function GlobalActions({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [isCapturing, setIsCapturing] = React.useState(false);
  const [showSuccess, setShowSuccess] = React.useState(false);
  const [lastQuickId, setLastQuickId] = React.useState<string | null>(null);
  const [noGpsWarning, setNoGpsWarning] = React.useState(false);
  const [fabError, setFabError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  
  const activeSession = useLiveQuery(
    () => db.sessions.where("isFinished").equals(0).reverse().sortBy("updatedAt").then(sessions => sessions[0]),
    []
  );

  const pendingCount = useLiveQuery(
    () => db.finds.where("isPending").equals(1).count(),
    []
  );

  // Hide on certain pages
  const hideOn = ["/settings", "/finds-box", "/fieldguide"];
  if (hideOn.includes(location.pathname)) return null;
  if (location.pathname.startsWith("/find")) return null; // Already on find page

  async function quickFind() {
    if (isCapturing) return;
    setIsCapturing(true);
    setFabError(null);
    setNoGpsWarning(false);

    // Provide immediate haptic feedback
    if (navigator.vibrate) navigator.vibrate(50);

    const id = uuid();
    const now = new Date().toISOString();

    // Attempt to get GPS silently
    let lat = null, lon = null, acc = null;
    try {
        const fix = await captureGPS();
        lat = fix.lat;
        lon = fix.lon;
        acc = fix.accuracyM;
    } catch(e) {
        setNoGpsWarning(true);
    }

    // Default to last permission
    const lastPerm = await db.permissions.where("projectId").equals(projectId).reverse().sortBy("createdAt").then(arr => arr[0]);

    if (!lastPerm) {
        setIsCapturing(false);
        setFabError("Add a permission first before using Quick Find.");
        return;
    }

    await db.finds.add({
        id,
        projectId,
        permissionId: lastPerm.id,
        sessionId: activeSession?.id || null,
        fieldId: activeSession?.fieldId || null,
        findCode: `QUICK-${Date.now().toString().slice(-6)}`,
        objectType: "Pending Quick Find",
        lat,
        lon,
        gpsAccuracyM: acc,
        osGridRef: "",
        w3w: "",
        period: "Unknown",
        material: "Other",
        weightG: null,
        widthMm: null,
        heightMm: null,
        depthMm: null,
        decoration: "",
        completeness: "Complete",
        findContext: "",
        storageLocation: "",
        notes: "Quick recorded via FAB",
        isPending: true,
        createdAt: now,
        updatedAt: now,
    });

    setIsCapturing(false);
    setLastQuickId(id);
    setShowSuccess(true);
    
    // Auto-hide success message after 10 seconds if no action taken
    setTimeout(() => setShowSuccess(false), 10000);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !lastQuickId) return;

    try {
        const blob = await fileToBlob(file);
        const now = new Date().toISOString();
        await db.media.add({
            id: uuid(),
            projectId,
            findId: lastQuickId,
            type: "photo",
            photoType: "in-situ",
            filename: file.name,
            mime: file.type || "application/octet-stream",
            blob,
            caption: "Quick Capture",
            scalePresent: false,
            createdAt: now,
        });
        setShowSuccess(false);
        if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
    } catch(err) {
        setFabError("Failed to save photo: " + err);
    } finally {
        setLastQuickId(null);
    }
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3 pointer-events-none">
      {fabError && (
        <div className="pointer-events-auto bg-red-900/95 backdrop-blur-md text-white p-3 rounded-2xl shadow-2xl flex items-center justify-between gap-3 border border-red-500/50 min-w-[200px]">
          <span className="text-[10px]">{fabError}</span>
          <button onClick={() => setFabError(null)} className="opacity-60 hover:opacity-100 text-xs shrink-0">✕</button>
        </div>
      )}
      {showSuccess && (
          <div className="pointer-events-auto bg-gray-900/95 backdrop-blur-md text-white p-4 rounded-3xl shadow-2xl flex flex-col gap-3 animate-in slide-in-from-right-4 border border-emerald-500/50 mb-2 min-w-[200px]">
              <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center text-[10px] font-black">✓</div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Recorded</span>
                  </div>
                  <button onClick={() => setShowSuccess(false)} className="opacity-40 hover:opacity-100 text-xs">✕</button>
              </div>
              {noGpsWarning && (
                <div className="text-[9px] text-amber-400 flex items-center gap-1.5 bg-amber-900/30 px-2 py-1 rounded-lg">
                  ⚠️ No GPS — open the find to add a location
                </div>
              )}
              <div className="flex gap-2">
                  <label className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest cursor-pointer shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2">
                      📸 Take Photo
                      <input type="file" accept="image/*" capture="environment" onChange={handleFileChange} className="hidden" />
                  </label>
                  <button
                    onClick={() => setShowSuccess(false)}
                    className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all"
                  >
                    Done
                  </button>
              </div>
              <button
                onClick={async () => {
                  if (!lastQuickId) return;
                  await db.finds.delete(lastQuickId);
                  setLastQuickId(null);
                  setShowSuccess(false);
                }}
                className="text-[9px] text-red-400 hover:text-red-300 opacity-60 hover:opacity-100 text-center transition-all"
              >
                Undo — delete this find
              </button>
          </div>
      )}

      {!!pendingCount && pendingCount > 0 && (
         <button 
            onClick={() => navigate("/finds?filter=pending")}
            className="pointer-events-auto bg-amber-500 text-white px-4 py-2 rounded-full font-black text-[10px] shadow-lg border-2 border-white animate-bounce uppercase tracking-widest"
         >
            {pendingCount} Pending Finds
         </button>
      )}

      <div className="flex gap-3 pointer-events-auto">
        <button 
            onClick={quickFind}
            disabled={isCapturing}
            className={`bg-gradient-to-br ${isCapturing ? 'from-gray-400 to-gray-600 animate-pulse' : 'from-emerald-500 to-emerald-700'} text-white w-12 h-12 rounded-full shadow-lg hover:shadow-emerald-500/20 active:scale-95 transition-all flex items-center justify-center group relative border border-white/20`}
            aria-label="Quick Add Find"
        >
            {isCapturing ? (
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
            )}
            <span className="absolute bottom-full mb-3 right-0 bg-gray-900 text-white text-[10px] px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap font-bold uppercase tracking-widest shadow-xl">
                {isCapturing ? "Locating..." : "Quick Record"}
            </span>
        </button>
      </div>
    </div>
  );
}
