import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { v4 as uuid } from "uuid";
import { db, Find, Media, SignificantFind } from "../../db";
import { fileToBlob } from "../../services/photos";
import { ScaledImage } from "../ScaledImage";
import {
  formatSignificantDate,
  formatSignificantLocation,
  getStatusLabel,
  getStepsForPath,
  JURISDICTION_LABELS,
  PATH_COLORS,
  PATH_LABELS,
  STATUS_COLORS,
} from "./significantFindDisplay";

function getPeriodColor(period: string): string {
  const p = (period ?? "").toLowerCase();
  if (p.includes("roman"))                              return "#9333ea";
  if (p.includes("medieval") && !p.includes("post"))   return "#2563eb";
  if (p.includes("post-medieval") || p.includes("post medieval")) return "#0891b2";
  if (p.includes("bronze"))                             return "#ea580c";
  if (p.includes("iron"))                               return "#b45309";
  if (p.includes("modern"))                             return "#6b7280";
  return "#f59e0b";
}

function ScatterMiniMap({ finds }: { finds: Find[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const initKey = finds.map(f => f.id).join(",");

  useEffect(() => {
    const valid = finds.filter(f => f.lat != null && f.lon != null);
    if (!containerRef.current || valid.length === 0) return;
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }

    const lats = valid.map(f => f.lat!);
    const lons = valid.map(f => f.lon!);
    const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            osm: { type: "raster", tiles: ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap" },
          },
          layers: [{ id: "osm-tiles", type: "raster", source: "osm", minzoom: 0, maxzoom: 22 }],
        },
        center: [centerLon, centerLat],
        zoom: 17,
        interactive: false,
      });
    } catch { return; }
    mapRef.current = map;

    map.on("load", () => {
      valid.forEach((f, i) => {
        const color = getPeriodColor(f.period);
        const el = document.createElement("div");
        el.style.cssText = `width:24px;height:24px;border-radius:50%;background:${color};border:2px solid white;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:900;color:white;box-shadow:0 2px 6px rgba(0,0,0,.35);`;
        el.textContent = String(i + 1);
        new maplibregl.Marker({ element: el }).setLngLat([f.lon!, f.lat!]).addTo(map);
      });
      if (valid.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        valid.forEach(f => bounds.extend([f.lon!, f.lat!]));
        map.fitBounds(bounds, { padding: 40, maxZoom: 18, duration: 0 });
      }
    });

    return () => { map.remove(); mapRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initKey]);

  const validCount = finds.filter(f => f.lat != null && f.lon != null).length;
  if (validCount === 0) return null;

  return (
    <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700" style={{ height: 200 }}>
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}

