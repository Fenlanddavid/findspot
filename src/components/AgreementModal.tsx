import React, { useRef, useState, useEffect } from "react";
import { Modal } from "./Modal";
import type { Permission, Media } from "../db";
import { SignaturePad } from "./SignaturePad";
import { v4 as uuid } from "uuid";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { getSetting } from "../services/data";
import { attachPermissionAgreement } from "../services/permissionMutations";
import {
  REPORT,
  ReportFooter,
  ReportHeader,
  ReportSectionHeading,
  ReportSummaryRows,
  formatReportDate,
  applyReportPdfMetadata,
  reportBodyStyle,
  reportDocumentStyle,
} from "./ReportChrome";

const AGREEMENT_DISCLAIMER =
  "This template is provided as a starting point only and should be reviewed and amended to suit individual agreements. FindSpot does not provide legal advice.";

const CLUB_RALLY_DISCLAIMER =
  "This editable template is provided as a starting point for the organiser and landowner/occupier to review, amend and sign. FindSpot does not decide the event terms and does not provide legal advice.";

type ClubRallySectionKey =
  | "permission"
  | "organiser"
  | "participants"
  | "groundCare"
  | "finds"
  | "treasure"
  | "ownership"
  | "termination";

const CLUB_RALLY_SECTION_LABELS: Record<ClubRallySectionKey, string> = {
  permission: "Permission & Event Scope",
  organiser: "Organiser Responsibilities",
  participants: "Participant Requirements",
  groundCare: "Ground Care, Crops & Livestock",
  finds: "Finds, Recording & Confidentiality",
  treasure: "Treasure & Protected Sites",
  ownership: "Ownership & Reward / Value Split",
  termination: "Variation & Termination",
};

const DEFAULT_CLUB_RALLY_SECTIONS: Record<ClubRallySectionKey, string> = {
  permission: "The Landowner/Occupier grants the Organiser permission to run the club/rally detecting event on the agreed date, within the permitted areas only.\nAny fields, access routes, parking areas, no-go zones, crop restrictions, livestock restrictions or time limits should be confirmed before detecting starts.",
  organiser: "The Organiser is responsible for briefing attendees, controlling access, keeping attendees within the agreed areas, managing parking, and making sure the landowner's instructions are followed.\nThe Organiser should keep a record of attendees and provide a point of contact during the event.",
  participants: "Attendees may only detect as part of this organised event and must follow all instructions from the Organiser and Landowner/Occupier.\nNo guests, night detecting, detecting outside the agreed areas, or return visits are permitted unless separately agreed.",
  groundCare: "All attendees must minimise disturbance, recover targets neatly, reinstate ground fully, avoid standing crops unless agreed, leave gates as found, avoid livestock, and remove dug scrap/litter from the land.\nDetecting must stop if ground conditions, weather, livestock, crops or landowner instructions make continuing unsuitable.",
  finds: "Finds should be shown to the Organiser and Landowner/Occupier as agreed. Significant finds should be reported to the Organiser immediately.\nFind locations and event records may be kept by the Organiser for rally administration, landowner reporting and responsible finds recording.\nThe land name, precise location, maps and identifiable imagery must not be published or shared without the Landowner/Occupier's prior consent.",
  treasure: "Potential Treasure must be reported in accordance with the Treasure Act process within 14 days of discovery or of realising the find may be Treasure. The Organiser will support the finder with landowner details and reporting information where needed.\nNo detecting is permitted on scheduled/protected archaeology or other restricted areas unless the necessary written consent has been obtained.",
  ownership: "Ownership of non-treasure finds, any value threshold, sale decision, reward split or return of personal/sentimental items should be agreed by the Organiser and Landowner/Occupier before detecting starts.\nAny Treasure reward split should be agreed in writing between the eligible parties, taking account of the Treasure process and any official valuation or reward decision.",
  termination: "Any changes to this agreement should be confirmed in writing, including by email or text.\nThe Landowner/Occupier may stop the event or exclude areas at any time. Serious breach of instructions, damage, unsafe conduct, or detecting outside agreed areas may result in immediate removal from the event.",
};

