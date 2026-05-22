import React, { useRef, useState, useEffect } from "react";
import { Modal } from "./Modal";
import { db, Permission, Media } from "../db";
import { SignaturePad } from "./SignaturePad";
import { v4 as uuid } from "uuid";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { getSetting } from "../services/data";
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
  
  const agreementRef = useRef<HTMLDivElement>(null);
  const generatedAtRef = useRef(new Date());
  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  useEffect(() => {
    getSetting("detectorist", "").then(setDetectoristName);
    getSetting("detectoristEmail", "").then(setDetectoristEmail);
    getSetting("insuranceProvider", "").then(setInsuranceProvider);
    getSetting("ncmdNumber", "").then(setNcmdNumber);
  }, []);

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
    const agreementReference = `FS-AGREE-${generatedAt.toISOString().slice(0, 10).replace(/-/g, "")}-${props.permission.id.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase() || "LOCAL"}`;
    applyReportPdfMetadata(pdf, {
      title: `Landowner Agreement - ${props.permission.name}`,
      subject: `${agreementReference} generated by FindSpot for permission agreement review.`,
      reference: agreementReference,
      generatedAt,
    });

    const safeName = props.permission.name.replace(/[^a-z0-9]/gi, "-").toLowerCase();
    const filename = `landowner-agreement-${safeName}-${new Date().toISOString().slice(0, 10)}.pdf`;
    return { blob: pdf.output("blob"), filename };
  }

  function requireSignatures() {
    if (!landownerSignature || !detectoristSignature) {
      setError("Both signatures are required.");
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
      caption: "Landowner Agreement",
      scalePresent: false,
      createdAt: new Date().toISOString(),
    };

    await db.media.add(media);
    await db.permissions.update(props.permission.id, { agreementId: mediaId });

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
      await navigator.share({ files: [file], title: `Landowner Agreement — ${props.permission.name}` });
    } catch (err: any) {
      if ((err as DOMException).name !== "AbortError") {
        setError("Share failed: " + (err.message || err));
      }
    } finally {
      setSharing(false);
    }
  }

  const generatedAt = generatedAtRef.current;
  const agreementReference = `FS-AGREE-${generatedAt.toISOString().slice(0, 10).replace(/-/g, "")}-${props.permission.id.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase() || "LOCAL"}`;

  return (
    <Modal title="Landowner Agreement" onClose={props.onClose}>
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
          {AGREEMENT_DISCLAIMER}
        </div>

        {savedAgreement && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
            <strong>Agreement saved successfully.</strong>
            <span className="block mt-1">{savedAgreement.filename}</span>
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
              typeLabel="Landowner Agreement"
              title={props.permission.name}
              subtitle="Metal Detecting & Archaeological Recovery"
              reference={agreementReference}
              conductedBy={detectoristName || "Detectorist"}
              insuranceText={ncmdNumber ? `${insuranceProvider || "Membership"} No. ${ncmdNumber}` : null}
              dateText={`Prepared ${formatReportDate(generatedAt, "long")}`}
              descriptor="Agreement template prepared for landowner and detectorist review before signing."
            />

            <div style={reportBodyStyle}>
              <div data-pdf-block style={{ border: `1px solid ${REPORT.line}`, borderRadius: 10, background: REPORT.panel, padding: "13px 15px", fontSize: 11, lineHeight: 1.55, color: REPORT.muted, fontFamily: "sans-serif" }}>
                <strong style={{ color: REPORT.ink }}>Template notice:</strong> {AGREEMENT_DISCLAIMER}
              </div>

              <ReportSummaryRows
                title="Agreement Details"
                rows={[
                  { label: "Agreement date", value: formatReportDate(generatedAt, "long") || generatedAt.toLocaleDateString() },
                  { label: "Landowner", value: `${props.permission.landownerName || "____________________"}${props.permission.landownerAddress ? `, ${props.permission.landownerAddress}` : ""}` },
                  { label: "Detectorist", value: `${detectoristName || "____________________"}${detectoristEmail ? ` (${detectoristEmail})` : ""}` },
                  { label: "Land / permission", value: props.permission.name },
                ]}
              />

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

              <div data-pdf-block style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 34, marginTop: 10 }}>
                {[
                  { label: "Landowner Signature", signature: landownerSignature },
                  { label: "Detectorist Signature", signature: detectoristSignature },
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
              label="Sign here: Landowner" 
              onSave={handleLandownerSignature}
              className="dark:text-white"
            />
            <SignaturePad 
              label="Sign here: Detectorist" 
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
