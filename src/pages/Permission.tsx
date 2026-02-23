import React, { useEffect, useState, useMemo } from "react";
import { db, Permission, Find, Media } from "../db";
import { v4 as uuid } from "uuid";
import { captureGPS } from "../services/gps";
import { getSetting } from "../services/data";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { FindRow } from "../components/FindRow";
import { FindModal } from "../components/FindModal";
import { PermissionReport } from "../components/PermissionReport";
import { AgreementModal } from "../components/AgreementModal";

const landTypes: Permission["landType"][] = [
  "arable", "pasture", "woodland", "scrub", "parkland", "beach", "foreshore", "other",
];

export default function PermissionPage(props: {
  projectId: string;
  onSaved: (id: string) => void;
}) {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const nav = useNavigate();
  const isEdit = !!id;

  const [name, setName] = useState("");
  const [type, setType] = useState<Permission["type"]>((searchParams.get("type") as any) || "individual");
  const [collector, setCollector] = useState("");
  const [observedAt, setObservedAt] = useState(new Date().toISOString().slice(0, 16));
  const [lat, setLat] = useState<number | null>(null);
  const [lon, setLon] = useState<number | null>(null);
  const [acc, setAcc] = useState<number | null>(null);

  const [landownerName, setLandownerName] = useState("");
  const [landownerPhone, setLandownerPhone] = useState("");
  const [landownerEmail, setLandownerEmail] = useState("");
  const [landownerAddress, setLandownerAddress] = useState("");

  const [landType, setLandType] = useState<Permission["landType"]>("arable");
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [ncmdNumber, setNcmdNumber] = useState("");
  const [ncmdExpiry, setNcmdExpiry] = useState("");
  const [detectoristName, setDetectoristName] = useState("");
  const [detectoristEmail, setDetectoristEmail] = useState("");

  const [landUse, setLandUse] = useState("");
  const [cropType, setCropType] = useState("");
  const [isStubble, setIsStubble] = useState(false);
  const [notes, setNotes] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [isEditing, setIsEditing] = useState(!isEdit);
  const [agreementId, setAgreementId] = useState<string | undefined>();
  const [agreementModalOpen, setAgreementModalOpen] = useState(false);
  
  const [openFindId, setOpenFindId] = useState<string | null>(null);

  const agreementFile = useLiveQuery(async () => {
    if (!agreementId) return null;
    return db.media.get(agreementId);
  }, [agreementId]);

  // Fetch finds for this trip
  const finds = useLiveQuery(async () => {
    if (!id) return [];
    return db.finds.where("permissionId").equals(id).reverse().sortBy("createdAt");
  }, [id]);

  const sessions = useLiveQuery(async () => {
    if (!id) return [];
    const rows = await db.sessions.where("permissionId").equals(id).reverse().sortBy("createdAt");
    
    // Fetch counts and tracks in parallel for all sessions
    return Promise.all(rows.map(async (s) => {
      const findCount = await db.finds.where("sessionId").equals(s.id).count();
      const sessionTracks = await db.tracks.where("sessionId").equals(s.id).toArray();
      
      let durationMs = 0;
      if (sessionTracks.length > 0) {
        const allPoints = sessionTracks.flatMap(t => t.points).sort((a, b) => a.timestamp - b.timestamp);
        if (allPoints.length > 1) {
          durationMs = allPoints[allPoints.length - 1].timestamp - allPoints[0].timestamp;
        }
      }

      return { ...s, findCount, hasTracking: sessionTracks.length > 0, durationMs };
    }));
  }, [id]);

  function formatDuration(ms: number) {
    if (ms <= 0) return null;
    const mins = Math.floor(ms / 60000);
    const hrs = Math.floor(mins / 600);
    if (hrs > 0) return `${hrs}h ${mins % 60}m`;
    return `${mins}m`;
  }

  // Fetch all media for the report
  const allMedia = useLiveQuery(async () => {
    if (!id || !finds) return [];
    const ids = finds.map(s => s.id);
    return db.media.where("findId").anyOf(ids).toArray();
  }, [id, finds]);

  // Fetch thumbnails and scale info for the finds
  const findThumbMedia = useMemo(() => {
    const info = new Map<string, Media>();
    if (!allMedia || !finds) return info;
    
    const sortedMedia = [...allMedia].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const row of sortedMedia) {
      if (row.findId && !info.has(row.findId)) {
        info.set(row.findId, row);
      }
    }
    return info;
  }, [allMedia, finds]);

  useEffect(() => {
    getSetting("ncmdNumber", "").then(setNcmdNumber);
    getSetting("ncmdExpiry", "").then(setNcmdExpiry);
    getSetting("detectorist", "").then(setDetectoristName);
    getSetting("detectoristEmail", "").then(setDetectoristEmail);

    if (id) {
      db.permissions.get(id).then(l => {
        if (l) {
          setName(l.name);
          setType(l.type || "individual");
          setCollector(l.collector);
          setLat(l.lat);
          setLon(l.lon);
          setAcc(l.gpsAccuracyM);
          setLandownerName(l.landownerName || "");
          setLandownerPhone(l.landownerPhone || "");
          setLandownerEmail(l.landownerEmail || "");
          setLandownerAddress(l.landownerAddress || "");
          setLandType(l.landType);
          setPermissionGranted(l.permissionGranted);
          setAgreementId((l as any).agreementId);
          setNotes(l.notes);
        }
        setLoading(false);
      });
    } else {
      getSetting("detectorist", "").then(setCollector);
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

  async function handleDelete() {
    if (!id) return;
    if (!confirm("Are you sure? This will permanently delete this permission, all sessions, and all finds.")) return;
    
    setSaving(true);
    try {
      await db.transaction("rw", db.permissions, db.sessions, db.finds, db.media, async () => {
        const finds = await db.finds.where("permissionId").equals(id).toArray();
        const findIds = finds.map(s => s.id);
        await db.media.where("findId").anyOf(findIds).delete();
        await db.finds.where("permissionId").equals(id).delete();
        await db.sessions.where("permissionId").equals(id).delete();
        await db.permissions.delete(id);
      });
      nav("/");
    } catch (e: any) {
      setError("Delete failed: " + e.message);
      setSaving(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      const finalId = id || uuid();

      const permission: Permission = {
        id: finalId,
        projectId: props.projectId,
        name,
        type,
        lat,
        lon,
        gpsAccuracyM: acc,
        collector,
        landownerName,
        landownerPhone,
        landownerEmail,
        landownerAddress,
        landType,
        permissionGranted,
        agreementId,
        notes,
        createdAt: isEdit ? undefined as any : now, 
        updatedAt: now,
      };

      if (isEdit) {
        await db.permissions.update(id, permission);
        setIsEditing(false);
        alert("Land record updated!");
      } else {
        (permission as any).createdAt = now;
        await db.permissions.add(permission);
        setIsEditing(false);
        props.onSaved(finalId);
      }
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  if (loading) return <div className="p-10 text-center opacity-50 font-medium">Loading details...</div>;

  const currentPermission: Permission | null = id ? {
    id, projectId: props.projectId, name, type, lat, lon, gpsAccuracyM: acc, collector,
    landownerName, landownerPhone, landownerEmail, landownerAddress,
    landType, permissionGranted, notes,
    createdAt: "", updatedAt: ""
  } : null;

  return (
    <div className="max-w-4xl mx-auto pb-20 px-4">
      <div className="no-print grid gap-8 mt-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex flex-wrap gap-3 items-center">
                <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100">{isEdit ? `Land/Permission Details` : "New Permission"}</h2>
                {isEdit && !isEditing && (
                    <button 
                        onClick={() => setIsEditing(true)}
                        className="text-xs font-bold text-emerald-600 hover:text-white hover:bg-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800 transition-all"
                    >
                        ✎ Edit Details
                    </button>
                )}
            </div>
            <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                {isEdit && (
                    <>
                        <button 
                            onClick={handlePrint}
                            className="text-xs sm:text-sm font-bold text-emerald-600 hover:text-white hover:bg-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800 transition-all flex-1 sm:flex-none"
                        >
                            Report
                        </button>
                        <button 
                            onClick={handleDelete}
                            disabled={saving}
                            className="text-xs sm:text-sm font-bold text-red-600 hover:text-white hover:bg-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-1 rounded-lg border border-red-200 dark:border-red-800 transition-all disabled:opacity-50 flex-1 sm:flex-none"
                        >
                            Delete
                        </button>
                    </>
                )}
                <button onClick={() => nav("/")} className="text-xs sm:text-sm font-medium text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 bg-gray-50 dark:bg-gray-800 px-3 py-1 rounded-lg border border-gray-200 dark:border-gray-700 transition-colors flex-1 sm:flex-none">Home</button>
            </div>
        </div>

        {error && (
            <div className="border-2 border-red-200 bg-red-50 text-red-800 p-4 rounded-xl shadow-sm animate-in fade-in slide-in-from-top-2 font-medium flex gap-3 items-center">
                <span className="text-xl">⚠️</span> {error}
            </div>
        )}

        <div className="grid lg:grid-cols-3 gap-8">
            {/* Left Column: Permission Info */}
            <div className="lg:col-span-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-sm grid gap-6 h-fit">
                {isEditing ? (
                  <>
                    <div className="flex flex-col sm:flex-row gap-2 p-1 bg-gray-100 dark:bg-gray-900 rounded-xl w-full sm:w-fit">
                        <button 
                            onClick={() => setType("individual")}
                            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all ${type === "individual" ? "bg-white dark:bg-gray-800 shadow-sm text-emerald-600" : "text-gray-500 hover:text-gray-700"}`}
                        >
                            Individual Permission
                        </button>
                        <button 
                            onClick={() => setType("rally")}
                            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all ${type === "rally" ? "bg-white dark:bg-gray-800 shadow-sm text-teal-600" : "text-gray-500 hover:text-gray-700"}`}
                        >
                            Club/Rally Dig
                        </button>
                    </div>

                    <label className="block">
                    <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">{type === 'rally' ? 'Rally / Event Name' : 'Permission Name / Location'}</div>
                    <input 
                        value={name} 
                        onChange={(e) => setName(e.target.value)} 
                        placeholder={type === 'rally' ? "e.g., Weekend Rally, Club Dig North" : "e.g., Smith's Farm, North Field"} 
                        className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium"
                    />
                    </label>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <label className="block">
                            <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Landowner / Contact Name</div>
                            <input 
                                value={landownerName} 
                                onChange={(e) => setLandownerName(e.target.value)} 
                                placeholder="Full name" 
                                className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium"
                            />
                        </label>
                        <label className="block">
                            <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Phone Number</div>
                            <input 
                                value={landownerPhone} 
                                onChange={(e) => setLandownerPhone(e.target.value)} 
                                placeholder="e.g., 07123 456789" 
                                className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium"
                            />
                        </label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <label className="block">
                            <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Email Address</div>
                            <input 
                                type="email"
                                value={landownerEmail} 
                                onChange={(e) => setLandownerEmail(e.target.value)} 
                                placeholder="landowner@example.com" 
                                className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium"
                            />
                        </label>
                        <label className="block">
                            <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Postal Address</div>
                            <input 
                                value={landownerAddress} 
                                onChange={(e) => setLandownerAddress(e.target.value)} 
                                placeholder="Farm address, postcode..." 
                                className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium"
                            />
                        </label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <label className="block">
                            <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Detectorist (Default)</div>
                            <input 
                                value={collector} 
                                onChange={(e) => setCollector(e.target.value)} 
                                placeholder="Name or initials" 
                                className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium"
                            />
                        </label>

                        <label className="block">
                            <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Land Type</div>
                            <select 
                                value={landType} 
                                onChange={(e) => setLandType(e.target.value as any)}
                                className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all appearance-none font-medium"
                            >
                            {landTypes.map((t) => (
                                <option key={t} value={t}>{t}</option>
                            ))}
                            </select>
                        </label>
                    </div>

                    <div className="bg-gray-50/50 dark:bg-gray-900/20 p-5 rounded-2xl border-2 border-gray-100/50 dark:border-gray-800/30 flex flex-col sm:flex-row gap-4 items-center justify-between">
                        <div className="flex flex-col gap-1 w-full">
                            <div className="text-xs font-bold uppercase tracking-wider opacity-60">Base Coordinates (Center)</div>
                            <div className="text-sm sm:text-lg font-mono font-bold text-gray-800 dark:text-gray-100 break-all">
                                {lat && lon ? (
                                <div className="flex items-center gap-2">
                                    {lat.toFixed(6)}, {lon.toFixed(6)}
                                </div>
                                ) : (
                                <span className="opacity-40 italic text-sm">Coordinates not set</span>
                                )}
                            </div>
                        </div>
                        <button type="button" onClick={doGPS} className="w-full sm:w-auto bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 px-4 py-2 rounded-xl font-bold transition-all text-sm whitespace-nowrap">
                            📍 Save Coordinates
                        </button>
                    </div>

                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                            <div className="text-sm font-bold text-gray-700 dark:text-gray-300">Permission Status</div>
                            {!isEdit && (
                                <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800 animate-pulse">
                                    💡 Save record first to generate agreement
                                </span>
                            )}
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer group w-fit">
                            <input 
                                type="checkbox" 
                                checked={permissionGranted} 
                                onChange={(e) => setPermissionGranted(e.target.checked)}
                                className="w-5 h-5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                            />
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-emerald-600 transition-colors">Permission Granted?</span>
                        </label>
                    </div>

                    <label className="block">
                    <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Land/Farm Notes</div>
                    <textarea 
                        value={notes} 
                        onChange={(e) => setNotes(e.target.value)} 
                        rows={4} 
                        className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium"
                    />
                    </label>

                    <div className="flex gap-4">
                        <button 
                            onClick={save} 
                            disabled={saving || !name.trim()} 
                            className={`mt-4 flex-1 bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-4 rounded-2xl font-black text-xl shadow-xl transition-all disabled:opacity-50`}
                        >
                            {saving ? "Saving..." : isEdit ? "Update Details ✓" : "Create Record →"}
                        </button>
                        {isEdit && (
                            <button 
                                onClick={() => setIsEditing(false)}
                                className="mt-4 bg-gray-100 dark:bg-gray-800 text-gray-500 px-6 py-4 rounded-2xl font-bold transition-all"
                            >
                                Cancel
                            </button>
                        )}
                    </div>
                  </>
                ) : (
                  <div className="grid gap-8">
                    <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                        <div className="min-w-0 flex-1">
                            <span className={`text-[10px] uppercase tracking-widest font-black px-2 py-0.5 rounded ${type === 'rally' ? 'bg-teal-100 text-teal-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                {type === 'rally' ? 'Club/Rally Dig' : 'Individual Permission'}
                            </span>
                            <h3 className="text-2xl sm:text-3xl font-black text-gray-800 dark:text-gray-100 mt-2 break-words">{name}</h3>
                        </div>
                        <div className="flex flex-wrap gap-2 items-center justify-end">
                          <div className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl border-2 flex items-center gap-2 font-black text-[10px] sm:text-sm whitespace-nowrap h-fit ${permissionGranted ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-700'}`}>
                              {permissionGranted ? '✓ PERMISSION GRANTED' : '⚠️ NO PERMISSION'}
                          </div>
                          <button 
                              onClick={() => setAgreementModalOpen(true)}
                              className="text-[10px] sm:text-xs font-black bg-white dark:bg-gray-800 border-2 border-gray-100 dark:border-gray-700 px-3 py-2 rounded-xl text-gray-600 dark:text-gray-400 hover:border-emerald-500 hover:text-emerald-600 transition-all flex items-center gap-1 shadow-sm h-fit"
                          >
                            🤝 {agreementId ? "Update Agreement" : "Generate Agreement"}
                          </button>
                        </div>
                    </div>

                    {agreementFile && (
                      <div className="bg-emerald-50 dark:bg-emerald-900/10 border-2 border-emerald-100 dark:border-emerald-800/50 p-4 rounded-2xl flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">📄</span>
                          <div>
                            <p className="text-sm font-black text-emerald-800 dark:text-emerald-400">Signed Landowner Agreement</p>
                            <p className="text-[10px] opacity-60 font-mono italic">{agreementFile.filename}</p>
                          </div>
                        </div>
                        <button 
                          onClick={() => {
                            const url = URL.createObjectURL(agreementFile.blob);
                            window.open(url, "_blank");
                          }}
                          className="bg-white dark:bg-gray-800 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 px-4 py-2 rounded-xl text-xs font-bold shadow-sm hover:shadow-md transition-all"
                        >
                          View PDF ↗
                        </button>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="grid gap-4">
                            <div>
                                <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1">Landowner / Contact</h4>
                                <p className="font-bold text-gray-700 dark:text-gray-300">{landownerName || "Not recorded"}</p>
                                {landownerPhone && <p className="text-sm opacity-60">📞 {landownerPhone}</p>}
                                {landownerEmail && <p className="text-sm opacity-60">✉️ {landownerEmail}</p>}
                                {landownerAddress && <p className="text-sm opacity-60 mt-1 italic">📍 {landownerAddress}</p>}
                            </div>
                            <div>
                                <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1">Land Details</h4>
                                <p className="font-bold text-gray-700 dark:text-gray-300 capitalize">
                                    {landType}
                                </p>
                            </div>
                        </div>

                        <div className="grid gap-4">
                            <div>
                                <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1">Base Location</h4>
                                {lat && lon ? (
                                    <div className="flex flex-col gap-1">
                                        <p className="font-mono font-bold text-emerald-600">{lat.toFixed(6)}, {lon.toFixed(6)}</p>
                                        <button 
                                            onClick={() => window.open(`https://www.google.com/maps?q=${lat},${lon}`, "_blank")}
                                            className="text-[10px] font-bold text-gray-400 hover:text-emerald-600 transition-colors flex items-center gap-1"
                                        >
                                            View on Google Maps ↗
                                        </button>
                                    </div>
                                ) : (
                                    <p className="text-sm opacity-40 italic">Coordinates not set</p>
                                )}
                            </div>
                            <div>
                                <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1">Default Detectorist</h4>
                                <p className="font-bold text-gray-700 dark:text-gray-300">{collector || "Not set"}</p>
                                {(ncmdNumber || ncmdExpiry) && (
                                    <div className="mt-1 text-[10px] font-bold text-emerald-600 flex flex-wrap gap-x-3">
                                        {ncmdNumber && <span>NCMD: {ncmdNumber}</span>}
                                        {ncmdExpiry && <span>Exp: {new Date(ncmdExpiry).toLocaleDateString()}</span>}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {notes && (
                        <div className="bg-gray-50 dark:bg-gray-900/50 p-6 rounded-2xl border border-gray-100 dark:border-gray-800">
                            <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-2">Notes</h4>
                            <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{notes}</p>
                        </div>
                    )}
                  </div>
                )}
            </div>

            {/* Right Column: Sessions List */}
            <div className="bg-gray-50 dark:bg-gray-900/30 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-inner h-fit max-h-[85vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100 m-0">Sessions / Visits</h3>
                    <div className="text-xs font-mono bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded font-bold">{sessions?.length ?? 0} total</div>
                </div>

                {!isEdit && (
                    <div className="text-center py-10 opacity-50 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl italic text-sm px-4">
                        Create the record first to start adding sessions!
                    </div>
                )}

                {isEdit && (
                    <div className="grid gap-3">
                        <button 
                            onClick={() => nav(`/session/new?permissionId=${id}`)}
                            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl font-bold shadow-md transition-all flex items-center justify-center gap-2 mb-4"
                        >
                            + Start New Session (Visit)
                        </button>

                        {sessions && sessions.length > 0 ? (
                            sessions.map((s: any) => (
                                <button 
                                    key={s.id} 
                                    onClick={() => nav(`/session/${s.id}`)}
                                    className="w-full text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4 rounded-xl shadow-sm hover:border-emerald-500 transition-all group"
                                >
                                    <div className="flex justify-between items-start">
                                        <div className="font-bold text-gray-800 dark:text-gray-100 group-hover:text-emerald-600">
                                            {new Date(s.date).toLocaleDateString()}
                                        </div>
                                        <div className="flex gap-2 items-center">
                                            {s.findCount > 0 && (
                                                <span className="text-[10px] font-black bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded">
                                                    {s.findCount} {s.findCount === 1 ? 'Find' : 'Finds'}
                                                </span>
                                            )}
                                            {s.hasTracking && (
                                                <span title="Trail Map Recorded" className="text-[10px] bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 px-1.5 py-0.5 rounded flex items-center gap-1 font-bold">
                                                    👣 Trail
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-xs opacity-60 mt-1 flex items-center justify-between">
                                        <span>{s.cropType || s.landUse || "General visit"}</span>
                                        {s.durationMs > 0 && <span className="font-mono opacity-80">{formatDuration(s.durationMs)}</span>}
                                    </div>
                                    <div className="mt-2 text-[10px] font-mono opacity-40 italic line-clamp-1">
                                        {s.notes}
                                    </div>
                                </button>
                            ))
                        ) : (
                            <div className="text-center py-10 opacity-50 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl italic text-sm">
                                No sessions recorded yet.
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
      </div>

      {isEdit && currentPermission && finds && allMedia && sessions && (
        <div className="hidden print:block">
            <PermissionReport 
              permission={currentPermission} 
              sessions={sessions} 
              finds={finds} 
              media={allMedia} 
              ncmdNumber={ncmdNumber}
              ncmdExpiry={ncmdExpiry}
              detectoristName={detectoristName}
              detectoristEmail={detectoristEmail}
            />
        </div>
      )}

      {openFindId && <FindModal findId={openFindId} onClose={() => setOpenFindId(null)} />}
      
      {agreementModalOpen && currentPermission && (
        <AgreementModal 
          permission={currentPermission} 
          onClose={() => setAgreementModalOpen(false)} 
          onSaved={(mediaId) => {
            setAgreementId(mediaId);
            setAgreementModalOpen(false);
          }}
        />
      )}
    </div>
  );
}
