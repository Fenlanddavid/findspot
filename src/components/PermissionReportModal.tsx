import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { db, Find, Permission, Session, Track } from "../db";
import { Modal } from "./Modal";
import { toFarmerLabel, toFarmerDetail, summariseFinds } from "../services/fieldReport";
import { getSetting } from "../services/data";

interface Props {
  permissionId: string;
  fieldId?: string; // undefined = whole permission
  onClose: () => void;
}

interface ReportData {
  permission: Permission;
  scopeLabel: string; // "All Fields" or specific field name
  sessions: Session[];
  finds: Find[];
  tracks: Track[];
  detectoristName: string;
  insuranceProvider: string;
  ncmdNumber: string;
  boundary: any | null;
}

// ─── Numbered marker sprite ───────────────────────────────────────────────────

function makeMarkerImage(num: number): { width: number; height: number; data: Uint8ClampedArray } {
  const size = 36;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
  ctx.fillStyle = "#059669";
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  const fontSize = num >= 10 ? 11 : 13;
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(num), size / 2, size / 2 + 1);
  return { width: size, height: size, data: ctx.getImageData(0, 0, size, size).data };
}

// ─── Map capture ─────────────────────────────────────────────────────────────

function captureMap(
  container: HTMLDivElement,
  setup: (map: maplibregl.Map) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const map = new maplibregl.Map({
      container,
      preserveDrawingBuffer: true,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          satellite: {
            type: "raster",
            tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
            tileSize: 256,
          },
        },
        layers: [{ id: "sat", type: "raster", source: "satellite" }],
      },
      center: [-2, 54.5],
      zoom: 5,
    });

    const timeout = setTimeout(() => {
      if (!settled) { settled = true; try { map.remove(); } catch (_) {} reject(new Error("Map render timed out")); }
    }, 15000);

    map.on("load", () => {
      try { setup(map); } catch (e) {
        if (!settled) { settled = true; clearTimeout(timeout); try { map.remove(); } catch (_) {} reject(e); }
        return;
      }
      let renderDebounce: ReturnType<typeof setTimeout> | null = null;
      map.on("render", () => {
        if (renderDebounce) clearTimeout(renderDebounce);
        renderDebounce = setTimeout(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          try { const url = map.getCanvas().toDataURL("image/png"); map.remove(); resolve(url); }
          catch (e) { try { map.remove(); } catch (_) {} reject(e); }
        }, 500);
      });
    });

    map.on("error", (e) => {
      if (!settled) { settled = true; clearTimeout(timeout); try { map.remove(); } catch (_) {} reject(e.error); }
    });
  });
}

