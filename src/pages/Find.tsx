import React, { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, Media, Find } from "../db";
import { v4 as uuid } from "uuid";
import { fileToBlob } from "../services/photos";
import { captureGPS, toOSGridRef } from "../services/gps";
import { getSetting, setSetting } from "../services/data";
import { ScaledImage } from "../components/ScaledImage";
import { LocationPickerModal } from "../components/LocationPickerModal";

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

type FormState = {
  findCode: string;
  objectType: string;
  coinType: string;
  coinDenomination: string;
  ruler: string;
  lat: number | null;
  lon: number | null;
  acc: number | null;
  osGridRef: string;
  w3w: string;
  period: Find["period"];
  material: Find["material"];
  weightG: string;
  widthMm: string;
  heightMm: string;
  depthMm: string;
  decoration: string;
  completeness: Find["completeness"];
  findContext: string;
  detector: string;
  targetId: string;
  depthCm: string;
  dateRange: string;
  storageLocation: string;
  notes: string;
};

function makeInitialForm(initialLat?: number | null, initialLon?: number | null): FormState {
  return {
    findCode: makeFindCode(),
    objectType: "",
    coinType: "",
    coinDenomination: "",
    ruler: "",
    lat: initialLat ?? null,
    lon: initialLon ?? null,
    acc: null,
    osGridRef: (initialLat && initialLon) ? toOSGridRef(initialLat, initialLon) || "" : "",
    w3w: "",
    period: "Roman",
    material: "Copper alloy",
    weightG: "",
    widthMm: "",
    heightMm: "",
    depthMm: "",
    decoration: "",
    completeness: "Complete",
    findContext: "",
    detector: "",
    targetId: "",
    depthCm: "",
    dateRange: "",
    storageLocation: "",
    notes: "",
  };
}

