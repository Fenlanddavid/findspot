import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, Media, Find } from "../db";
import { v4 as uuid } from "uuid";
import { fileToBlob } from "../services/photos";
import { captureGPS, toOSGridRef } from "../services/gps";
import { getSetting } from "../services/data";
import { ScaledImage } from "../components/ScaledImage";

const periods: Find["period"][] = [
  "Prehistoric", "Bronze Age", "Iron Age", "Celtic", "Roman", "Anglo-Saxon", "Early Medieval", "Medieval", "Post-medieval", "Modern", "Unknown",
];
const materials: Find["material"][] = [
  "Gold", "Silver", "Copper alloy", "Lead", "Iron", "Tin", "Pewter", "Pottery", "Flint", "Stone", "Glass", "Bone", "Other",
];
const completenesses: Find["completeness"][] = ["Complete", "Incomplete", "Fragment"];

function makeFindCode(): string {
  const year = new Date().getFullYear();
  const rand = Math.floor(Math.random() * 900000) + 100000;
  return `FS-${year}-${rand}`;
}

export default function FindPage(props: { projectId: string; permissionId: string | null; sessionId: string | null }) {
  const navigate = useNavigate();
  const permissions = useLiveQuery(
    async () => db.permissions.where("projectId").equals(props.projectId).reverse().sortBy("createdAt"),
    [props.projectId]
  );

  const [locationName, setLocationName] = useState("");
  const [findCode, setFindCode] = useState(makeFindCode());
  const [objectType, setObjectType] = useState("");
  const [coinType, setCoinType] = useState("");
  const [coinDenomination, setCoinDenomination] = useState("");

  const [lat, setLat] = useState<number | null>(null);
  const [lon, setLon] = useState<number | null>(null);
  const [acc, setAcc] = useState<number | null>(null);
  const [osGridRef, setOsGridRef] = useState("");
  const [w3w, setW3w] = useState("");

  const [period, setPeriod] = useState<Find["period"]>("Roman");
  const [material, setMaterial] = useState<Find["material"]>("Copper alloy");
  const [weightG, setWeightG] = useState<string>("");
  const [widthMm, setWidthMm] = useState<string>("");
  const [heightMm, setHeightMm] = useState<string>("");
  const [depthMm, setDepthMm] = useState<string>("");
  const [decoration, setDecoration] = useState("");
  const [completeness, setCompleteness] = useState<Find["completeness"]>("Complete");
  const [findContext, setFindContext] = useState("");
  const [storageLocation, setStorageLocation] = useState("");
  const [notes, setNotes] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (props.permissionId) {
      db.permissions.get(props.permissionId).then(l => {
        if (l) setLocationName(l.name);
      });
    } else if (permissions && permissions.length > 0 && !locationName) {
      setLocationName(permissions[0].name || "");
    }
  }, [props.permissionId, permissions]);

  const media = useLiveQuery(
    async () => (savedId ? db.media.where("findId").equals(savedId).toArray() : []),
    [savedId]
  );

  async function doGPS() {
    setError(null);
    try {
      const fix = await captureGPS();
      setLat(fix.lat);
      setLon(fix.lon);
      setAcc(fix.accuracyM);
      const grid = toOSGridRef(fix.lat, fix.lon);
      if (grid) setOsGridRef(grid);
    } catch (e: any) {
      setError(e?.message ?? "GPS failed");
    }
  }

  function resetForm() {
    setSavedId(null);
    setFindCode(makeFindCode());
    setObjectType("");
    setCoinType("");
    setCoinDenomination("");
    setLat(null);
    setLon(null);
    setAcc(null);
    setOsGridRef("");
    setW3w("");
    setPeriod("Roman");
    setMaterial("Copper alloy");
    setWeightG("");
    setWidthMm("");
    setHeightMm("");
    setDepthMm("");
    setDecoration("");
    setCompleteness("Complete");
    setFindContext("");
    setNotes("");
    setError(null);
  }

  async function saveFind() {
    setError(null);
    setSaving(true);
    try {
      if (!locationName.trim()) throw new Error("Enter a location name first.");
      
      const trimmedName = locationName.trim();
      let targetPermissionId = "";
      
      // Find or create permission
      const existing = await db.permissions
        .where("projectId")
        .equals(props.projectId)
        .filter(l => l.name === trimmedName)
        .first();

      if (existing) {
        targetPermissionId = existing.id;
      } else {
        targetPermissionId = uuid();
        const now = new Date().toISOString();
        const defaultDetectorist = await getSetting("detectorist", "");
        await db.permissions.add({
          id: targetPermissionId,
          projectId: props.projectId,
          name: trimmedName,
          type: "individual",
          lat: null,
          lon: null,
          gpsAccuracyM: null,
          collector: defaultDetectorist,
          landType: "other",
          permissionGranted: false,
          notes: "Automatically created via Club/Rally Dig",
          createdAt: now,
          updatedAt: now,
        });
      }

      const id = uuid();
      const now = new Date().toISOString();

      const s: Find = {
        id,
        projectId: props.projectId,
        permissionId: targetPermissionId,
        sessionId: props.sessionId,
        findCode: findCode.trim() || makeFindCode(),
        objectType: objectType.trim(),
        coinType: coinType.trim(),
        coinDenomination: coinDenomination.trim(),
        lat,
        lon,
        gpsAccuracyM: acc,
        osGridRef,
        w3w,
        period,
        material,
        weightG: weightG ? parseFloat(weightG) : null,
        widthMm: widthMm ? parseFloat(widthMm) : null,
        heightMm: heightMm ? parseFloat(heightMm) : null,
        depthMm: depthMm ? parseFloat(depthMm) : null,
        decoration: decoration.trim(),
        completeness,
        findContext: findContext.trim(),
        storageLocation: storageLocation.trim(),
        notes: notes.trim(),
        createdAt: now,
        updatedAt: now,
      };

      await db.finds.add(s);
      setSavedId(id);
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function addPhotos(files: FileList | null, photoType?: Media["photoType"]) {
    setError(null);
    try {
      if (!savedId) throw new Error("Save the find first, then add photos.");
      if (!files || files.length === 0) return;

      const now = new Date().toISOString();
      const items: Media[] = [];

      for (const f of Array.from(files)) {
        const blob = await fileToBlob(f);
        items.push({
          id: uuid(),
          projectId: props.projectId,
          findId: savedId,
          type: "photo",
          photoType: photoType || "other",
          filename: f.name,
          mime: f.type || "application/octet-stream",
          blob,
          caption: "",
          scalePresent: false,
          createdAt: now,
        });
      }

      await db.media.bulkAdd(items);
    } catch (e: any) {
      setError(e?.message ?? "Photo add failed");
    }
  }

  function PhotoThumb(props: { mediaId: string; filename: string; photoType?: string }) {
     const [media, setMedia] = useState<Media | null>(null);
     
     useEffect(() => {
        let active = true;
        db.media.get(props.mediaId).then(m => {
            if (active && m) {
                setMedia(m);
            }
        });
        return () => { active = false; };
     }, [props.mediaId]);

     if (!media) return <div className="w-full h-32 bg-gray-100 dark:bg-gray-700 animate-pulse rounded-lg" />;
     
     return (
        <div className="relative group border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden aspect-square">
           <ScaledImage 
              media={media} 
              imgClassName="object-cover" 
              className="w-full h-full" 
           />
           <div className="bg-white/90 dark:bg-gray-900/90 p-1 text-[10px] truncate absolute bottom-0 inset-x-0 z-10 flex justify-between items-center">
             <span>{props.filename}</span>
             {media.photoType && (
               <span className={`px-1 rounded uppercase text-[8px] font-bold ${media.photoType === 'in-situ' ? 'bg-amber-100 text-amber-800' : media.photoType === 'cleaned' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>
                 {media.photoType}
               </span>
             )}
           </div>
        </div>
     );
  }

  return (
    <div className="grid gap-6 max-w-4xl mx-auto pb-10">
      <div className="flex justify-between items-center px-1">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">
          {props.permissionId ? "Add Find" : "Club/Rally Dig"}
        </h2>
        <div className="flex gap-3">
            <button 
                onClick={() => navigate("/finds")}
                className="bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 px-4 py-2 rounded-xl font-bold shadow-sm transition-all"
            >
                View All Finds
            </button>
            {savedId && (
                <button 
                    onClick={resetForm}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl font-bold shadow-md transition-all"
                >
                    + Record Another Find
                </button>
            )}
        </div>
      </div>

      {error && <div className="border-2 border-red-200 bg-red-50 text-red-800 p-4 rounded-xl shadow-sm">{error}</div>}

      <div className="grid lg:grid-cols-2 gap-6">
          <div className={`bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-sm grid gap-5 h-fit transition-opacity ${savedId ? 'opacity-50 pointer-events-none' : ''}`}>
            <label className="block">
            <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Location Name / Permission</div>
            <input 
                value={locationName} 
                onChange={(e) => setLocationName(e.target.value)}
                placeholder="Enter permission or location name"
                className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow font-bold"
            />
            </label>

            <div className="grid grid-cols-2 gap-4">
            <label className="block">
                <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Find Code</div>
                <input 
                    value={findCode} 
                    onChange={(e) => setFindCode(e.target.value)} 
                    className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow font-mono text-sm"
                />
            </label>

            <label className="block">
                <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Completeness</div>
                <select 
                    value={completeness} 
                    onChange={(e) => setCompleteness(e.target.value as any)}
                    className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                >
                {completenesses.map((c) => (
                    <option key={c} value={c}>{c}</option>
                ))}
                </select>
            </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block">
                    <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Object Type / Identification</div>
                    <input 
                        value={objectType} 
                        onChange={(e) => setObjectType(e.target.value)} 
                        placeholder="e.g., Coin, Buckle, Brooch" 
                        className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                    />
                </label>

                {(objectType.toLowerCase().includes("coin") || coinType) && (
                    <div className="grid grid-cols-1 gap-5 p-4 bg-emerald-50/30 dark:bg-emerald-900/10 rounded-2xl border border-emerald-100 dark:border-emerald-900/30 animate-in slide-in-from-left-2">
                        <label className="block">
                            <div className="mb-1.5 text-sm font-bold text-emerald-600 dark:text-emerald-400">Coin Classification</div>
                            <select 
                                value={coinType} 
                                onChange={(e) => setCoinType(e.target.value)}
                                className="w-full bg-white dark:bg-gray-900 border-2 border-emerald-100 dark:border-emerald-900 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                            >
                                <option value="">(Select)</option>
                                <option value="Hammered">Hammered</option>
                                <option value="Milled">Milled</option>
                                <option value="Token">Token / Jetton</option>
                                <option value="Other">Other</option>
                            </select>
                        </label>
                        <label className="block">
                            <div className="mb-1.5 text-sm font-bold text-emerald-600 dark:text-emerald-400">Denomination</div>
                            <input 
                                list="denominations"
                                value={coinDenomination} 
                                onChange={(e) => setCoinDenomination(e.target.value)} 
                                placeholder="e.g., Stater, Penny, Shilling" 
                                className="w-full bg-white dark:bg-gray-900 border-2 border-emerald-100 dark:border-emerald-900 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                            />
                            <datalist id="denominations">
                                <option value="Stater" />
                                <option value="Quarter Stater" />
                                <option value="Unit" />
                                <option value="Minim" />
                                <option value="Denarius" />
                                <option value="Antoninianus" />
                                <option value="Sestertius" />
                                <option value="Dupondius" />
                                <option value="As" />
                                <option value="Follis" />
                                <option value="Sceat" />
                                <option value="Penny" />
                                <option value="Halfpenny" />
                                <option value="Farthing" />
                                <option value="Groat" />
                                <option value="Half Groat" />
                                <option value="Threepence" />
                                <option value="Sixpence" />
                                <option value="Shilling" />
                                <option value="Florin" />
                                <option value="Halfcrown" />
                                <option value="Crown" />
                                <option value="Sovereign" />
                                <option value="Guinea" />
                                <option value="Noble" />
                                <option value="Ryal" />
                                <option value="Jetton" />
                            </datalist>
                        </label>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-2 gap-4">
            <label className="block">
                <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Period</div>
                <select 
                    value={period} 
                    onChange={(e) => setPeriod(e.target.value as any)}
                    className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                >
                {periods.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
            </label>

            <label className="block">
                <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Material</div>
                <select 
                    value={material} 
                    onChange={(e) => setMaterial(e.target.value as any)}
                    className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                >
                {materials.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
            </label>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <label className="block">
                    <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Weight (g)</div>
                    <input 
                        type="number"
                        value={weightG} 
                        onChange={(e) => setWeightG(e.target.value)} 
                        placeholder="0.00"
                        className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                    />
                </label>
                <label className="block">
                    <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Width (mm)</div>
                    <input 
                        type="number"
                        value={widthMm} 
                        onChange={(e) => setWidthMm(e.target.value)} 
                        placeholder="0.0"
                        className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                    />
                </label>
            </div>

            <label className="block">
                <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Decoration / Description</div>
                <input 
                    value={decoration} 
                    onChange={(e) => setDecoration(e.target.value)} 
                    placeholder="e.g., Zoomorphic, enamelled" 
                    className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                />
            </label>

            <div className="bg-gray-50/50 dark:bg-gray-900/30 p-5 rounded-2xl border-2 border-gray-100 dark:border-gray-700/50 grid gap-4">
                <div className="flex justify-between items-center">
                    <h3 className="text-sm font-black uppercase tracking-widest text-gray-400">Findspot Location</h3>
                    <button 
                        type="button"
                        onClick={doGPS}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 rounded-lg text-xs font-bold shadow-md transition-all flex items-center gap-2"
                    >
                        📍 {lat ? "Update Spot" : "Capture Spot"}
                    </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <label className="block">
                        <div className="mb-1 text-[10px] font-bold uppercase opacity-60">OS Grid Ref</div>
                        <input 
                            value={osGridRef} 
                            onChange={(e) => setOsGridRef(e.target.value)} 
                            placeholder="e.g. TL 1234 5678"
                            className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-2 text-sm font-mono focus:ring-1 focus:ring-emerald-500 outline-none"
                        />
                    </label>
                    <label className="block">
                        <div className="mb-1 text-[10px] font-bold uppercase opacity-60">What3Words</div>
                        <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-red-500 font-bold text-xs">///</span>
                            <input 
                                value={w3w} 
                                onChange={(e) => setW3w(e.target.value)} 
                                placeholder="index.home.raft"
                                className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-2 pl-7 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                            />
                        </div>
                    </label>
                </div>

                {lat && lon && (
                    <div className="text-[10px] font-mono opacity-40 flex gap-3">
                        <span>LAT: {lat.toFixed(6)}</span>
                        <span>LON: {lon.toFixed(6)}</span>
                        {acc && <span>ACC: ±{Math.round(acc)}m</span>}
                    </div>
                )}
            </div>

            <label className="block">
            <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Notes</div>
            <textarea 
                value={notes} 
                onChange={(e) => setNotes(e.target.value)} 
                rows={3} 
                className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
            />
            </label>

            <button 
                onClick={saveFind} 
                disabled={saving || !locationName.trim()} 
                className={`mt-2 w-full px-6 py-4 rounded-xl font-bold text-lg shadow-md transition-all transform active:scale-95 disabled:opacity-50 disabled:transform-none ${savedId ? "bg-green-600 text-white" : "bg-emerald-600 hover:bg-emerald-700 text-white"}`}
            >
            {saving ? "Saving..." : savedId ? "Find Saved ✓" : "Save Find"}
            </button>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-sm flex flex-col gap-4 h-fit sticky top-4">
            <div className="flex flex-col gap-4 mb-2">
                <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 m-0">Photos</h2>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className={`px-3 py-3 rounded-xl font-bold text-sm shadow-md transition-all cursor-pointer flex flex-col items-center justify-center gap-1 text-center ${!savedId ? "bg-gray-100 text-gray-400 cursor-not-allowed opacity-50" : "bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 hover:bg-amber-100"}`}>
                       <span className="text-xl">🕳️</span>
                       <span>In-Situ Photo</span>
                       <input type="file" accept="image/*" capture="environment" onChange={(e) => addPhotos(e.target.files, "in-situ")} disabled={!savedId} className="hidden" />
                    </label>
                    
                    <label className={`px-3 py-3 rounded-xl font-bold text-sm shadow-md transition-all cursor-pointer flex flex-col items-center justify-center gap-1 text-center ${!savedId ? "bg-gray-100 text-gray-400 cursor-not-allowed opacity-50" : "bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 hover:bg-blue-100"}`}>
                       <span className="text-xl">🧼</span>
                       <span>Cleaned Photo</span>
                       <input type="file" accept="image/*" capture="environment" onChange={(e) => addPhotos(e.target.files, "cleaned")} disabled={!savedId} className="hidden" />
                    </label>
                </div>
                
                <div className="flex gap-2">
                    <label className={`flex-1 px-3 py-2 rounded-lg font-bold text-xs shadow-sm transition-colors cursor-pointer flex items-center justify-center gap-1 ${!savedId ? "bg-gray-100 text-gray-400 cursor-not-allowed" : "bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 text-gray-700 dark:text-gray-200"}`}>
                       📁 Upload Files
                       <input type="file" accept="image/*" multiple onChange={(e) => addPhotos(e.target.files)} disabled={!savedId} className="hidden" />
                    </label>
                </div>
            </div>

            {!savedId && <div className="text-center py-12 opacity-40 italic text-sm border-2 border-dashed border-gray-100 dark:border-gray-700 rounded-2xl">Save the record first to attach photos.</div>}

            {media && media.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                    {media.map(m => <PhotoThumb key={m.id} mediaId={m.id} filename={m.filename} />)}
                </div>
            )}
        </div>
      </div>
    </div>
  );
}