function PasRecordUrlField({ sfId, value, onSave, projectId }: {
  sfId: string;
  value: string;
  onSave: (v: string) => void;
  projectId: string;
}) {
  const [local, setLocal] = useState(value);
  const [pdfSaved, setPdfSaved] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => { setLocal(value); }, [value]);

  async function handlePdf(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    setPdfError(null);
    try {
      const blob = await fileToBlob(file);
      await db.media.add({
        id: uuid(),
        projectId,
        findId: sfId,
        type: "photo",
        photoType: "other",
        filename: file.name,
        mime: file.type || "application/pdf",
        blob,
        caption: "PAS Report",
        scalePresent: false,
        createdAt: new Date().toISOString(),
      });
      setPdfSaved(true);
      setTimeout(() => setPdfSaved(false), 3000);
    } catch {
      setPdfError("Could not save the file. Please try again.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-[9px] font-black uppercase tracking-widest text-gray-400">PAS record URL</label>
      <div className="flex gap-2">
        <input
          type="url"
          value={local}
          onChange={e => setLocal(e.target.value)}
          onBlur={() => onSave(local)}
          placeholder="https://finds.org.uk/database/artefacts/record/id/…"
          className="flex-1 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20 placeholder:text-gray-400"
        />
        {local && (
          <a
            href={local}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-xs font-black text-emerald-700 dark:text-emerald-400"
          >
            Open
          </a>
        )}
      </div>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 cursor-pointer transition-colors">
          📎 {pdfSaved ? <span className="text-emerald-600 dark:text-emerald-400 font-semibold">PDF saved ✓</span> : "Attach PAS report PDF"}
          <input type="file" accept="application/pdf,image/*" onChange={handlePdf} className="hidden" />
        </label>
      </div>
      {pdfError && <p className="text-xs text-red-500">{pdfError}</p>}
    </div>
  );
}

function StatusTracker({ path, status, onSet }: {
  path: SignificantFind["path"];
  status: SignificantFind["status"];
  onSet: (s: SignificantFind["status"]) => void;
}) {
  const steps = getStepsForPath(path);
  const currentIdx = steps.findIndex(s => s.value === status);
  return (
    <div className="bg-gray-50 dark:bg-gray-800/60 rounded-2xl p-3">
      <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">Update status</p>
      <div className="flex flex-col gap-1.5">
        {steps.map((s, idx) => {
          const isCurrent = status === s.value;
          const isDone = idx < currentIdx;
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => onSet(s.value)}
              className={`flex items-center gap-3 w-full text-left px-3 py-2.5 rounded-xl border transition-all ${
                isCurrent
                  ? "border-amber-400 bg-amber-50 dark:bg-amber-900/20"
                  : isDone
                  ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10"
                  : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-amber-300"
              }`}
            >
              <div className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] ${
                isCurrent ? "border-amber-500 bg-amber-500 text-white"
                : isDone ? "border-emerald-500 bg-emerald-500 text-white"
                : "border-gray-300 dark:border-gray-600"
              }`}>
                {isDone ? "OK" : isCurrent ? ">" : ""}
              </div>
              <span className={`text-sm font-semibold ${
                isCurrent ? "text-amber-800 dark:text-amber-300"
                : isDone ? "text-emerald-700 dark:text-emerald-400"
                : "text-gray-600 dark:text-gray-400"
              }`}>{s.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EditableField({ label, value, placeholder, rows = 2, onSave }: {
  label: string;
  value: string;
  placeholder: string;
  rows?: number;
  onSave: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[9px] font-black uppercase tracking-widest text-gray-400">{label}</label>
      <textarea
        value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={() => onSave(local)}
        rows={rows}
        placeholder={placeholder}
        className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20 resize-none placeholder:text-gray-400"
      />
      {local !== value && (
        <button
          type="button"
          onClick={() => onSave(local)}
          className="self-end px-4 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-black uppercase tracking-wide"
        >
          Save
        </button>
      )}
    </div>
  );
}

function EditableLineField({ label, value, placeholder, onSave }: {
  label: string;
  value: string;
  placeholder: string;
  onSave: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[9px] font-black uppercase tracking-widest text-gray-400">{label}</label>
      <input
        type="text"
        value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={() => onSave(local)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20 placeholder:text-gray-400"
      />
    </div>
  );
}

export default function SignificantFindDetailSheet({ sfId, onClose }: { sfId: string; onClose: () => void }) {
  const sf = useLiveQuery<SignificantFind | undefined>(() => db.significantFinds.get(sfId), [sfId]);
  const photoOwnerIds = useMemo(
    () => Array.from(new Set([sfId, sf?.linkedFindId].filter((id): id is string => !!id))),
    [sfId, sf?.linkedFindId]
  );
  const photos = useLiveQuery<Media[]>(
    () => photoOwnerIds.length ? db.media.where("findId").anyOf(photoOwnerIds).toArray() : Promise.resolve([] as Media[]),
    [photoOwnerIds.join("|")]
  ) ?? [];
  const scatterFinds = useLiveQuery<Find[]>(
    () => sf?.scatterId ? db.finds.where("scatterId").equals(sf.scatterId).toArray() : Promise.resolve([] as Find[]),
    [sf?.scatterId]
  ) ?? [];
  const linkedFind = useLiveQuery<Find | undefined>(
    () => sf?.linkedFindId ? db.finds.get(sf.linkedFindId) : Promise.resolve(undefined),
    [sf?.linkedFindId]
  );

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => { if (photoUrl) URL.revokeObjectURL(photoUrl); };
  }, [photoUrl]);

  async function setStatus(status: SignificantFind["status"]) {
    await db.significantFinds.update(sfId, { status, updatedAt: new Date().toISOString() });
  }

  async function save(patch: Partial<SignificantFind>) {
    await db.significantFinds.update(sfId, { ...patch, updatedAt: new Date().toISOString() });
  }

  async function doDelete() {
    await db.transaction("rw", db.significantFinds, db.media, async () => {
      await db.media.where("findId").equals(sfId).delete();
      await db.significantFinds.delete(sfId);
    });
    onClose();
  }

  function openPhoto(media: Media) {
    setPhotoUrl(URL.createObjectURL(media.blob));
  }

  if (!sf) {
    return (
      <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
        <div className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl p-8 text-center animate-pulse">
          <div className="h-4 w-1/2 mx-auto rounded bg-gray-200 dark:bg-gray-700" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
        <div className="relative w-full max-w-lg max-h-[92dvh] overflow-y-auto bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="sticky top-0 bg-white dark:bg-gray-900 flex items-start justify-between px-5 pt-5 pb-3 border-b border-gray-100 dark:border-gray-800 z-10">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-black text-gray-900 dark:text-gray-100 leading-tight">
                {sf.findDescription || linkedFind?.objectType || PATH_LABELS[sf.path]}
              </h2>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                <span className={`rounded-lg px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${PATH_COLORS[sf.path]}`}>
                  {PATH_LABELS[sf.path]}
                </span>
                <span className={`rounded-lg px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${STATUS_COLORS[sf.status]}`}>
                  {getStatusLabel(sf.path, sf.status)}
                </span>
              </div>
            </div>
            <button onClick={onClose} className="ml-3 mt-0.5 shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700">x</button>
          </div>

          <div className="flex flex-col gap-4 px-5 py-4">
            {photos.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {photos.map(media => (
                  <button
                    key={media.id}
                    type="button"
                    onClick={() => openPhoto(media)}
                    className="shrink-0 w-24 h-24 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800"
                  >
                    <ScaledImage media={media} className="w-full h-full" imgClassName="object-cover w-full h-full" />
                  </button>
                ))}
              </div>
            )}

            <StatusTracker path={sf.path} status={sf.status} onSet={setStatus} />

            <div className="flex gap-2">
              <div className="flex-1 bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Location</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {formatSignificantLocation(sf)}
                </p>
                {sf.w3w && <p className="text-xs text-gray-500 mt-0.5">///{sf.w3w}</p>}
              </div>
              <div className="flex-1 bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Recorded</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{formatSignificantDate(sf.createdAt)}</p>
                {sf.gpsAccuracyM != null && <p className="text-xs text-gray-500 mt-0.5">+/-{sf.gpsAccuracyM.toFixed(1)}m</p>}
              </div>
            </div>

            {sf.path === "stop_secure" && (
              <>
                <EditableField
                  label="Excavation findings"
                  value={sf.excavationFindings ?? ""}
                  placeholder="Record what was found once professionally excavated, e.g. 47 Roman sestertii, 2 gold aurei, iron sword fragment..."
                  rows={3}
                  onSave={v => save({ excavationFindings: v })}
                />
                {(sf.initialObservations || sf.preExcavationNotes || sf.soilObservations || sf.secureCoverNotes) && (
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 flex flex-col gap-1.5">
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Pre-excavation observations</p>
                    {sf.initialObservations && <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{sf.initialObservations}</p>}
                    {sf.preExcavationNotes && <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{sf.preExcavationNotes}</p>}
                    {sf.soilObservations && <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed italic">{sf.soilObservations}</p>}
                    {sf.secureCoverNotes && <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">Secured with: {sf.secureCoverNotes}</p>}
                  </div>
                )}
                {(sf.depthCm != null || sf.periodEstimate) && (
                  <div className="flex gap-2">
                    {sf.depthCm != null && (
                      <div className="flex-1 bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Depth</p>
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{sf.depthCm}cm</p>
                      </div>
                    )}
                    {sf.periodEstimate && (
                      <div className="flex-1 bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Period estimate</p>
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{sf.periodEstimate}</p>
                      </div>
                    )}
                  </div>
                )}
                {sf.firstPersonAccount && (
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Account of discovery</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{sf.firstPersonAccount}</p>
                  </div>
                )}
                <div className="flex flex-col gap-3">
                  <EditableLineField label="Date FLO contacted" value={sf.floContactDate ?? ""} placeholder="e.g. 26 May 2026" onSave={v => save({ floContactDate: v })} />
                  <EditableLineField label="PAS record number" value={sf.pasRecordNumber ?? ""} placeholder="Assigned by your FLO after recording" onSave={v => save({ pasRecordNumber: v })} />
                  <PasRecordUrlField sfId={sfId} value={sf.pasRecordUrl ?? ""} onSave={v => save({ pasRecordUrl: v })} projectId={sf.projectId} />
                </div>
              </>
            )}

            {sf.path === "map_scatter" && (
              <>
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400 mb-1">Scatter summary</p>
                  <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{scatterFinds.length} find{scatterFinds.length !== 1 ? "s" : ""} recorded</p>
                  {sf.jurisdiction !== "unknown" && (
                    <p className="text-xs text-gray-500 mt-0.5">{JURISDICTION_LABELS[sf.jurisdiction]}</p>
                  )}
                </div>

                <ScatterMiniMap finds={scatterFinds} />

                {scatterFinds.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Finds recorded</p>
                    {scatterFinds.map((f, i) => (
                      <div key={f.id} className="flex items-center gap-3 bg-gray-50 dark:bg-gray-900 rounded-xl px-3 py-2">
                        <span className="w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-black flex items-center justify-center shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{f.objectType}</p>
                          <p className="text-xs text-gray-500">{f.period}{f.depthCm ? ` - ${f.depthCm}cm` : ""}{f.osGridRef ? ` - ${f.osGridRef}` : ""}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">Were all finds recovered?</p>
                  <div className="flex gap-2">
                    {(["yes", "partial", "no"] as const).map(opt => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => save({ allFindsRecovered: opt })}
                        className={`flex-1 py-2 rounded-xl text-xs font-black uppercase tracking-wide border transition-all ${
                          sf.allFindsRecovered === opt
                            ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
                            : "border-gray-200 dark:border-gray-700 text-gray-500 hover:border-amber-300"
                        }`}
                      >
                        {opt === "yes" ? "Yes, all" : opt === "partial" ? "Partial" : "No / unsure"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 flex flex-col gap-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Co-recorder / assisting detectorist</p>
                  <EditableLineField label="Name" value={sf.coRecorderName ?? ""} placeholder="Full name or club nickname" onSave={v => save({ coRecorderName: v })} />
                  <EditableLineField label="Contact (phone or email)" value={sf.coRecorderContact ?? ""} placeholder="So the FLO can reach them if needed" onSave={v => save({ coRecorderContact: v })} />
                  <p className="text-[10px] text-gray-400 leading-relaxed">If another detectorist helped map or recover finds, their details support the FLO's record and any future enquiries.</p>
                </div>

                {sf.firstPersonAccount && (
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Notes on the area</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{sf.firstPersonAccount}</p>
                  </div>
                )}

                <div className="flex flex-col gap-3">
                  <EditableLineField label="Date FLO contacted" value={sf.floContactDate ?? ""} placeholder="e.g. 26 May 2026" onSave={v => save({ floContactDate: v })} />
                  <EditableLineField label="PAS record number" value={sf.pasRecordNumber ?? ""} placeholder="Assigned by your FLO after recording" onSave={v => save({ pasRecordNumber: v })} />
                  <PasRecordUrlField sfId={sfId} value={sf.pasRecordUrl ?? ""} onSave={v => save({ pasRecordUrl: v })} projectId={sf.projectId} />
                </div>
              </>
            )}

            {sf.path === "notable_find" && (
              <>
                {linkedFind && (linkedFind.objectType || linkedFind.period || linkedFind.material) && (
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-2">Object details</p>
                    <div className="flex flex-col gap-1">
                      {linkedFind.objectType && <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{linkedFind.objectType}</p>}
                      <div className="flex gap-2 flex-wrap">
                        {linkedFind.period && <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-lg">{linkedFind.period}</span>}
                        {linkedFind.material && <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-lg">{linkedFind.material}</span>}
                      </div>
                    </div>
                  </div>
                )}

                {(sf.depthCm != null || sf.orientationNotes || sf.soilObservations || sf.preExcavationNotes) && (
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 flex flex-col gap-1.5">
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Context recorded</p>
                    {sf.depthCm != null && <p className="text-sm text-gray-700 dark:text-gray-300">Depth: {sf.depthCm}cm</p>}
                    {sf.orientationNotes && <p className="text-sm text-gray-700 dark:text-gray-300">Orientation: {sf.orientationNotes}</p>}
                    {sf.soilObservations && <p className="text-sm text-gray-700 dark:text-gray-300">Soil: {sf.soilObservations}</p>}
                    {sf.preExcavationNotes && <p className="text-sm text-gray-700 dark:text-gray-300">Associated material: {sf.preExcavationNotes}</p>}
                  </div>
                )}

                {sf.firstPersonAccount && (
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Description</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{sf.firstPersonAccount}</p>
                  </div>
                )}

                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">Where is the find now?</p>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { value: "with_finder", label: "With me" },
                      { value: "with_flo", label: "With FLO" },
                      { value: "at_museum", label: "At museum" },
                      { value: "other", label: "Other" },
                    ] as const).map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => save({ currentLocation: opt.value })}
                        className={`py-2.5 rounded-xl text-xs font-black uppercase tracking-wide border transition-all ${
                          sf.currentLocation === opt.value
                            ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                            : "border-gray-200 dark:border-gray-700 text-gray-500 hover:border-emerald-300"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <EditableLineField label="Date FLO contacted" value={sf.floContactDate ?? ""} placeholder="e.g. 26 May 2026" onSave={v => save({ floContactDate: v })} />
                  <EditableField label="FLO's preliminary identification" value={sf.preliminaryId ?? ""} placeholder="What did your FLO say it might be?" rows={2} onSave={v => save({ preliminaryId: v })} />
                  <EditableLineField label="PAS record number" value={sf.pasRecordNumber ?? ""} placeholder="Assigned by your FLO after recording" onSave={v => save({ pasRecordNumber: v })} />
                  <PasRecordUrlField sfId={sfId} value={sf.pasRecordUrl ?? ""} onSave={v => save({ pasRecordUrl: v })} projectId={sf.projectId} />
                </div>
              </>
            )}

            {/* Landowner notified — shown on all paths */}
            <button
              type="button"
              onClick={() => save({ landownerNotified: !sf.landownerNotified })}
              className={`flex items-center gap-3 w-full rounded-xl border px-4 py-3 transition-all ${
                sf.landownerNotified
                  ? "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/20"
                  : "border-gray-200 bg-white hover:border-amber-300 dark:border-gray-700 dark:bg-gray-900"
              }`}
            >
              <div className={`shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                sf.landownerNotified
                  ? "border-emerald-500 bg-emerald-500"
                  : "border-gray-300 dark:border-gray-600"
              }`}>
                {sf.landownerNotified && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              <span className={`text-sm font-semibold ${sf.landownerNotified ? "text-emerald-800 dark:text-emerald-300" : "text-gray-700 dark:text-gray-300"}`}>
                Landowner notified
              </span>
            </button>

            <button
              onClick={onClose}
              className="w-full bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-black uppercase tracking-widest py-3.5 rounded-2xl text-sm"
            >
              Done
            </button>

            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="w-full py-3 text-xs font-black uppercase tracking-widest text-red-400 hover:text-red-600 transition-colors"
              >
                Delete record
              </button>
            ) : (
              <div className="rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 flex flex-col gap-3">
                <p className="text-sm font-semibold text-red-800 dark:text-red-300 text-center">Delete this significant find record permanently?</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-xs font-black uppercase tracking-wide text-gray-600 dark:text-gray-400"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={doDelete}
                    className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase tracking-wide"
                  >
                    Yes, delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {photoUrl && (
        <div
          className="fixed inset-0 z-[130] bg-black flex items-center justify-center"
          onClick={() => { URL.revokeObjectURL(photoUrl); setPhotoUrl(null); }}
        >
          <img src={photoUrl} alt="Find photo" className="max-w-full max-h-full object-contain" />
          <button className="absolute top-5 right-5 w-10 h-10 rounded-full bg-white/20 text-white flex items-center justify-center text-lg">x</button>
        </div>
      )}
    </>
  );
}
