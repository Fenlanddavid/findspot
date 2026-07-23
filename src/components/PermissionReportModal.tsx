import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { db, Find, GeoJSONPolygon, Media, Permission, Session, Track } from "../db";
import { Modal } from "./Modal";
import { toFarmerLabel, toFarmerDetail, summariseFinds } from "../services/fieldReport";
import { getSetting } from "../services/data";
import { reportNonFatal } from "../services/diagLog";
import {
  REPORT,
  ReportFooter,
  ReportHeader,
  ReportMetricGrid,
  ReportPillList,
  ReportSectionHeading,
  ReportSummaryRows,
  GpsFindBadge,
  formatReportDate,
  formatSessionDateRange,
  getNotableFindLabels,
  makeReportReference,
  applyReportPdfMetadata,
  reportBodyStyle,
  reportDocumentStyle,
  reportKeepTogetherStyle,
  plural,
} from "./ReportChrome";

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
  boundary: GeoJSONPolygon | null;
  isClubDay: boolean;
  photoUrls: Map<string, string>;
}

// ─── Numbered marker sprite ───────────────────────────────────────────────────

function makeMarkerImage(num: number): { width: number; height: number; data: Uint8ClampedArray } {
  const size = 36;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#10b981";
  ctx.stroke();
  ctx.fillStyle = "#047857";
  const fontSize = num >= 10 ? 11 : 13;
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(num), size / 2, size / 2 + 1);
  return { width: size, height: size, data: ctx.getImageData(0, 0, size, size).data };
}

// ─── Map capture ─────────────────────────────────────────────────────────────