type ClubRallyDetails = {
  landownerName: string;
  organiserName: string;
  eventDate: string;
  permittedAreas: string;
  attendeeLimit: string;
};

type SavedAgreement = {
  mediaId: string;
  filename: string;
  blob: Blob;
};

export function AgreementModal(props: {
  permission: Permission;
  onClose: () => void;
  onSaved: (mediaId: string) => void;
}) {
  const isClubRallyAgreement = props.permission.type === "rally" || !!props.permission.isSharedPermission;
  const [detectoristName, setDetectoristName] = useState("");
  const [detectoristEmail, setDetectoristEmail] = useState("");
  const [insuranceProvider, setInsuranceProvider] = useState("");
  const [ncmdNumber, setNcmdNumber] = useState("");
  
  const [landownerSignature, setLandownerSignature] = useState<string | null>(null);
  const [detectoristSignature, setDetectoristSignature] = useState<string | null>(null);
  
  const [generating, setGenerating] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAgreement, setSavedAgreement] = useState<SavedAgreement | null>(null);
  const [clubRallyEditorOpen, setClubRallyEditorOpen] = useState(false);
  const clubRallyOrganiserName = isClubRallyAgreement
    ? (props.permission.collector || props.permission.landownerName || "")
    : props.permission.collector || "";
  const [clubRallyDetails, setClubRallyDetails] = useState<ClubRallyDetails>({
    landownerName: isClubRallyAgreement ? "" : props.permission.landownerName || "",
    organiserName: clubRallyOrganiserName,
    eventDate: props.permission.validFrom || "",
    permittedAreas: props.permission.name,
    attendeeLimit: "",
  });
  const [clubRallySections, setClubRallySections] = useState<Record<ClubRallySectionKey, string>>(DEFAULT_CLUB_RALLY_SECTIONS);
  
  const agreementRef = useRef<HTMLDivElement>(null);
  const generatedAtRef = useRef(new Date());
  const canShare = typeof navigator !== "undefined" && !!navigator.canShare;
  const agreementKind = isClubRallyAgreement ? "Club/Rally Agreement" : "Landowner Agreement";
  const agreementReferencePrefix = isClubRallyAgreement ? "FS-RALLY" : "FS-AGREE";
  const agreementFilenamePrefix = isClubRallyAgreement ? "club-rally-agreement" : "landowner-agreement";
  const agreementSubtitle = isClubRallyAgreement ? "Organised Metal Detecting Event" : "Metal Detecting & Archaeological Recovery";
  const agreementDescriptor = isClubRallyAgreement
    ? "Editable agreement template prepared for organiser and landowner review before signing."
    : "Agreement template prepared for landowner and detectorist review before signing.";
  const templateDisclaimer = isClubRallyAgreement ? CLUB_RALLY_DISCLAIMER : AGREEMENT_DISCLAIMER;

  useEffect(() => {
    getSetting("detectorist", "").then(setDetectoristName);
    getSetting("detectoristEmail", "").then(setDetectoristEmail);
    getSetting("insuranceProvider", "").then(setInsuranceProvider);
    getSetting("ncmdNumber", "").then(setNcmdNumber);
  }, []);

  function markTemplateChanged() {
    setSavedAgreement(null);
    setError(null);
  }

  function updateClubRallyDetail(key: keyof ClubRallyDetails, value: string) {
    setClubRallyDetails(prev => ({ ...prev, [key]: value }));
    markTemplateChanged();
  }

  function updateClubRallySection(key: ClubRallySectionKey, value: string) {
    setClubRallySections(prev => ({ ...prev, [key]: value }));
    markTemplateChanged();
  }

  function renderAgreementText(text: string) {
    return text
      .split(/\n+/)
      .map(line => line.trim())
      .filter(Boolean)
      .map((line, index) => <p key={`${index}-${line}`} style={{ margin: 0 }}>{line}</p>);
  }

  function formatClubRallyEventDate(value: string) {
    if (!value.trim()) return "To be agreed";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return formatReportDate(parsed, "long") || value;
  }

  function handleLandownerSignature(value: string | null) {
    setLandownerSignature(value);
    setSavedAgreement(null);
    setError(null);
  }

  function handleDetectoristSignature(value: string | null) {
    setDetectoristSignature(value);
    setSavedAgreement(null);
    setError(null);
  }

  async function buildPDFBlob(): Promise<{ blob: Blob; filename: string }> {
    if (!agreementRef.current) {
      throw new Error("Agreement preview is not ready.");
    }

    const reportEl = agreementRef.current;
    const SCALE = 2;

    const containerTop = reportEl.getBoundingClientRect().top;
    type Block = { start: number; end: number };
    const blocks: Block[] = [];

    reportEl.querySelectorAll("[data-pdf-block]").forEach(el => {
      const rect = el.getBoundingClientRect();
      const start = Math.round((rect.top - containerTop) * SCALE);
      const end = Math.round((rect.bottom - containerTop) * SCALE);
      if (start > 10) blocks.push({ start, end });
    });

    const canvas = await html2canvas(reportEl, {
      scale: SCALE,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
    });

    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const printW = pageW - margin * 2;
    const pageCanvasH = Math.floor(((pageH - margin * 2) / printW) * canvas.width);

    const findSliceEnd = (sliceStart: number): number => {
      const naturalEnd = Math.min(sliceStart + pageCanvasH, canvas.height);
      for (const { start, end } of blocks) {
        if (start > sliceStart && start < naturalEnd && end > naturalEnd) {
          // Avoid generating a nearly blank page if a protected block begins
          // right after the current page starts.
          return start - sliceStart > 80 ? start : naturalEnd;
        }
      }
      return naturalEnd;
    };

    let srcYOffset = 0;
    let pageCount = 0;
    while (srcYOffset < canvas.height) {
      if (pageCount > 0) pdf.addPage();
      let sliceEnd = findSliceEnd(srcYOffset);
      if (sliceEnd <= srcYOffset) {
        sliceEnd = Math.min(srcYOffset + pageCanvasH, canvas.height);
      }
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

    const generatedAt = generatedAtRef.current;
    const agreementReference = `${agreementReferencePrefix}-${generatedAt.toISOString().slice(0, 10).replace(/-/g, "")}-${props.permission.id.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase() || "LOCAL"}`;
    applyReportPdfMetadata(pdf, {
      title: `${agreementKind} - ${props.permission.name}`,
      subject: `${agreementReference} generated by FindSpot for permission agreement review.`,
      reference: agreementReference,
      generatedAt,
    });

    const safeName = props.permission.name.replace(/[^a-z0-9]/gi, "-").toLowerCase();
    const filename = `${agreementFilenamePrefix}-${safeName}-${new Date().toISOString().slice(0, 10)}.pdf`;
    return { blob: pdf.output("blob"), filename };
  }

  function requireSignatures() {
    if (!landownerSignature || !detectoristSignature) {
      setError(isClubRallyAgreement ? "Landowner/occupier and organiser signatures are required." : "Both signatures are required.");
      return false;
    }
    return true;
  }

  async function generateAndSaveAgreement(): Promise<SavedAgreement> {
    if (savedAgreement) return savedAgreement;

    const { blob, filename } = await buildPDFBlob();
    const mediaId = uuid();
    const media: Media = {
      id: mediaId,
      projectId: props.permission.projectId,
      permissionId: props.permission.id,
      type: "document",
      filename,
      mime: "application/pdf",
      blob,
      caption: agreementKind,
      scalePresent: false,
      createdAt: new Date().toISOString(),
    };

    await attachPermissionAgreement(props.permission.id, media);

    const saved = { mediaId, filename, blob };
    setSavedAgreement(saved);
    props.onSaved(mediaId);
    return saved;
  }

  async function handleDownloadPDF() {
    if (!requireSignatures()) return;
    setGenerating(true);
    setError(null);
    try {
      const { blob, filename } = await generateAndSaveAgreement();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError("PDF generation failed: " + (err.message || err));
    } finally {
      setGenerating(false);
    }
  }

  async function handleSharePDF() {
    if (!requireSignatures()) return;
    setSharing(true);
    setError(null);
    try {
      const { blob, filename } = await generateAndSaveAgreement();
      const file = new File([blob], filename, { type: "application/pdf" });
      await navigator.share({ files: [file], title: `${agreementKind} — ${props.permission.name}` });
    } catch (err: any) {
      if ((err as DOMException).name !== "AbortError") {
        setError("Share failed: " + (err.message || err));
      }
    } finally {
      setSharing(false);
    }
  }

  const generatedAt = generatedAtRef.current;
  const agreementReference = `${agreementReferencePrefix}-${generatedAt.toISOString().slice(0, 10).replace(/-/g, "")}-${props.permission.id.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase() || "LOCAL"}`;

  return (
    <Modal title={agreementKind} onClose={props.onClose}>
      <div className="grid gap-6 max-h-[80vh] overflow-y-auto pr-2 pb-6">
        <div className="sticky top-0 z-10 -mx-1 -mt-1 px-3 py-3 bg-white/95 dark:bg-gray-800/95 backdrop-blur border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black text-gray-800 dark:text-gray-100 m-0">Preview</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 m-0">{props.permission.name}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleDownloadPDF}
              disabled={generating || sharing}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black px-4 py-2 rounded-xl shadow-sm transition-all uppercase tracking-wider text-xs"
            >
              {generating ? "Generating..." : "PDF"}
            </button>
            {canShare && (
              <button
                onClick={handleSharePDF}
                disabled={generating || sharing}
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-black px-4 py-2 rounded-xl transition-all uppercase tracking-wider text-xs"
              >
                {sharing ? "Sharing..." : "Share"}
              </button>
            )}
            <button onClick={props.onClose} className="bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-300 font-bold px-4 py-2 rounded-xl transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 text-xs">
              Close
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 text-red-800 p-3 rounded-xl text-sm font-medium border border-red-100 animate-in fade-in slide-in-from-top-2">
            {error}
          </div>
        )}

        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {templateDisclaimer}
        </div>

        {savedAgreement && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
            <strong>Agreement saved successfully.</strong>
            <span className="block mt-1">{savedAgreement.filename}</span>
          </div>
        )}

        {isClubRallyAgreement && (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="text-sm font-black text-gray-800 dark:text-gray-100 m-0">Editable club/rally template</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 m-0 mt-0.5">
                  {clubRallyEditorOpen ? "Adjust the details and wording before the organiser and landowner sign." : "Open the editor only if these template terms need changing."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setClubRallyEditorOpen(open => !open)}
                className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
              >
                {clubRallyEditorOpen ? "Hide Editor" : "Edit Template"}
              </button>
            </div>

            {clubRallyEditorOpen && (
              <div className="grid gap-4 border-t border-gray-100 dark:border-gray-800 p-4">
                <div className="grid sm:grid-cols-2 gap-3">
                  {[
                    { key: "landownerName" as const, label: "Landowner / occupier", placeholder: "Name shown on agreement" },
                    { key: "organiserName" as const, label: "Organiser", placeholder: "Club, rally organiser or contact name" },
                    { key: "eventDate" as const, label: "Event date", placeholder: "Date or date range" },
                    { key: "attendeeLimit" as const, label: "Attendee limit", placeholder: "e.g. 30 detectorists" },
                  ].map(field => (
                    <label key={field.key} className="grid gap-1">
                      <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">{field.label}</span>
                      <input
                        value={clubRallyDetails[field.key]}
                        onChange={e => updateClubRallyDetail(field.key, e.target.value)}
                        placeholder={field.placeholder}
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-3 py-2 text-sm font-medium text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </label>
                  ))}
                  <label className="grid gap-1 sm:col-span-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">Permitted areas / exclusions</span>
                    <input
                      value={clubRallyDetails.permittedAreas}
                      onChange={e => updateClubRallyDetail("permittedAreas", e.target.value)}
                      placeholder="Fields, boundaries, no-go areas, parking/access notes"
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-3 py-2 text-sm font-medium text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </label>
                </div>
                <div className="grid gap-3">
                  {(Object.keys(CLUB_RALLY_SECTION_LABELS) as ClubRallySectionKey[]).map(key => (
                    <label key={key} className="grid gap-1">
                      <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">{CLUB_RALLY_SECTION_LABELS[key]}</span>
                      <textarea
                        value={clubRallySections[key]}
                        onChange={e => updateClubRallySection(key, e.target.value)}
                        rows={key === "groundCare" || key === "finds" ? 4 : 3}
                        className="w-full resize-y rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-3 py-2 text-sm font-medium leading-relaxed text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* This div is what we capture as PDF */}
        <div className="w-full overflow-x-auto rounded-xl border border-gray-200 shadow-sm bg-white/50 dark:bg-black/20 p-1">
          <div
            ref={agreementRef}
            className="mx-auto"
            style={{ ...reportDocumentStyle, width: "800px" }}
          >
            <ReportHeader
              typeLabel={agreementKind}
              title={props.permission.name}
              subtitle={agreementSubtitle}
              reference={agreementReference}
              conductedBy={isClubRallyAgreement ? (clubRallyDetails.organiserName || "Organiser") : (detectoristName || "Detectorist")}
              insuranceText={ncmdNumber ? `${insuranceProvider || "Membership"} No. ${ncmdNumber}` : null}
              dateText={`Prepared ${formatReportDate(generatedAt, "long")}`}
              descriptor={agreementDescriptor}
            />

            <div style={reportBodyStyle}>
              <div data-pdf-block style={{ border: `1px solid ${REPORT.line}`, borderRadius: 10, background: REPORT.panel, padding: "13px 15px", fontSize: 11, lineHeight: 1.55, color: REPORT.muted, fontFamily: "sans-serif" }}>
                <strong style={{ color: REPORT.ink }}>Template notice:</strong> {templateDisclaimer}
              </div>

              <ReportSummaryRows
                title="Agreement Details"
                rows={isClubRallyAgreement ? [
                  { label: "Agreement date", value: formatReportDate(generatedAt, "long") || generatedAt.toLocaleDateString() },
                  { label: "Landowner / occupier", value: clubRallyDetails.landownerName || "____________________" },
                  { label: "Organiser", value: clubRallyDetails.organiserName || "____________________" },
                  { label: "Event date", value: formatClubRallyEventDate(clubRallyDetails.eventDate) },
                  { label: "Event / permission", value: props.permission.name },
                  { label: "Permitted areas", value: clubRallyDetails.permittedAreas || "To be agreed" },
                  { label: "Attendee limit", value: clubRallyDetails.attendeeLimit || "To be agreed" },
                ] : [
                  { label: "Agreement date", value: formatReportDate(generatedAt, "long") || generatedAt.toLocaleDateString() },
                  { label: "Landowner", value: `${props.permission.landownerName || "____________________"}${props.permission.landownerAddress ? `, ${props.permission.landownerAddress}` : ""}` },
                  { label: "Detectorist", value: `${detectoristName || "____________________"}${detectoristEmail ? ` (${detectoristEmail})` : ""}` },
                  { label: "Land / permission", value: props.permission.name },
                ]}
              />

              {isClubRallyAgreement ? (
                <>
                  {(Object.keys(CLUB_RALLY_SECTION_LABELS) as ClubRallySectionKey[]).map(key => (
                    <div key={key} data-pdf-block>
                      <ReportSectionHeading>{CLUB_RALLY_SECTION_LABELS[key]}</ReportSectionHeading>
                      <div style={{ display: "grid", gap: 7, fontSize: 11.5, lineHeight: 1.62, color: REPORT.ink }}>
                        {renderAgreementText(clubRallySections[key])}
                      </div>
                    </div>
                  ))}
                </>
              ) : (
              <>
              <div data-pdf-block>
                <ReportSectionHeading>Permission</ReportSectionHeading>
                <div style={{ display: "grid", gap: 7, fontSize: 11.5, lineHeight: 1.62, color: REPORT.ink }}>
                  <p style={{ margin: 0 }}>1. The Landowner grants the Detectorist permission to enter the Permitted Areas on foot to search with a metal detector.</p>
                  <p style={{ margin: 0 }}>2. This permission is personal to the Detectorist and is not transferable. No guests/other detectorists may attend unless agreed in advance by the Landowner in writing/text.</p>
                </div>
              </div>

              <div data-pdf-block>
                <ReportSectionHeading>Good Practice &amp; Legal Compliance</ReportSectionHeading>
                <div style={{ display: "grid", gap: 7, fontSize: 11.5, lineHeight: 1.62, color: REPORT.ink }}>
                  <p style={{ margin: 0 }}>3. The Detectorist will follow the Code of Practice for Responsible Metal Detecting and all reasonable instructions given by the Landowner.</p>
                  <p style={{ margin: 0 }}>4. The Detectorist will not detect on protected/restricted areas, including scheduled/protected archaeology, and will comply with all applicable laws.</p>
                </div>
              </div>

              <div data-pdf-block>
                <ReportSectionHeading>Ground Care, Crops &amp; Livestock</ReportSectionHeading>
                <div style={{ fontSize: 11.5, lineHeight: 1.62, color: REPORT.ink }}>
                  <p style={{ margin: "0 0 5px" }}>5. The Detectorist will:</p>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    <li>Use a neat plug method where appropriate, minimise disturbance, and fully reinstate ground.</li>
                    <li>Stop if conditions risk damage, such as waterlogged ground.</li>
                    <li>Keep to headlands/tramlines if requested; avoid standing crops unless agreed.</li>
                    <li>Leave gates as found, avoid livestock, and not damage fences or drains.</li>
                    <li>Remove all dug scrap/litter from the land.</li>
                  </ul>
                </div>
              </div>

              <div data-pdf-block>
                <ReportSectionHeading>Insurance &amp; Liability</ReportSectionHeading>
                <div style={{ display: "grid", gap: 7, fontSize: 11.5, lineHeight: 1.62, color: REPORT.ink }}>
                  <p style={{ margin: 0 }}>6. The Detectorist confirms they hold current Public/Third Party Liability Insurance and will provide proof on request. Insurer/body: <strong>{ncmdNumber ? (insuranceProvider || "Membership") : "________________"}</strong>. Policy/Member No: <strong>{ncmdNumber || "________________"}</strong>.</p>
                  <p style={{ margin: 0 }}>7. The Detectorist is responsible for their own conduct and for damage, loss, or injury caused by their detecting activities, except where caused by the Landowner's negligence or another agreed exception.</p>
                </div>
              </div>

              <div data-pdf-block>
                <ReportSectionHeading>Finds, Recording &amp; Confidentiality</ReportSectionHeading>
                <div style={{ display: "grid", gap: 7, fontSize: 11.5, lineHeight: 1.62, color: REPORT.ink }}>
                  <p style={{ margin: 0 }}>8. The Detectorist will show finds to the Landowner at the end of each session, or as otherwise agreed.</p>
                  <p style={{ margin: 0 }}>9. Archaeological finds may be recorded with the Portable Antiquities Scheme (PAS), Historic Environment Record (HER), or a museum where appropriate. The Detectorist and Landowner should agree what location precision and confidentiality limits are suitable before any public record is made.</p>
                  <p style={{ margin: 0 }}>10. The Detectorist will not publish or share the land name, location, maps, or identifiable imagery, including on social media, without the Landowner's prior consent.</p>
                </div>
              </div>

              <div data-pdf-block>
                <ReportSectionHeading>Treasure</ReportSectionHeading>
                <div style={{ fontSize: 11.5, lineHeight: 1.62, color: REPORT.ink }}>
                  <p style={{ margin: 0 }}>11. Potential Treasure must be reported in accordance with the Treasure Act process within 14 days of discovery or of realising the find may be Treasure. The Landowner will be informed as soon as reasonably possible.</p>
                </div>
              </div>

              <div data-pdf-block>
                <ReportSectionHeading>Ownership &amp; Reward / Value Split</ReportSectionHeading>
                <div style={{ fontSize: 11.5, lineHeight: 1.62, color: REPORT.ink }}>
                  <p style={{ margin: "0 0 5px" }}>12A. Non-treasure finds:</p>
                  <ul style={{ margin: "0 0 7px", paddingLeft: 18 }}>
                    <li>Modern low-value items may be kept or disposed of as agreed with the Landowner.</li>
                    <li>Any value threshold, sale decision, or split should be agreed in writing before detecting starts.</li>
                    <li>Items of clear personal or sentimental value to the Landowner, such as engraved items or farm tokens, should be returned unless otherwise agreed.</li>
                  </ul>
                  <p style={{ margin: 0 }}>12B. Treasure reward: Any Treasure reward split should be agreed in writing between the eligible parties, taking account of the Treasure process and any official valuation or reward decision.</p>
                </div>
              </div>

              <div data-pdf-block>
                <ReportSectionHeading>Variation &amp; Termination</ReportSectionHeading>
                <div style={{ display: "grid", gap: 7, fontSize: 11.5, lineHeight: 1.62, color: REPORT.ink }}>
                  <p style={{ margin: 0 }}>13. Any changes to this agreement should be confirmed in writing, including by email or text, so both parties can refer back to the same terms.</p>
                  <p style={{ margin: 0 }}>14. The Landowner may terminate this agreement at any time. Serious breach, including damage, failing to follow instructions, or guests without permission, may result in immediate termination.</p>
                </div>
              </div>
              </>
              )}

              <div data-pdf-block style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 34, marginTop: 10 }}>
                {[
                  { label: isClubRallyAgreement ? "Landowner / Occupier Signature" : "Landowner Signature", signature: landownerSignature },
                  { label: isClubRallyAgreement ? "Organiser Signature" : "Detectorist Signature", signature: detectoristSignature },
                ].map(({ label, signature }) => (
                  <div key={label} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ height: 78, borderBottom: `1px solid ${REPORT.ink}`, display: "flex", alignItems: "flex-end", justifyContent: "center", background: REPORT.panel }}>
                      {signature && <img src={signature} alt={label} style={{ maxHeight: "100%", maxWidth: "100%" }} />}
                    </div>
                    <div style={{ fontSize: 8, letterSpacing: "0.12em", textTransform: "uppercase", color: REPORT.muted, fontWeight: 800, textAlign: "center", fontFamily: "sans-serif" }}>{label}</div>
                  </div>
                ))}
              </div>

              <ReportFooter reference={agreementReference} generatedAt={generatedAt} />
            </div>
          </div>
        </div>

        {/* Interaction Area (Not captured in PDF) */}
        <div className="grid gap-6 border-t-2 border-gray-100 dark:border-gray-700 pt-6">
          <div className="grid sm:grid-cols-2 gap-4">
            <SignaturePad 
              label={isClubRallyAgreement ? "Sign here: Landowner / Occupier" : "Sign here: Landowner"} 
              onSave={handleLandownerSignature}
              className="dark:text-white"
            />
            <SignaturePad 
              label={isClubRallyAgreement ? "Sign here: Organiser" : "Sign here: Detectorist"} 
              onSave={handleDetectoristSignature}
              className="dark:text-white"
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleDownloadPDF}
              disabled={generating || sharing}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-4 rounded-xl font-bold shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {generating ? "Generating PDF..." : savedAgreement ? "Download Agreement PDF" : "Save Agreement PDF"}
            </button>
            {canShare && (
              <button
                onClick={handleSharePDF}
                disabled={generating || sharing}
                className="sm:w-auto bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-6 py-4 rounded-xl font-bold hover:bg-gray-200 dark:hover:bg-gray-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {sharing ? "Sharing..." : "Share"}
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
