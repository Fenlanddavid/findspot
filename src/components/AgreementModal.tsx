import React, { useRef, useState, useEffect } from "react";
import { Modal } from "./Modal";
import { db, Permission, Media } from "../db";
import { SignaturePad } from "./SignaturePad";
import { v4 as uuid } from "uuid";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { getSetting } from "../services/data";

export function AgreementModal(props: {
  permission: Permission;
  onClose: () => void;
  onSaved: (mediaId: string) => void;
}) {
  const [detectoristName, setDetectoristName] = useState("");
  const [detectoristEmail, setDetectoristEmail] = useState("");
  const [ncmdNumber, setNcmdNumber] = useState("");
  
  const [landownerSignature, setLandownerSignature] = useState<string | null>(null);
  const [detectoristSignature, setDetectoristSignature] = useState<string | null>(null);
  
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const agreementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getSetting("detectorist", "").then(setDetectoristName);
    getSetting("detectoristEmail", "").then(setDetectoristEmail);
    getSetting("ncmdNumber", "").then(setNcmdNumber);
  }, []);

  const handleSave = async () => {
    if (!landownerSignature || !detectoristSignature) {
      setError("Both signatures are required.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (!agreementRef.current) return;
      
      const pdf = new jsPDF("p", "mm", "a4");
      const pdfWidth = pdf.internal.pageSize.getWidth();

      // Use the html method for smarter page breaking
      // We must pass the element directly. It uses html2canvas internally.
      await pdf.html(agreementRef.current, {
        callback: async (doc) => {
          const pdfBlob = doc.output("blob");
          const mediaId = uuid();
          const fileName = `Agreement_${props.permission.name.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.pdf`;
          
          const media: Media = {
            id: mediaId,
            projectId: props.permission.projectId,
            permissionId: props.permission.id,
            type: "document",
            filename: fileName,
            mime: "application/pdf",
            blob: pdfBlob,
            caption: "Landowner Agreement",
            scalePresent: false,
            createdAt: new Date().toISOString(),
          };

          await db.media.add(media);
          await db.permissions.update(props.permission.id, { agreementId: mediaId });
          
          props.onSaved(mediaId);
          setSaving(false);
        },
        x: 0,
        y: 0,
        width: pdfWidth, // target width in pdf units
        windowWidth: 800, // width of the virtual window
        autoPaging: "text", // try to avoid breaking in middle of lines
      });
    } catch (err: any) {
      setError("Failed to save agreement: " + err.message);
      setSaving(false);
    }
  };

  const handleEmail = async () => {
    const mailto = `mailto:${props.permission.landownerEmail || ""}?subject=Landowner Agreement - ${props.permission.name}&body=Hi ${props.permission.landownerName || "Landowner"},%0D%0A%0D%0APlease find attached the signed landowner agreement for metal detecting at ${props.permission.name}.%0D%0A%0D%0ABest regards,%0D%0A${detectoristName}`;
    window.location.href = mailto;
  };

  return (
    <Modal title="Landowner Agreement" onClose={props.onClose}>
      <div className="grid gap-6 max-h-[80vh] overflow-y-auto pr-2 pb-6">
        {error && (
          <div className="bg-red-50 text-red-800 p-3 rounded-xl text-sm font-medium border border-red-100 animate-in fade-in slide-in-from-top-2">
            ⚠️ {error}
          </div>
        )}

        {/* This div is what we capture as PDF */}
        <div className="w-full overflow-x-auto rounded-xl border border-gray-200 shadow-sm bg-white/50 dark:bg-black/20 p-1">
          <div 
            ref={agreementRef} 
            className="bg-white text-black p-8 font-serif leading-relaxed mx-auto"
            style={{ width: "800px" }} // Fixed width for consistent capture
          >
            <div className="text-center mb-10 border-b-2 border-black pb-4">
              <h1 className="text-3xl font-black uppercase tracking-tighter m-0">Landowner Agreement</h1>
              <p className="text-sm font-mono opacity-50 m-0 mt-1">Metal Detecting & Archaeological Recovery</p>
            </div>

            <div className="grid gap-4 text-sm mb-8">
              <p><strong>This Agreement is made on:</strong> {new Date().toLocaleDateString()}</p>
              <p><strong>Between (The Landowner):</strong> {props.permission.landownerName || "____________________"} of {props.permission.landownerAddress || "____________________"}</p>
              <p><strong>And (The Detectorist):</strong> {detectoristName || "____________________"}{detectoristEmail ? ` (${detectoristEmail})` : ""}</p>
              <p><strong>Regarding the Land at:</strong> {props.permission.name}</p>
            </div>

            <div className="text-[11px] space-y-3 text-justify leading-snug">
              <p className="font-bold border-b border-gray-100 pb-1" style={{ breakInside: "avoid" }}>Permission</p>
              <p style={{ breakInside: "avoid" }}>1. The Landowner grants the Detectorist permission to enter the Permitted Areas on foot to search with a metal detector.</p>
              <p style={{ breakInside: "avoid" }}>2. This permission is personal to the Detectorist and is not transferable. No guests/other detectorists may attend unless agreed in advance by the Landowner in writing/text.</p>

              <p className="font-bold border-b border-gray-100 pb-1 mt-2" style={{ breakInside: "avoid" }}>Good practice & legal compliance</p>
              <p style={{ breakInside: "avoid" }}>3. The Detectorist will follow the Code of Practice for Responsible Metal Detecting and all reasonable instructions given by the Landowner.</p>
              <p style={{ breakInside: "avoid" }}>4. The Detectorist will not detect on protected/restricted areas (e.g., scheduled/protected archaeology) and will comply with all applicable laws.</p>

              <p className="font-bold border-b border-gray-100 pb-1 mt-2" style={{ breakInside: "avoid" }}>Ground care, crops, livestock</p>
              <div className="pl-4 space-y-1" style={{ breakInside: "avoid" }}>
                <p>5. The Detectorist will:</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>Use a neat plug method where appropriate, minimise disturbance, and fully reinstate ground.</li>
                  <li>Stop if conditions risk damage (e.g., waterlogged ground).</li>
                  <li>Keep to headlands/tramlines if requested; avoid standing crops unless agreed.</li>
                  <li>Leave gates as found, avoid livestock, and not damage fences/drains.</li>
                  <li>Remove all dug scrap/litter from the land.</li>
                </ul>
              </div>

              <p className="font-bold border-b border-gray-100 pb-1 mt-2" style={{ breakInside: "avoid" }}>Insurance & liability</p>
              <p style={{ breakInside: "avoid" }}>6. The Detectorist confirms they hold current Public/Third Party Liability Insurance and will provide proof on request. 
                 <br/><strong>Insurer/body:</strong> {ncmdNumber ? "NCMD/FID" : "________________"} &nbsp;&nbsp; <strong>Policy/Member No:</strong> {ncmdNumber || "________________"}</p>
              <p style={{ breakInside: "avoid" }}>7. The Detectorist accepts responsibility for their own safety and agrees to indemnify the Landowner against claims arising from the Detectorist’s activities, except where caused by the Landowner’s negligence.</p>

              <p className="font-bold border-b border-gray-100 pb-1 mt-2" style={{ breakInside: "avoid" }}>Finds: showing, recording, and confidentiality</p>
              <p style={{ breakInside: "avoid" }}>8. The Detectorist will show all finds to the Landowner within <strong>the end of each session</strong>, if requested.</p>
              <p style={{ breakInside: "avoid" }}>9. PAS/HER/Museum recording: The Detectorist may record appropriate finds with the Portable Antiquities Scheme (PAS) only with the Landowner’s consent. Location precision will be recorded to: <strong>Parish level / 6-figure grid accuracy</strong>.</p>
              <p style={{ breakInside: "avoid" }}>10. The Detectorist will not publish or share the land name, location, maps, or identifiable imagery (including on social media) without the Landowner’s prior consent.</p>

              <p className="font-bold border-b border-gray-100 pb-1 mt-2" style={{ breakInside: "avoid" }}>Treasure</p>
              <p style={{ breakInside: "avoid" }}>11. Potential Treasure must be reported in accordance with the Treasure Act process within 14 days of discovery/realisation (usually via the local Finds Liaison Officer/Coroner). The Landowner will be informed as soon as reasonably possible.</p>

              <p className="font-bold border-b border-gray-100 pb-1 mt-2" style={{ breakInside: "avoid" }}>Ownership and reward/value split</p>
              <div className="pl-4 space-y-1" style={{ breakInside: "avoid" }}>
                <p>12A. Non-treasure finds:</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>Detectorist may keep modern low-value items.</li>
                  <li>Items valued over £500 will be shared 50/50 or sold and proceeds split 50/50, unless otherwise agreed in writing.</li>
                  <li>Items of clear personal/sentimental value to the Landowner (e.g., engraved items, farm tokens) will be returned.</li>
                </ul>
                <p>12B. Treasure reward: Any Treasure reward will be split 50/50 between Landowner and Detectorist unless otherwise agreed in writing.</p>
              </div>

              <p className="font-bold border-b border-gray-100 pb-1 mt-2" style={{ breakInside: "avoid" }}>Termination</p>
              <p style={{ breakInside: "avoid" }}>14. The Landowner may terminate this agreement at any time. Serious breach (damage, failing to follow instructions, guests without permission, etc.) may result in immediate termination.</p>
            </div>

            <div className="mt-12 grid grid-cols-2 gap-12" style={{ breakInside: "avoid" }}>
              <div className="flex flex-col gap-2">
                <div className="h-20 border-b border-black flex items-end justify-center">
                  {landownerSignature && <img src={landownerSignature} alt="Landowner" className="max-h-full" />}
                </div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-center">Landowner Signature</p>
              </div>
              <div className="flex flex-col gap-2">
                <div className="h-20 border-b border-black flex items-end justify-center">
                  {detectoristSignature && <img src={detectoristSignature} alt="Detectorist" className="max-h-full" />}
                </div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-center">Detectorist Signature</p>
              </div>
            </div>
          </div>
        </div>

        {/* Interaction Area (Not captured in PDF) */}
        <div className="grid gap-6 border-t-2 border-gray-100 dark:border-gray-700 pt-6">
          <div className="grid sm:grid-cols-2 gap-4">
            <SignaturePad 
              label="Sign here: Landowner" 
              onSave={setLandownerSignature} 
              className="dark:text-white"
            />
            <SignaturePad 
              label="Sign here: Detectorist" 
              onSave={setDetectoristSignature} 
              className="dark:text-white"
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleSave}
              disabled={saving || !landownerSignature || !detectoristSignature}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-4 rounded-xl font-bold shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? "Generating PDF..." : "💾 Save Signed Agreement"}
            </button>
            <button
              onClick={handleEmail}
              className="sm:w-auto bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-6 py-4 rounded-xl font-bold hover:bg-gray-200 dark:hover:bg-gray-700 transition-all flex items-center justify-center gap-2"
            >
              ✉️ Email
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