function removeReportMap(map: maplibregl.Map): void {
  try {
    map.remove();
  } catch (error) {
    reportNonFatal('permission-report', 'Map cleanup failed', error);
  }
}

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
      if (!settled) { settled = true; removeReportMap(map); reject(new Error("Map render timed out")); }
    }, 15000);

    map.on("load", () => {
      try { setup(map); } catch (e) {
        if (!settled) { settled = true; clearTimeout(timeout); removeReportMap(map); reject(e); }
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
          catch (e) { removeReportMap(map); reject(e); }
        }, 500);
      });
    });

    map.on("error", (e) => {
      if (!settled) { settled = true; clearTimeout(timeout); removeReportMap(map); reject(e.error); }
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
  const [pdfError, setPdfError] = useState<string | null>(null);
  const canShare = typeof navigator !== "undefined" && !!navigator.canShare;

  const mapDivRef = useRef<HTMLDivElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);
  const generatedAtRef = useRef(new Date());

  // ── Load data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const permission = await db.permissions.get(permissionId);
        if (!permission) throw new Error("Permission not found");

        let scopeLabel = "All Fields";
        let boundary: GeoJSONPolygon | null = permission.boundary ?? null;

        if (fieldId) {
          const field = await db.fields.get(fieldId);
          scopeLabel = field?.name ?? "Field";
          boundary = field?.boundary ?? boundary;
        }

        // Sessions scoped to field or whole permission.
        // Merged member sessions are normalised to the organiser's permissionId on import,
        // so a single query covers both organiser and member data.
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
        const isClubDay = !!permission.isSharedPermission;

        const findIds = allFinds.map(f => f.id);
        const firstPhotos: Media[] = findIds.length > 0
          ? await db.media.where("findId").anyOf(findIds).toArray()
          : [];
        const photoUrls = new Map<string, string>();
        for (const m of firstPhotos) {
          if (!m.findId || photoUrls.has(m.findId)) continue;
          await new Promise<void>(resolve => {
            const reader = new FileReader();
            reader.onload = () => { photoUrls.set(m.findId!, reader.result as string); resolve(); };
            reader.onerror = () => resolve();
            reader.readAsDataURL(m.blob);
          });
        }

        setData({ permission, scopeLabel, sessions: allSessions, finds: allFinds, tracks: allTracks, detectoristName, insuranceProvider, ncmdNumber, boundary, isClubDay, photoUrls });
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
      .filter(({ find }) => find.lat != null && find.lon != null);

    const allFitPoints: Array<{ lat: number; lon: number }> = [
      ...allTrackPoints,
      ...numberedGpsFinds.map(({ find }) => ({ lat: find.lat!, lon: find.lon! })),
      ...(permission.lat != null && permission.lon != null ? [{ lat: permission.lat, lon: permission.lon }] : []),
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
      const sliceCtx = sliceCanvas.getContext("2d");
      if (!sliceCtx) throw new Error("Failed to get canvas context for PDF slice");
      sliceCtx.drawImage(canvas, 0, -srcYOffset);
      const sliceDisplayH = (sliceH / canvas.width) * printW;
      pdf.addImage(sliceCanvas.toDataURL("image/jpeg", 0.92), "JPEG", margin, margin, printW, sliceDisplayH);
      srcYOffset = sliceEnd;
      pageCount++;
    }

    const isGroupReport = data!.permission.type === "rally" || data!.isClubDay;
    const generatedAt = generatedAtRef.current;
    const reference = makeReportReference(isGroupReport ? "RALLY" : "LAND", data!.permission.id, generatedAt);
    applyReportPdfMetadata(pdf, {
      title: `${isGroupReport ? "Club/Rally Landowner Report" : "Landowner Report"} - ${data!.permission.name}`,
      subject: `${reference} generated by FindSpot for landowner review.`,
      reference,
      generatedAt,
    });

    const safeName = data!.permission.name.replace(/[^a-z0-9]/gi, "-").toLowerCase();
    const safeScope = data!.scopeLabel.replace(/[^a-z0-9]/gi, "-").toLowerCase();
    const filename = `landowner-report-${safeName}-${safeScope}.pdf`;
    return { blob: pdf.output("blob"), filename };
  }

  async function handleDownloadPDF() {
    if (!reportRef.current || !data) return;
    setPdfError(null);
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
      setPdfError("PDF generation failed: " + (e.message || e));
    } finally {
      setGenerating(false);
    }
  }

  async function handleSharePDF() {
    if (!reportRef.current || !data) return;
    setPdfError(null);
    setSharing(true);
    try {
      const { blob, filename } = await buildPDFBlob();
      const file = new File([blob], filename, { type: "application/pdf" });
      await navigator.share({ files: [file], title: `Landowner Report — ${data.permission.name}` });
    } catch (e: any) {
      if ((e as DOMException).name !== "AbortError") {
        setPdfError("Share failed: " + (e.message || e));
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

  const { permission, scopeLabel, finds, tracks, sessions, detectoristName, insuranceProvider, ncmdNumber, isClubDay, photoUrls } = data;
  const summary = summariseFinds(finds);
  const hasMap = !!(tracks.length > 0 || finds.some(f => f.lat != null && f.lon != null));
  const reportTitle = fieldId ? `${permission.name} — ${scopeLabel}` : permission.name;
  const isGroupReport = permission.type === "rally" || isClubDay;
  const generatedAt = generatedAtRef.current;
  const reportReference = makeReportReference(isGroupReport ? "RALLY" : "LAND", permission.id, generatedAt);
  const reportTypeLabel = isGroupReport ? "Club/Rally Landowner Report" : "Landowner Report";
  const conductedByLabel = isGroupReport ? "Club/rally organiser" : (detectoristName || permission.collector || "Detectorist");
  const dateRangeLabel = formatSessionDateRange(sessions);
  const latestSessionDate = sessions
    .map(s => new Date(s.date))
    .filter(date => !Number.isNaN(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const latestVisitLabel = formatReportDate(latestSessionDate, "short");
  const eventDateLabel = formatReportDate(permission.validFrom, "long");
  const organiserContactName = permission.landownerName;
  const organiserContactPhone = permission.landownerPhone || permission.organiserContactNumber;
  const organiserContactEmail = permission.landownerEmail || permission.organiserEmail;
  const notableFinds = getNotableFindLabels(finds);
  const gpsFindCount = finds.filter(f => f.lat != null && f.lon != null).length;
  const participantCount = isGroupReport
    ? new Set(sessions.map(s => s.recorderId || s.recorderName).filter(Boolean)).size
    : 0;
  const headerDescriptor = fieldId
    ? "Single-field summary prepared for landowner review, showing recorded activity, finds and any mapped search coverage for this field."
    : isGroupReport
      ? "Club/rally activity summary prepared for landowner review. Member names are intentionally omitted from this copy."
      : "Permission summary prepared for landowner review, showing recorded visits, finds and mapped activity across the permission.";
  const summaryRows = [
    { label: "Sessions recorded", value: sessions.length > 0 ? plural(sessions.length, "visit") : "No visits recorded yet" },
    { label: "Finds recorded", value: summary.total > 0 ? plural(summary.total, "find") : "No finds recorded yet" },
    { label: "Latest visit", value: latestVisitLabel || "Not recorded" },
    { label: "Date range", value: dateRangeLabel || "Not recorded" },
    { label: "Key highlights", value: notableFinds.length > 0 ? notableFinds.slice(0, 3).join(", ") : "No notable finds highlighted yet" },
    ...(isGroupReport ? [{ label: "Privacy", value: "Detectorist names are omitted from this landowner copy." }] : []),
  ];
  const metricStats = [
    { label: "Sessions", value: String(sessions.length) },
    { label: "Finds", value: String(summary.total) },
    { label: "GPS finds", value: String(gpsFindCount) },
    ...(participantCount > 0 ? [{ label: "Detectorists", value: String(participantCount) }] : []),
    ...(summary.coins > 0 ? [{ label: "Coins", value: String(summary.coins) }] : []),
  ];

  const sessionDateMap = new Map(
    sessions.map(s => [s.id, new Date(s.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })])
  );
  const hasMultipleSessions = sessions.length > 1;

  return (
    <Modal title="Landowner Report" onClose={onClose}>
      <div className="flex flex-col gap-6">
        <div className="sticky top-0 z-10 -mx-4 -mt-4 px-4 py-3 bg-white/95 dark:bg-gray-800/95 backdrop-blur border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black text-gray-800 dark:text-gray-100 m-0">Preview</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 m-0">{reportTitle}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleDownloadPDF}
              disabled={generating || sharing || mapCapturing}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black px-4 py-2 rounded-xl shadow-sm transition-all uppercase tracking-wider text-xs"
            >
              {generating ? "Generating..." : mapCapturing ? "Rendering..." : "PDF"}
            </button>
            {canShare && (
              <button
                onClick={handleSharePDF}
                disabled={generating || sharing || mapCapturing}
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-black px-4 py-2 rounded-xl transition-all uppercase tracking-wider text-xs"
              >
                {sharing ? "Sharing..." : "Share"}
              </button>
            )}
            <button onClick={onClose} className="bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-300 font-bold px-4 py-2 rounded-xl transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 text-xs">
              Close
            </button>
          </div>
        </div>

        {mapCapturing && <div className="text-center text-sm text-gray-500 animate-pulse py-1">Rendering map...</div>}
        {mapError && <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">{mapError}</div>}
        {pdfError && <div className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">{pdfError}</div>}

        {/* Off-screen map canvas */}
        <div ref={mapDivRef} style={{ position: "fixed", left: -9999, top: -9999, width: 920, height: 540, zIndex: -1 }} />

        {/* Report preview */}
        <div ref={reportRef} style={reportDocumentStyle}>
          <ReportHeader
            typeLabel={reportTypeLabel}
            title={permission.name}
            subtitle={fieldId ? scopeLabel : null}
            reference={reportReference}
            conductedBy={conductedByLabel}
            insuranceText={!isGroupReport && ncmdNumber ? `${insuranceProvider || "NCMD"} No. ${ncmdNumber}` : null}
            dateText={`Generated ${formatReportDate(generatedAt, "long")}`}
            descriptor={headerDescriptor}
          />

          <div style={reportBodyStyle}>

            {/* Prepared for */}
            {permission.landownerName && (
              <div style={{ borderLeft: `3px solid ${REPORT.accent}`, paddingLeft: 14 }}>
                <div style={{ fontSize: 9, fontFamily: "sans-serif", letterSpacing: "0.1em", textTransform: "uppercase", color: REPORT.muted, marginBottom: 2, fontWeight: 800 }}>{isGroupReport ? "Primary event contact" : "Prepared for"}</div>
                <div style={{ fontSize: 15, fontWeight: 740, color: REPORT.ink }}>{permission.landownerName}</div>
                {permission.landownerAddress && <div style={{ fontSize: 12, color: REPORT.muted, marginTop: 2 }}>{permission.landownerAddress}</div>}
              </div>
            )}

            <ReportSummaryRows rows={summaryRows} />

            {isGroupReport && (
              <div data-pdf-block style={{ ...reportKeepTogetherStyle, background: REPORT.panel, border: `1px solid ${REPORT.line}`, borderRadius: 10, padding: "15px 16px", fontFamily: "sans-serif" }}>
                <div style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: REPORT.muted, marginBottom: 10, fontWeight: 800 }}>Club/Rally Event Details</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 9, color: REPORT.faint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2, fontWeight: 800 }}>Event date</div>
                    <div style={{ fontSize: 12, color: REPORT.ink, fontWeight: 720 }}>{eventDateLabel || "Not recorded"}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: REPORT.faint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2, fontWeight: 800 }}>Member submissions</div>
                    <div style={{ fontSize: 12, color: REPORT.ink, fontWeight: 720 }}>{plural(sessions.length, "session")} received</div>
                  </div>
                  {(organiserContactName || organiserContactPhone || organiserContactEmail) && (
                    <div>
                      <div style={{ fontSize: 9, color: REPORT.faint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2, fontWeight: 800 }}>Event contact</div>
                      <div style={{ fontSize: 12, color: REPORT.ink, fontWeight: 720 }}>
                        {[organiserContactName, organiserContactPhone, organiserContactEmail].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize: 9, color: REPORT.faint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2, fontWeight: 800 }}>Privacy</div>
                    <div style={{ fontSize: 12, color: REPORT.ink, fontWeight: 720 }}>Detectorist names omitted from this landowner copy</div>
                  </div>
                </div>
                <div style={{ marginTop: 10, fontSize: 11, color: REPORT.muted, lineHeight: 1.5 }}>
                  Member-facing club/rally packs do not include private landowner notes, agreements or landowner-only details.
                </div>
              </div>
            )}

            <ReportMetricGrid stats={metricStats} />

            <ReportPillList title={isGroupReport ? "Significant / Notable Finds" : "Notable Finds"} items={notableFinds} />

            {/* Combined map */}
            {hasMap && (
              <div data-pdf-block style={reportKeepTogetherStyle}>
                <ReportSectionHeading caption="Find locations and recorded search activity across this permission.">
                  GPS Tracks &amp; Find Locations
                </ReportSectionHeading>
                {mapUrl ? (
                  <img src={mapUrl} alt="Permission map" style={{ width: "100%", borderRadius: 10, border: `1px solid ${REPORT.line}`, display: "block", background: REPORT.panel }} />
                ) : (
                  <div style={{ height: 250, background: REPORT.panelSoft, borderRadius: 10, border: `1px solid ${REPORT.line}`, display: "flex", alignItems: "center", justifyContent: "center", color: REPORT.muted, fontSize: 12 }}>
                    {mapCapturing ? "Rendering..." : "Map unavailable"}
                  </div>
                )}
              </div>
            )}

            {/* Find list */}
            {finds.length > 0 && (
              <div>
                <ReportSectionHeading caption={`${finds.length} ${finds.length === 1 ? "find" : "finds"} recorded${!fieldId && sessions.length > 0 ? ` across ${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}` : ""}.`}>
                  Finds Catalogue
                </ReportSectionHeading>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {finds.map((find, i) => {
                    const num = i + 1;
                    const hasGps = find.lat != null && find.lon != null;
                    const detail = toFarmerDetail(find);
                    const sessionDate = find.sessionId ? sessionDateMap.get(find.sessionId) : null;
                    return (
                      <div key={find.id} data-pdf-block style={{ ...reportKeepTogetherStyle, display: "flex", alignItems: "flex-start", gap: 12, padding: "11px 12px", background: REPORT.panel, borderRadius: 9, border: `1px solid ${REPORT.line}` }}>
                        <GpsFindBadge num={num} hasGps={hasGps} style={{ marginTop: detail ? 1 : 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: REPORT.ink, fontWeight: 720 }}>{toFarmerLabel(find)}</div>
                          {detail && <div style={{ fontSize: 11, color: REPORT.muted, marginTop: 3, fontFamily: "sans-serif" }}>{detail}</div>}
                          {!hasGps && (
                            <div style={{ fontSize: 9, color: REPORT.muted, fontFamily: "sans-serif", marginTop: 4 }}>GPS not recorded</div>
                          )}
                        </div>
                        {(photoUrls.has(find.id) || (hasMultipleSessions && sessionDate)) && (
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flexShrink: 0 }}>
                            {hasMultipleSessions && sessionDate && (
                              <span style={{ fontSize: 9, color: REPORT.accentDark, fontFamily: "sans-serif", fontWeight: 760, whiteSpace: "nowrap" }}>{sessionDate}</span>
                            )}
                            {photoUrls.has(find.id) && (
                              <img
                                src={photoUrls.get(find.id)}
                                alt=""
                                style={{ width: 64, height: 64, borderRadius: 6, border: `1px solid ${REPORT.line}`, objectFit: "cover", display: "block", background: REPORT.panelSoft }}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {finds.some(f => !f.lat || !f.lon) && (
                  <div style={{ fontSize: 9, color: REPORT.muted, fontFamily: "sans-serif", marginTop: 7, paddingLeft: 2 }}>
                    Soft grey outlined numbers indicate finds recorded without GPS location.
                  </div>
                )}
              </div>
            )}

            {finds.length === 0 && (
              <div style={{ textAlign: "center", padding: "24px 0", color: REPORT.muted, fontFamily: "sans-serif", fontSize: 13 }}>
                No finds recorded for this {fieldId ? "field" : "permission"} yet.
              </div>
            )}

            {/* Compliance */}
            <div data-pdf-block style={{ ...reportKeepTogetherStyle, borderTop: `1px solid ${REPORT.line}`, paddingTop: 16, fontSize: 11, color: REPORT.muted, lineHeight: 1.7, textAlign: "center", fontFamily: "sans-serif" }}>
              All activity conducted in accordance with the Code of Practice for Responsible Metal Detecting in England and Wales. All finds recorded and reported as required.
            </div>

            <ReportFooter reference={reportReference} generatedAt={generatedAt} />

          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={handleDownloadPDF}
            disabled={generating || sharing || mapCapturing}
            className="hidden"
          >
            {generating ? (
              <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Generating...</>
            ) : mapCapturing ? "Rendering map..." : "Download PDF"}
          </button>
          {canShare && (
            <button
              onClick={handleSharePDF}
              disabled={generating || sharing || mapCapturing}
              className="hidden"
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
