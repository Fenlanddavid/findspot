import React, { useEffect, useState, useMemo } from "react";
import { db, Permission, Session, Find, Media } from "../db";
import { v4 as uuid } from "uuid";
import { captureGPS } from "../services/gps";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { FindRow } from "../components/FindRow";
import { FindModal } from "../components/FindModal";

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

  const findThumbMedia = useMemo(() => {
    const info = new Map<string, Media>();
    if (!allMedia || !finds) return info;
    const sortedMedia = [...allMedia].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const row of sortedMedia) {
      if (!info.has(row.findId)) info.set(row.findId, row);
    }
    return info;
  }, [allMedia, finds]);

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
            <button onClick={() => nav(permission ? `/permission/${permission.id}` : "/")} className="text-sm font-medium text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 bg-gray-50 dark:bg-gray-800 px-3 py-1 rounded-lg border border-gray-200 dark:border-gray-700 transition-colors">Back to Permission</button>
        </div>

        {error && (
            <div className="border-2 border-red-200 bg-red-50 text-red-800 p-4 rounded-xl shadow-sm flex gap-3 items-center">
                <span className="text-xl">⚠️</span> {error}
            </div>
        )}

        <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-sm grid gap-6 h-fit">
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

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <label className="block">
                        <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Land Use</div>
                        <input value={landUse} onChange={(e) => setLandUse(e.target.value)} placeholder="e.g., Permanent Pasture" className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium" />
                    </label>
                    <label className="block">
                        <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Crop Type</div>
                        <input value={cropType} onChange={(e) => setCropType(e.target.value)} placeholder="e.g., Winter Wheat" className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium" />
                    </label>
                </div>

                <label className="flex items-center gap-2 cursor-pointer group w-fit">
                    <input type="checkbox" checked={isStubble} onChange={(e) => setIsStubble(e.target.checked)} className="w-5 h-5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-emerald-600 transition-colors">Is Stubble?</span>
                </label>

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