export default function FindPage(props: {
  projectId: string;
  permissionId: string | null;
  sessionId: string | null;
  quickId: string | null;
  initialLat?: number | null;
  initialLon?: number | null
}) {
  const navigate = useNavigate();
  const [locationName, setLocationName] = useState("");
  const [fieldId, setFieldId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(props.sessionId);

  const permissions = useLiveQuery(
    async () => db.permissions.where("projectId").equals(props.projectId).reverse().sortBy("createdAt"),
    [props.projectId]
  );

  const session = useLiveQuery(
    async () => sessionId ? db.sessions.get(sessionId) : null,
    [sessionId]
  );

  // When session changes, lock to its field if it has one
  useEffect(() => {
    if (session?.fieldId) {
      setFieldId(session.fieldId);
    }
  }, [session]);

  const currentPermissionId = useMemo(() => {
    if (props.permissionId) return props.permissionId;
    return permissions?.find(p => p.name === locationName)?.id || null;
  }, [props.permissionId, permissions, locationName]);

  // Reset field/session if permission changes
  useEffect(() => {
    if (currentPermissionId) {
        if (session && session.permissionId !== currentPermissionId) {
            setSessionId(null);
            setFieldId(null);
        }
    }
  }, [currentPermissionId, session]);

  const fields = useLiveQuery(async () => {
    if (!currentPermissionId) return [];
    return db.fields.where("permissionId").equals(currentPermissionId).toArray();
  }, [currentPermissionId]);

  const availableSessions = useLiveQuery(async () => {
    if (!currentPermissionId) return [];
    return db.sessions.where("permissionId").equals(currentPermissionId).reverse().sortBy("date");
  }, [currentPermissionId]);

  const [form, setForm] = useState<FormState>(() => makeInitialForm(props.initialLat, props.initialLon));
  const [detectors, setDetectors] = useState<string[]>([]);
  const update = (patch: Partial<FormState>) => setForm(prev => ({ ...prev, ...patch }));

  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isPickingLocation, setIsPickingLocation] = useState(false);

  useEffect(() => {
    getSetting("detectors", []).then(setDetectors);
    getSetting("defaultDetector", "").then(d => {
      if (d) update({ detector: d as string });
    });
    getSetting("lastPeriod", "Roman").then(p => update({ period: p as Find["period"] }));
    getSetting("lastMaterial", "Copper alloy").then(m => update({ material: m as Find["material"] }));
  }, []);

  useEffect(() => {
    if (props.quickId) {
      db.finds.get(props.quickId).then(f => {
        if (f) {
          setSavedId(f.id);
          const grid = (f.lat && f.lon) ? toOSGridRef(f.lat, f.lon) || "" : "";
          update({
            findCode: f.findCode,
            objectType: f.objectType === "Pending Quick Find" ? "" : f.objectType,
            lat: f.lat,
            lon: f.lon,
            acc: f.gpsAccuracyM,
            osGridRef: grid,
            notes: f.notes,
          });
          if (f.permissionId) {
            db.permissions.get(f.permissionId).then(p => {
              if (p) setLocationName(p.name);
            });
          }
          if (f.sessionId) setSessionId(f.sessionId);
          if (f.fieldId) setFieldId(f.fieldId);
        }
      });
    }
  }, [props.quickId]);

  useEffect(() => {
    if (props.permissionId) {
      db.permissions.get(props.permissionId).then(l => {
        if (l) setLocationName(l.name);
      });
    } else if (permissions && permissions.length > 0 && !locationName && !props.quickId) {
      setLocationName(permissions[0].name || "");
    }
  }, [props.permissionId, permissions, props.quickId]);

  // Capture GPS automatically if missing and not editing
  useEffect(() => {
      if (!form.lat && !props.quickId && !savedId) {
          doGPS();
      }
  }, []);

  const media = useLiveQuery(
    async () => (savedId ? db.media.where("findId").equals(savedId).toArray() : []),
    [savedId]
  );

  async function doGPS() {
    setError(null);
    try {
      const fix = await captureGPS();
      const grid = toOSGridRef(fix.lat, fix.lon);
      update({ lat: fix.lat, lon: fix.lon, acc: fix.accuracyM, osGridRef: grid || form.osGridRef });
    } catch (e: any) {
      setError(e?.message ?? "GPS failed");
    }
  }

  function resetForm() {
    setSavedId(null);
    setForm({ ...makeInitialForm(), findCode: makeFindCode() });
    setError(null);
  }

  async function saveFind() {
    setError(null);
    setSaving(true);
    try {
      if (!locationName.trim()) throw new Error("Enter a location name first.");

      const trimmedName = locationName.trim();
      let targetPermissionId = "";

      const id = savedId || props.quickId || uuid();
      const isEditMode = !!(savedId || props.quickId);
      const now = new Date().toISOString();

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
        const defaultDetectorist = await getSetting("detectorist", "");
        await db.permissions.add({
          id: targetPermissionId,
          projectId: props.projectId,
          name: trimmedName,
          type: "individual",
          lat: null,
          lon: null,
          gpsAccuracyM: null,
          collector: defaultDetectorist as string,
          landType: "other",
          permissionGranted: false,
          notes: "Automatically created via Club/Rally Dig",
          createdAt: now,
          updatedAt: now,
        });
      }

      const s: Omit<Find, 'createdAt'> = {
        id,
        projectId: props.projectId,
        permissionId: targetPermissionId,
        fieldId,
        sessionId,
        findCode: form.findCode.trim() || makeFindCode(),
        objectType: form.objectType.trim(),
        coinType: form.coinType.trim(),
        coinDenomination: form.coinDenomination.trim(),
        ruler: form.ruler.trim(),
        lat: form.lat,
        lon: form.lon,
        gpsAccuracyM: form.acc,
        osGridRef: form.osGridRef,
        w3w: form.w3w.trim(),
        period: form.period,
        material: form.material,
        weightG: form.weightG ? parseFloat(form.weightG) : null,
        widthMm: form.widthMm ? parseFloat(form.widthMm) : null,
        heightMm: form.heightMm ? parseFloat(form.heightMm) : null,
        depthMm: form.depthMm ? parseFloat(form.depthMm) : null,
        detector: form.detector || undefined,
        targetId: form.targetId ? parseInt(form.targetId) : undefined,
        depthCm: form.depthCm ? parseFloat(form.depthCm) : undefined,
        decoration: form.decoration.trim(),
        completeness: form.completeness,
        findContext: form.findContext.trim(),
        dateRange: form.dateRange.trim() || undefined,
        storageLocation: form.storageLocation.trim(),
        notes: form.notes.trim(),
        isPending: false,
        updatedAt: now,
      };

      if (props.quickId || isEditMode) {
        await db.finds.update(id, s);
      } else {
        await db.finds.add({ ...s, createdAt: now });
      }

      // Sticky metadata
      setSetting("lastPeriod", form.period);
      setSetting("lastMaterial", form.material);
      if (form.detector) setSetting("defaultDetector", form.detector);

      // Haptic feedback
      if (navigator.vibrate) navigator.vibrate([50, 30, 50]);

      setSavedId(id);

      // If we were finishing a quick/pending find, go back home automatically
      if (props.quickId) {
          setTimeout(() => navigate("/"), 500);
      }
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
                 {media.photoType === 'in-situ' ? 'Photo 1' : media.photoType === 'cleaned' ? 'Photo 2' : media.photoType}
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
                <>
                    {sessionId && (
                        <button
                            onClick={() => navigate(`/session/${sessionId}`)}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl font-bold shadow-md transition-all flex items-center gap-2"
                        >
                            <span>←</span> Back to Session
                        </button>
                    )}
                    <button
                        onClick={resetForm}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl font-bold shadow-md transition-all"
                    >
                        + Record Another Find
                    </button>
                </>
            )}
        </div>
      </div>

      {error && <div className="border-2 border-red-200 bg-red-50 text-red-800 p-4 rounded-xl shadow-sm">{error}</div>}

      {props.quickId && (
          <div className="border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 p-4 rounded-xl flex items-center gap-3">
              <span className="text-xl">🟠</span>
              <div className="text-sm">
                  <span className="font-bold">Finish this quick find —</span> fill in the details below and hit Save to complete the record.
              </div>
          </div>
      )}

      {session?.isFinished && (
          <div className="border-2 border-gray-200 bg-gray-50 dark:bg-gray-800/50 dark:border-gray-700 text-gray-600 dark:text-gray-400 p-4 rounded-xl shadow-sm flex items-center gap-3">
              <span className="text-xl">🔒</span>
              <div className="text-sm">
                  <span className="font-bold">Closed Session:</span> You are adding a find to a session that was previously marked as finished.
              </div>
          </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
          <div className={`bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-sm grid gap-5 h-fit transition-opacity ${savedId && !props.quickId ? 'opacity-50 pointer-events-none' : ''}`}>
            <label className="block">
            <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Location Name / Permission</div>
            {props.quickId ? (
                <div className="relative">
                    <select
                        value={locationName}
                        onChange={(e) => setLocationName(e.target.value)}
                        className="w-full bg-white dark:bg-gray-900 border-2 border-emerald-500 dark:border-emerald-600 rounded-xl p-3 pr-10 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow font-bold appearance-none shadow-[0_0_10px_rgba(16,185,129,0.1)]"
                    >
                        <option value="">(Select Permission)</option>
                        {permissions?.map(p => (
                            <option key={p.id} value={p.name}>{p.name}</option>
                        ))}
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-emerald-600">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </div>
                </div>
            ) : (
                <input
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                    placeholder="Enter permission or location name"
                    className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow font-bold"
                />
            )}
            </label>

            <label className="block">
              <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300 flex justify-between">
                <span>Session / Visit</span>
                {props.sessionId && (
                    <span className="text-[10px] text-emerald-600 font-black uppercase tracking-widest">Locked to Session</span>
                )}
              </div>
              <select
                value={sessionId ?? ""}
                onChange={(e) => setSessionId(e.target.value || null)}
                disabled={!!props.sessionId}
                className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow font-medium disabled:opacity-50"
              >
                <option value="">(No specific session)</option>
                {availableSessions?.map(s => (
                  <option key={s.id} value={s.id}>
                      {new Date(s.date).toLocaleDateString()} {s.cropType ? `(${s.cropType})` : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300 flex justify-between">
                <span>Field / Area</span>
                {session?.fieldId && (
                  <span className="text-[10px] text-emerald-600 font-black uppercase tracking-widest">Locked to Session</span>
                )}
              </div>
              <select
                value={fieldId ?? ""}
                onChange={(e) => setFieldId(e.target.value || null)}
                disabled={!!session?.fieldId}
                className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow font-medium disabled:opacity-50"
              >
                <option value="">(No specific field)</option>
                {fields?.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-4">
            <label className="block">
                <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Find Code</div>
                <input
                    value={form.findCode}
                    onChange={(e) => update({ findCode: e.target.value })}
                    className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow font-mono text-sm"
                />
            </label>

            <label className="block">
                <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Completeness</div>
                <select
                    value={form.completeness}
                    onChange={(e) => update({ completeness: e.target.value as Find["completeness"] })}
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
                        value={form.objectType}
                        onChange={(e) => update({ objectType: e.target.value })}
                        placeholder="e.g., Coin, Buckle, Brooch"
                        className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                    />
                </label>

                {(form.objectType.toLowerCase().includes("coin") || form.coinType) && (
                    <div className="grid grid-cols-1 gap-5 p-4 bg-emerald-50/30 dark:bg-emerald-900/10 rounded-2xl border border-emerald-100 dark:border-emerald-900/30 animate-in slide-in-from-left-2">
                        <label className="block">
                            <div className="mb-1.5 text-sm font-bold text-emerald-600 dark:text-emerald-400">Coin Classification</div>
                            <select
                                value={form.coinType}
                                onChange={(e) => update({ coinType: e.target.value })}
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
                                value={form.coinDenomination}
                                onChange={(e) => update({ coinDenomination: e.target.value })}
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
                        <label className="block">
                            <div className="mb-1.5 text-sm font-bold text-emerald-600 dark:text-emerald-400">
                                {form.period === 'Celtic' ? 'Tribe / Ruler' :
                                 form.period === 'Roman' ? 'Emperor / Ruler' :
                                 'Ruler / Issuer'}
                            </div>
                            <input
                                value={form.ruler}
                                onChange={(e) => update({ ruler: e.target.value })}
                                placeholder={
                                    form.period === 'Celtic' ? 'e.g., Iceni, Trinovantes' :
                                    form.period === 'Roman' ? 'e.g., Hadrian, Constantine' :
                                    'e.g., Henry II, Elizabeth I'
                                }
                                className="w-full bg-white dark:bg-gray-900 border-2 border-emerald-100 dark:border-emerald-900 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                            />
                        </label>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-2 gap-4">
            <label className="block">
                <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Period</div>
                <select
                    value={form.period}
                    onChange={(e) => update({ period: e.target.value as Find["period"] })}
                    className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                >
                {periods.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
            </label>

            <label className="block">
                <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Material</div>
                <select
                    value={form.material}
                    onChange={(e) => update({ material: e.target.value as Find["material"] })}
                    className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                >
                {materials.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
            </label>
            </div>

            <label className="block">
                <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Date / Date Range</div>
                <input
                    value={form.dateRange}
                    onChange={(e) => update({ dateRange: e.target.value })}
                    placeholder="e.g. AD 60, 1300 BC, c.1350–1400, 43–410 AD"
                    className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                />
            </label>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <label className="block">
                    <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Weight (g)</div>
                    <input
                        type="number"
                        value={form.weightG}
                        onChange={(e) => update({ weightG: e.target.value })}
                        placeholder="0.00"
                        className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                    />
                </label>
                <label className="block">
                    <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Width (mm)</div>
                    <input
                        type="number"
                        step="0.1"
                        value={form.widthMm}
                        onChange={(e) => update({ widthMm: e.target.value })}
                        placeholder="0.0"
                        className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                    />
                </label>
                <label className="block">
                    <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Height (mm)</div>
                    <input
                        type="number"
                        step="0.1"
                        value={form.heightMm}
                        onChange={(e) => update({ heightMm: e.target.value })}
                        placeholder="0.0"
                        className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                    />
                </label>
                <label className="block">
                    <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Depth (mm)</div>
                    <input
                        type="number"
                        step="0.1"
                        value={form.depthMm}
                        onChange={(e) => update({ depthMm: e.target.value })}
                        placeholder="0.0"
                        className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                    />
                </label>
                </div>
            <label className="block">
                <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Decoration / Description</div>
                <input
                    value={form.decoration}
                    onChange={(e) => update({ decoration: e.target.value })}
                    placeholder="e.g., Zoomorphic, enamelled"
                    className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                />
            </label>

            <div className="bg-gray-50/50 dark:bg-gray-900/30 p-5 rounded-2xl border-2 border-gray-100 dark:border-gray-700/50 grid gap-4">
                <div className="flex justify-between items-center flex-wrap gap-2">
                    <h3 className="text-sm font-black uppercase tracking-widest text-gray-400">Findspot Location</h3>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => setIsPickingLocation(true)}
                            className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-all flex items-center gap-2 hover:bg-emerald-600 hover:text-white"
                        >
                            🗺️ Pick on Map
                        </button>
                        <button
                            type="button"
                            onClick={doGPS}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 rounded-lg text-xs font-bold shadow-md transition-all flex items-center gap-2"
                        >
                            📍 {form.lat ? "Update Spot" : "Capture Spot"}
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <label className="block">
                        <div className="mb-1 text-[10px] font-bold uppercase opacity-60">Latitude</div>
                        <input
                            type="number"
                            step="0.000001"
                            value={form.lat ?? ""}
                            onChange={(e) => {
                                const val = e.target.value ? parseFloat(e.target.value) : null;
                                const grid = (val !== null && form.lon !== null) ? toOSGridRef(val, form.lon) || form.osGridRef : form.osGridRef;
                                update({ lat: val, osGridRef: grid });
                            }}
                            placeholder="54.123456"
                            className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-2 text-sm font-mono focus:ring-1 focus:ring-emerald-500 outline-none"
                        />
                    </label>
                    <label className="block">
                        <div className="mb-1 text-[10px] font-bold uppercase opacity-60">Longitude</div>
                        <input
                            type="number"
                            step="0.000001"
                            value={form.lon ?? ""}
                            onChange={(e) => {
                                const val = e.target.value ? parseFloat(e.target.value) : null;
                                const grid = (val !== null && form.lat !== null) ? toOSGridRef(form.lat, val) || form.osGridRef : form.osGridRef;
                                update({ lon: val, osGridRef: grid });
                            }}
                            placeholder="-2.123456"
                            className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-2 text-sm font-mono focus:ring-1 focus:ring-emerald-500 outline-none"
                        />
                    </label>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <label className="block">
                        <div className="mb-1 text-[10px] font-bold uppercase opacity-60">OS Grid Ref</div>
                        <input
                            value={form.osGridRef}
                            onChange={(e) => update({ osGridRef: e.target.value })}
                            placeholder="e.g. TL 1234 5678"
                            className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-2 text-sm font-mono focus:ring-1 focus:ring-emerald-500 outline-none"
                        />
                    </label>
                    <label className="block">
                        <div className="mb-1 text-[10px] font-bold uppercase opacity-60">What3Words</div>
                        <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-red-500 font-bold text-xs">///</span>
                            <input
                                value={form.w3w}
                                onChange={(e) => update({ w3w: e.target.value })}
                                placeholder="index.home.raft"
                                className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-2 pl-7 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                            />
                        </div>
                    </label>
                </div>

                {form.lat && form.lon && (
                    <div className="text-[10px] font-mono opacity-40 flex gap-3 items-center">
                        <span>LAT: {form.lat.toFixed(6)}</span>
                        <span>LON: {form.lon.toFixed(6)}</span>
                        {form.acc != null && (
                          <span className={`px-1.5 py-0.5 rounded font-bold opacity-100 ${
                            form.acc <= 10 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" :
                            form.acc <= 30 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" :
                                             "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                          }`}>±{Math.round(form.acc)}m</span>
                        )}
                    </div>
                )}
            </div>

            <div className="bg-emerald-50/30 dark:bg-emerald-900/10 p-5 rounded-2xl border-2 border-emerald-100 dark:border-emerald-900/30 grid gap-4">
                <h3 className="text-sm font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Signal / Detector Information</h3>

                <label className="block">
                    <div className="mb-1 text-[10px] font-bold uppercase opacity-60">Detector Used</div>
                    <select
                        value={form.detector}
                        onChange={(e) => update({ detector: e.target.value })}
                        className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                    >
                        {detectors.length === 0 ? (
                            <option value="">(Set in Settings)</option>
                        ) : (
                            <>
                                <option value="">(Select Detector)</option>
                                {detectors.map(d => (
                                    <option key={d} value={d}>{d}</option>
                                ))}
                            </>
                        )}
                    </select>
                </label>

                <div className="grid grid-cols-2 gap-4">
                    <label className="block">
                        <div className="mb-1 text-[10px] font-bold uppercase opacity-60">Target ID</div>
                        <input
                            type="number"
                            value={form.targetId}
                            onChange={(e) => update({ targetId: e.target.value })}
                            placeholder="e.g. 13"
                            className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-2 text-sm font-mono focus:ring-1 focus:ring-emerald-500 outline-none"
                        />
                    </label>
                    <label className="block">
                        <div className="mb-1 text-[10px] font-bold uppercase opacity-60">Depth (cm)</div>
                        <input
                            type="number"
                            value={form.depthCm}
                            onChange={(e) => update({ depthCm: e.target.value })}
                            placeholder="e.g. 15"
                            className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-2 text-sm font-mono focus:ring-1 focus:ring-emerald-500 outline-none"
                        />
                    </label>
                </div>
            </div>

            <label className="block">
            <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Notes</div>
            <textarea
                value={form.notes}
                onChange={(e) => update({ notes: e.target.value })}
                rows={3}
                className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
            />
            </label>

            {form.acc !== null && form.acc > 15 && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-xl p-3 flex items-center gap-3 text-sm">
                <span className="text-amber-500 text-base shrink-0">⚠</span>
                <span className="text-amber-800 dark:text-amber-300">
                  <span className="font-bold">Low GPS accuracy (±{Math.round(form.acc)}m).</span> Move to open ground and tap <em>Update Spot</em> for a better fix before saving.
                </span>
              </div>
            )}

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
                <div className="flex justify-between items-center">
                    <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 m-0">Photos</h2>
                    {!savedId && (
                        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-2 py-1 rounded-lg flex items-center gap-1.5 animate-pulse shrink-0">
                            <span className="text-[10px]">ℹ️</span>
                            <span className="text-[8px] font-black text-amber-800 dark:text-amber-300 uppercase tracking-widest">
                                Save find first
                            </span>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className={`px-3 py-3 rounded-xl font-bold text-sm shadow-md transition-all cursor-pointer flex flex-col items-center justify-center gap-1 text-center ${!savedId ? "bg-gray-100 text-gray-400 cursor-not-allowed opacity-50" : "bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 hover:bg-amber-100"}`}>
                       <span className="text-xl">🕳️</span>
                       <span>Photo 1</span>
                       <input type="file" accept="image/*" capture="environment" onChange={(e) => addPhotos(e.target.files, "in-situ")} disabled={!savedId} className="hidden" />
                    </label>

                    <label className={`px-3 py-3 rounded-xl font-bold text-sm shadow-md transition-all cursor-pointer flex flex-col items-center justify-center gap-1 text-center ${!savedId ? "bg-gray-100 text-gray-400 cursor-not-allowed opacity-50" : "bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 hover:bg-blue-100"}`}>
                       <span className="text-xl">🧼</span>
                       <span>Photo 2</span>
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

            {!savedId && (
                <div className="text-center py-8 opacity-40 italic text-sm border-2 border-dashed border-gray-100 dark:border-gray-700 rounded-2xl">
                    The photo gallery will appear here once the record is saved.
                </div>
            )}

            {media && media.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                    {media.map(m => <PhotoThumb key={m.id} mediaId={m.id} filename={m.filename} />)}
                </div>
            )}
        </div>
      </div>
      {isPickingLocation && (
          <LocationPickerModal
              initialLat={form.lat}
              initialLon={form.lon}
              onClose={() => setIsPickingLocation(false)}
              onSelect={(pickedLat, pickedLon) => {
                  const grid = toOSGridRef(pickedLat, pickedLon);
                  update({ lat: pickedLat, lon: pickedLon, acc: null, osGridRef: grid || "" });
                  setIsPickingLocation(false);
              }}
          />
      )}
    </div>
  );
}