function fitBounds(map: maplibregl.Map, boundary: any, points: Array<{ lat: number; lon: number }>) {
  const bounds = new maplibregl.LngLatBounds();
  let hasData = false;
  if (boundary?.coordinates?.[0]) {
    for (const c of boundary.coordinates[0]) { bounds.extend(c as [number, number]); hasData = true; }
  }
  for (const p of points) { bounds.extend([p.lon, p.lat]); hasData = true; }
  if (hasData && !bounds.isEmpty()) {
    map.fitBounds(bounds, { padding: 40, duration: 0, animate: false, maxZoom: 18 });
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PermissionReportModal({ permissionId, fieldId, onClose }: Props) {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [mapCapturing, setMapCapturing] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [sharing, setSharing] = useState(false);
  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  const mapDivRef = useRef<HTMLDivElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  // ── Load data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const permission = await db.permissions.get(permissionId);
        if (!permission) throw new Error("Permission not found");

        let scopeLabel = "All Fields";
        let boundary: any | null = (permission as any).boundary ?? null;

        if (fieldId) {
          const field = await db.fields.get(fieldId);
          scopeLabel = field?.name ?? "Field";
          boundary = field?.boundary ?? boundary;
        }

        // Sessions scoped to field or whole permission
        const allSessions = fieldId
          ? await db.sessions.where("fieldId").equals(fieldId).toArray()
          : await db.sessions.where("permissionId").equals(permissionId).toArray();

        const sessionIds = new Set(allSessions.map(s => s.id));

        // All confirmed finds for those sessions
        const allFinds: Find[] = [];
        for (const s of allSessions) {
          const sessionFinds = await db.finds
            .where("sessionId")
            .equals(s.id)
            .filter(f => !f.isPending)
            .toArray();
          allFinds.push(...sessionFinds);
        }
        allFinds.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

        // All tracks for those sessions
        const allTracks: Track[] = [];
        for (const sid of sessionIds) {
          const t = await db.tracks.where("sessionId").equals(sid).toArray();
          allTracks.push(...t);
        }

        const detectoristName = (await getSetting("detectorist", "")) as string;
        const insuranceProvider = (await getSetting("insuranceProvider", "")) as string;
        const ncmdNumber = (await getSetting("ncmdNumber", "")) as string;

        setData({ permission, scopeLabel, sessions: allSessions, finds: allFinds, tracks: allTracks, detectoristName, insuranceProvider, ncmdNumber, boundary });
      } catch (e: any) {
        setError(e.message || "Failed to load report data");
      } finally {
        setLoading(false);
      }
    })();
  }, [permissionId, fieldId]);

  // ── Capture map ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!data || !mapDivRef.current) return;

    const { permission, boundary, finds, tracks } = data;
    const allTrackPoints = tracks.flatMap(t => t.points || []);
    const numberedGpsFinds = finds
      .map((f, i) => ({ find: f, num: i + 1 }))
      .filter(({ find }) => find.lat && find.lon);

    const allFitPoints: Array<{ lat: number; lon: number }> = [
      ...allTrackPoints,
      ...numberedGpsFinds.map(({ find }) => ({ lat: find.lat!, lon: find.lon! })),
      ...(permission.lat && permission.lon ? [{ lat: permission.lat, lon: permission.lon }] : []),
    ];

    const setupMap = (map: maplibregl.Map) => {
      for (const { num } of numberedGpsFinds) {
        map.addImage(`marker-${num}`, makeMarkerImage(num));
      }
      map.addSource("boundary", {
        type: "geojson",
        data: boundary || { type: "FeatureCollection", features: [] },
      });
      map.addLayer({ id: "boundary-fill", type: "fill", source: "boundary", paint: { "fill-color": "#10b981", "fill-opacity": 0.07 } });
      map.addLayer({ id: "boundary-outline", type: "line", source: "boundary", paint: { "line-color": "#10b981", "line-width": 2, "line-dasharray": [3, 2] } });
      map.addSource("tracks", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: tracks
            .filter(t => t.points && t.points.length >= 2)
            .map(t => ({
              type: "Feature",
              geometry: { type: "LineString", coordinates: t.points.map(p => [p.lon, p.lat]) },
              properties: { color: t.color || "#10b981" },
            })),
        },
      });
      map.addLayer({ id: "tracks-line", type: "line", source: "tracks", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": 0.85 } });
      map.addSource("finds", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: numberedGpsFinds.map(({ find, num }) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [find.lon!, find.lat!] },
            properties: { markerName: `marker-${num}` },
          })),
        },
      });
      map.addLayer({ id: "find-markers", type: "symbol", source: "finds", layout: { "icon-image": ["get", "markerName"], "icon-size": 1, "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-anchor": "center" } });
      fitBounds(map, boundary, allFitPoints);
    };

    captureMap(mapDivRef.current, setupMap)
      .then(url => { setMapUrl(url); setMapCapturing(false); })
      .catch(() => { setMapError("Map preview unavailable — report will still generate without it."); setMapCapturing(false); });
  }, [data]);

  async function buildPDFBlob(): Promise<{ blob: Blob; filename: string }> {
    const reportEl = reportRef.current!;
    const SCALE = 2;

    const containerTop = reportEl.getBoundingClientRect().top;
    type Block = { start: number; end: number };
    const blocks: Block[] = [];
    reportEl.querySelectorAll("[data-pdf-block]").forEach(el => {
      const rect = el.getBoundingClientRect();
      const start = Math.round((rect.top - containerTop) * SCALE);
      const end   = Math.round((rect.bottom - containerTop) * SCALE);
      if (start > 10) blocks.push({ start, end });
    });

    const canvas = await html2canvas(reportEl, { scale: SCALE, useCORS: true, backgroundColor: "#ffffff", logging: false });
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const printW = pageW - margin * 2;
    const pageCanvasH = Math.floor((pageH - margin * 2) / printW * canvas.width);

    const findSliceEnd = (sliceStart: number): number => {
      const naturalEnd = Math.min(sliceStart + pageCanvasH, canvas.height);
      for (const { start, end } of blocks) {
        if (start > sliceStart && start < naturalEnd && end > naturalEnd) return start;
      }
      return naturalEnd;
    };

    let srcYOffset = 0;
    let pageCount = 0;
    while (srcYOffset < canvas.height) {
      if (pageCount > 0) pdf.addPage();
      const sliceEnd = findSliceEnd(srcYOffset);
      const sliceH = sliceEnd - srcYOffset;
      const sliceCanvas = document.createElement("canvas");
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = sliceH;
      sliceCanvas.getContext("2d")!.drawImage(canvas, 0, -srcYOffset);
      const sliceDisplayH = (sliceH / canvas.width) * printW;
      pdf.addImage(sliceCanvas.toDataURL("image/jpeg", 0.92), "JPEG", margin, margin, printW, sliceDisplayH);
      srcYOffset = sliceEnd;
      pageCount++;
    }

    const safeName = data!.permission.name.replace(/[^a-z0-9]/gi, "-").toLowerCase();
    const safeScope = data!.scopeLabel.replace(/[^a-z0-9]/gi, "-").toLowerCase();
    const filename = `landowner-report-${safeName}-${safeScope}.pdf`;
    return { blob: pdf.output("blob"), filename };
  }

  async function handleDownloadPDF() {
    if (!reportRef.current || !data) return;
    setGenerating(true);
    try {
      const { blob, filename } = await buildPDFBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert("PDF generation failed: " + (e.message || e));
    } finally {
      setGenerating(false);
    }
  }

  async function handleSharePDF() {
    if (!reportRef.current || !data) return;
    setSharing(true);
    try {
      const { blob, filename } = await buildPDFBlob();
      const file = new File([blob], filename, { type: "application/pdf" });
      await navigator.share({ files: [file], title: `Landowner Report — ${data.permission.name}` });
    } catch (e: any) {
      if ((e as DOMException).name !== "AbortError") {
        alert("Share failed: " + (e.message || e));
      }
    } finally {
      setSharing(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return <Modal title="Landowner Report" onClose={onClose}><div className="py-12 text-center opacity-50">Loading report data...</div></Modal>;
  }
  if (error || !data) {
    return <Modal title="Landowner Report" onClose={onClose}><div className="py-8 text-center text-red-600">{error || "Unknown error"}</div></Modal>;
  }

  const { permission, scopeLabel, finds, tracks, sessions, detectoristName, insuranceProvider, ncmdNumber } = data;
  const summary = summariseFinds(finds);
  const hasMap = !!(tracks.length > 0 || finds.some(f => f.lat && f.lon));
  const reportTitle = fieldId ? `${permission.name} — ${scopeLabel}` : permission.name;

  const sessionDateMap = new Map(
    sessions.map(s => [s.id, new Date(s.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })])
  );
  const hasMultipleSessions = sessions.length > 1;

  return (
    <Modal title="Landowner Report" onClose={onClose}>
      <div className="flex flex-col gap-6">

        {mapCapturing && <div className="text-center text-sm text-gray-500 animate-pulse py-1">Rendering map...</div>}
        {mapError && <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">{mapError}</div>}

        {/* Off-screen map canvas */}
        <div ref={mapDivRef} style={{ position: "fixed", left: -9999, top: -9999, width: 720, height: 420, zIndex: -1 }} />

        {/* Report preview */}
        <div ref={reportRef} className="bg-white text-black rounded-xl overflow-hidden" style={{ fontFamily: "Georgia, serif" }}>

          {/* Header */}
          <div style={{ background: "#064e3b", color: "#fff", padding: "32px 32px 28px", textAlign: "center" }}>
            <div style={{ fontSize: 9, fontFamily: "sans-serif", letterSpacing: "0.2em", opacity: 0.6, marginBottom: 14, textTransform: "uppercase" }}>Landowner Report</div>
            <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: "-0.02em", lineHeight: 1.15 }}>{permission.name}</div>
            {fieldId && (
              <div style={{ fontSize: 14, opacity: 0.75, marginTop: 4, fontStyle: "italic" }}>{scopeLabel}</div>
            )}
            <div style={{ width: 48, height: 2, background: "rgba(255,255,255,0.25)", margin: "16px auto" }} />
            <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 2 }}>
              Conducted by <strong>{detectoristName || permission.collector || "Detectorist"}</strong>
              {ncmdNumber && <span style={{ opacity: 0.7, fontSize: 11 }}> · {insuranceProvider || "NCMD"} No. {ncmdNumber}</span>}
            </div>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 14 }}>
              Generated: {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
            </div>
            <div style={{ display: "inline-block", fontSize: 10, fontFamily: "sans-serif", letterSpacing: "0.06em", opacity: 0.6, background: "rgba(255,255,255,0.1)", borderRadius: 4, padding: "4px 12px", fontStyle: "italic" }}>
              {fieldId ? "Single field summary for landowner review" : "Full permission summary for landowner review"}
            </div>
          </div>

          <div style={{ padding: "24px 32px", display: "flex", flexDirection: "column", gap: 24 }}>

            {/* Prepared for */}
            {permission.landownerName && (
              <div style={{ borderLeft: "3px solid #d1fae5", paddingLeft: 14 }}>
                <div style={{ fontSize: 9, fontFamily: "sans-serif", letterSpacing: "0.1em", textTransform: "uppercase", color: "#9ca3af", marginBottom: 2 }}>Prepared for</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>{permission.landownerName}</div>
                {permission.landownerAddress && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{permission.landownerAddress}</div>}
              </div>
            )}

            {/* Stats row */}
            {(() => {
              const stats = [
                { label: "Sessions", value: String(sessions.length) },
                { label: "Finds recorded", value: String(summary.total) },
                ...(summary.coins > 0 ? [{ label: "Coins", value: String(summary.coins) }] : []),
              ];
              return (
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${stats.length}, 1fr)`, gap: 12 }}>
                  {stats.map(({ label, value }) => (
                    <div key={label} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "12px 14px", textAlign: "center" }}>
                      <div style={{ fontSize: 9, fontFamily: "sans-serif", letterSpacing: "0.12em", textTransform: "uppercase", color: "#9ca3af", marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 16, fontWeight: 900, color: "#064e3b" }}>{value}</div>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Combined map */}
            {hasMap && (
              <div data-pdf-block>
                <div style={{ fontSize: 9, fontFamily: "sans-serif", letterSpacing: "0.12em", textTransform: "uppercase", color: "#9ca3af", marginBottom: 6 }}>
                  GPS Tracks &amp; Find Locations
                </div>
                {mapUrl ? (
                  <img src={mapUrl} alt="Permission map" style={{ width: "100%", borderRadius: 8, border: "1px solid #e5e7eb", display: "block" }} />
                ) : (
                  <div style={{ height: 200, background: "#f3f4f6", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", fontSize: 12 }}>
                    {mapCapturing ? "Rendering..." : "Map unavailable"}
                  </div>
                )}
              </div>
            )}

            {/* Find list */}
            {finds.length > 0 && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                  <div style={{ fontSize: 9, fontFamily: "sans-serif", letterSpacing: "0.12em", textTransform: "uppercase", color: "#9ca3af" }}>
                    What Was Found
                  </div>
                  <div style={{ fontSize: 11, fontFamily: "sans-serif", color: "#6b7280" }}>
                    {finds.length} {finds.length === 1 ? "find" : "finds"} recorded
                    {!fieldId && sessions.length > 0 && ` across ${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}`}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {finds.map((find, i) => {
                    const num = i + 1;
                    const hasGps = !!(find.lat && find.lon);
                    const detail = toFarmerDetail(find);
                    const sessionDate = find.sessionId ? sessionDateMap.get(find.sessionId) : null;
                    return (
                      <div key={find.id} data-pdf-block style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 10px", background: i % 2 === 0 ? "#f9fafb" : "#ffffff", borderRadius: 6, border: "1px solid #e5e7eb" }}>
                        <div style={{ width: 22, height: 22, borderRadius: "50%", background: hasGps ? "#059669" : "#9ca3af", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#fff", fontSize: 9, fontWeight: 900, fontFamily: "sans-serif", marginTop: detail ? 1 : 0 }}>
                          {num}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: "#374151", fontWeight: 600 }}>{toFarmerLabel(find)}</div>
                          {detail && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2, fontFamily: "sans-serif" }}>{detail}</div>}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
                          {hasMultipleSessions && sessionDate && (
                            <span style={{ fontSize: 9, color: "#059669", fontFamily: "sans-serif", fontWeight: 700, whiteSpace: "nowrap" }}>{sessionDate}</span>
                          )}
                          {!hasGps && (
                            <span style={{ fontSize: 9, color: "#9ca3af", fontFamily: "sans-serif", fontStyle: "italic" }}>No GPS</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {finds.some(f => !f.lat || !f.lon) && (
                  <div style={{ fontSize: 9, color: "#9ca3af", fontFamily: "sans-serif", fontStyle: "italic", marginTop: 6, paddingLeft: 2 }}>
                    Grey numbers indicate finds recorded without GPS location.
                  </div>
                )}
              </div>
            )}

            {finds.length === 0 && (
              <div style={{ textAlign: "center", padding: "24px 0", color: "#9ca3af", fontFamily: "sans-serif", fontSize: 13 }}>
                No finds recorded for this {fieldId ? "field" : "permission"} yet.
              </div>
            )}

            {/* Compliance */}
            <div data-pdf-block style={{ borderTop: "1px solid #e5e7eb", paddingTop: 16, fontSize: 11, color: "#6b7280", lineHeight: 1.7, textAlign: "center", fontFamily: "sans-serif" }}>
              All activity conducted in accordance with the Code of Practice for Responsible Metal Detecting in England and Wales. All finds recorded and reported as required.
            </div>

            {/* Footer */}
            <div style={{ textAlign: "center", fontSize: 9, color: "#d1d5db", fontFamily: "sans-serif", letterSpacing: "0.08em", paddingBottom: 4 }}>
              Generated by FindSpot
            </div>

          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={handleDownloadPDF}
            disabled={generating || sharing || mapCapturing}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black py-3 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 uppercase tracking-wider text-sm"
          >
            {generating ? (
              <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Generating...</>
            ) : mapCapturing ? "Rendering map..." : "Download PDF"}
          </button>
          {canShare && (
            <button
              onClick={handleSharePDF}
              disabled={generating || sharing || mapCapturing}
              className="flex-1 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white font-black py-3 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 uppercase tracking-wider text-sm"
            >
              {sharing ? (
                <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Sharing...</>
              ) : "Share"}
            </button>
          )}
          <button onClick={onClose} className="px-6 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-bold py-3 rounded-xl transition-colors hover:bg-gray-200 dark:hover:bg-gray-700">
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
