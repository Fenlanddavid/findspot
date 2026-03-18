import React, { useEffect, useState, useMemo } from "react";
import { Modal } from "./Modal";
import { db, Find, Media } from "../db";
import { generatePASDescription, calculateRecordingScore, getParishAndCounty } from "../services/pas";
import { getFLOForCounty } from "../services/flo";
import { getSetting } from "../services/data";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

interface PASReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  find: Find;
  photos: Media[];
}

const PASReportModal: React.FC<PASReportModalProps> = ({ isOpen, onClose, find, photos }) => {
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState({ parish: "Loading...", county: "Loading..." });
  const [flo, setFlo] = useState<{ name: string; email: string } | null>(null);
  const [userName, setUserName] = useState("");
  const [userInitials, setUserInitials] = useState("FS");
  const [dailyCount, setDailyCount] = useState(1);
  const [score, setScore] = useState({ score: 0, reasons: [] as string[] });
  const [generating, setGenerating] = useState(false);

  // Manage photo URLs centrally to avoid leaks and ensure they are ready for canvas
  const photoUrls = useMemo(() => {
    return photos.map(p => URL.createObjectURL(p.blob));
  }, [photos]);

  useEffect(() => {
    return () => {
      photoUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [photoUrls]);

  useEffect(() => {
    if (isOpen) {
      setDescription(generatePASDescription(find));
      setScore(calculateRecordingScore(find, photos.length));
      
      getSetting("detectorist", "").then(name => {
          setUserName(name);
          if (name) {
              const initials = name.split(" ").map((n: string) => n[0]).join("").toUpperCase();
              setUserInitials(initials);
          }
      });

      // Calculate how many finds were recorded on this day for the daily count
      const reportDate = new Date(find.createdAt).toISOString().split('T')[0];
      db.finds.where("createdAt").startsWith(reportDate).count().then(count => {
          setDailyCount(count || 1);
      });

      if (find.lat && find.lon) {
        getParishAndCounty(find.lat, find.lon).then(loc => {
            setLocation(loc);
            const matchedFlo = getFLOForCounty(loc.county);
            setFlo(matchedFlo);
        });
      }
    }
  }, [isOpen, find, photos]);

  const getPDFBlob = async (): Promise<Blob | null> => {
    const element = document.getElementById("pas-report-preview");
    if (!element) return null;
    
    // Scale 3 for high-resolution photo rendering in the PDF
    const canvas = await html2canvas(element, { 
        scale: 3,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff"
    });
    
    const imgData = canvas.toDataURL("image/jpeg", 0.95);
    const pdf = new jsPDF("p", "mm", "a4");
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
    
    pdf.addImage(imgData, "JPEG", 0, 0, pdfWidth, pdfHeight);
    return pdf.output("blob");
  };

  const generatePDF = async () => {
    setGenerating(true);
    try {
      const blob = await getPDFBlob();
      if (blob) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `PAS-Report-${find.findCode}.pdf`;
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      console.error("PDF generation failed", e);
    }
    setGenerating(false);
  };

  const sendEmail = async () => {
    setGenerating(true);
    const recipient = flo ? flo.email : "";
    const subject = `PAS Submission: ${find.objectType} - ${find.findCode}`;
    const body = `
Hi,

I would like to record the following find:

Object: ${find.objectType}
Period: ${find.period}
Material: ${find.material}
Weight: ${find.weightG}g
NGR: ${find.osGridRef}
Parish: ${location.parish}
County: ${location.county}

Description:
${description}

Recorded via FindSpot
    `;

    try {
      const blob = await getPDFBlob();
      if (blob && navigator.canShare && navigator.canShare({ files: [new File([blob], "report.pdf", { type: "application/pdf" })] })) {
        const file = new File([blob], `PAS-Report-${find.findCode}.pdf`, { type: "application/pdf" });
        await navigator.share({
          title: subject,
          text: body,
          files: [file]
        });
      } else {
        window.location.href = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      }
    } catch (e) {
      console.error("Sharing failed", e);
    }
    setGenerating(false);
  };

  if (!isOpen) return null;

  return (
    <Modal onClose={onClose} title="AUTO PAS REPORT BUILDER">
      <div className="flex flex-col gap-6">
        
        {/* Quality & Routing Header */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
                <div>
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Recording Quality</h3>
                    <p className="text-2xl font-black text-emerald-500">{score.score}%</p>
                </div>
                <div className="flex flex-col gap-1 text-right">
                    {score.score >= 80 ? (
                        <span className="text-[8px] text-emerald-500 font-bold uppercase">✅ Professional</span>
                    ) : (
                        <span className="text-[8px] text-amber-500 font-bold uppercase">⚠️ Missing</span>
                    )}
                </div>
            </div>

            <div className={`border rounded-2xl p-4 flex flex-col justify-center ${flo ? 'bg-blue-900/20 border-blue-500/30' : 'bg-slate-900 border-slate-800 opacity-50'}`}>
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Target FLO</h3>
                <p className="text-sm font-black text-blue-400 truncate">{flo ? flo.name : "Detecting Region..."}</p>
                <p className="text-[9px] text-slate-500 font-mono truncate">{flo ? flo.email : "Locating county..."}</p>
            </div>
        </div>

        {/* Data Quality Checklist */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Recording Checklist</h3>
            <div className="flex flex-col gap-2">
                <CheckItem label="GPS Coordinates" status={!!(find.lat && find.lon)} />
                <CheckItem label="Object Weight" status={!!find.weightG} />
                <CheckItem label="Dimensions (Width/Height)" status={!!(find.widthMm || find.heightMm)} />
                <CheckItem label="Photos (Min 1)" status={photos.length >= 1} />
                <CheckItem label="Multi-Angle Photos (Min 3)" status={photos.length >= 3} />
            </div>
            {score.reasons.length > 0 && (
                <div className="mt-4 pt-3 border-t border-white/5">
                    <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-1">How to reach 100%:</p>
                    <ul className="list-none p-0 m-0 flex flex-col gap-1">
                        {score.reasons.map((r, i) => (
                            <li key={i} className="text-[11px] text-slate-400 font-medium">↳ {r}</li>
                        ))}
                    </ul>
                </div>
            )}
        </div>

        {/* Report Preview Card */}
        <div className="overflow-x-auto">
            <div id="pas-report-preview" className="min-w-[600px] bg-white text-black p-12 shadow-xl border border-gray-200 font-serif">
                <div className="flex justify-between items-start border-b-2 border-black pb-4 mb-8">
                    <div>
                        <h1 className="text-3xl font-black uppercase tracking-tighter italic leading-none mb-4">
                            {userName ? `${userName} PAS Report` : "PAS Report"}
                        </h1>
                        <p className="text-[11px] font-bold font-sans uppercase tracking-widest opacity-70">
                            Record ID: {userInitials}-{new Date(find.createdAt).toISOString().split('T')[0].replace(/-/g, "")}-{dailyCount}
                        </p>
                    </div>
                    <div className="text-right text-[10px] font-sans font-bold uppercase tracking-widest">
                        <p>Recorded: {new Date(find.createdAt).toLocaleDateString()}</p>
                        <p>NGR: {find.osGridRef}</p>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-10 mb-10">
                    <div className="flex flex-col gap-8">
                        <section>
                            <h3 className="text-[10px] font-bold uppercase border-b-2 border-black pb-1 mb-2 font-sans tracking-widest">Classification</h3>
                            <div className="flex flex-col gap-1 text-sm">
                                <p><span className="font-bold uppercase text-[10px] mr-2 opacity-50 font-sans">Object</span> {find.objectType}</p>
                                <p><span className="font-bold uppercase text-[10px] mr-2 opacity-50 font-sans">Period</span> {find.period}</p>
                                <p><span className="font-bold uppercase text-[10px] mr-2 opacity-50 font-sans">Material</span> {find.material}</p>
                                <p><span className="font-bold uppercase text-[10px] mr-2 opacity-50 font-sans">Weight</span> {find.weightG}g</p>
                            </div>
                        </section>
                        <section>
                            <h3 className="text-[10px] font-bold uppercase border-b-2 border-black pb-1 mb-2 font-sans tracking-widest">Location</h3>
                            <div className="flex flex-col gap-1 text-sm">
                                <p><span className="font-bold uppercase text-[10px] mr-2 opacity-50 font-sans">Parish</span> {location.parish}</p>
                                <p><span className="font-bold uppercase text-[10px] mr-2 opacity-50 font-sans">County</span> {location.county}</p>
                                <p><span className="font-bold uppercase text-[10px] mr-2 opacity-50 font-sans">Grid Ref</span> {find.osGridRef}</p>
                            </div>
                        </section>
                    </div>

                    {/* High-Res Photo Plate */}
                    <div className={`grid gap-2 ${photoUrls.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                        {photoUrls.map((url, i) => (
                            <div key={i} className="bg-gray-50 border border-gray-200 p-2 rounded-lg aspect-square flex items-center justify-center overflow-hidden shadow-inner">
                                <img src={url} className="max-h-full w-full object-contain" alt={`Plate ${i+1}`} />
                            </div>
                        ))}
                        {photoUrls.length === 0 && (
                            <div className="bg-gray-50 border border-gray-100 p-8 rounded-lg aspect-square flex items-center justify-center text-center">
                                <p className="text-gray-300 text-[10px] uppercase font-sans font-bold tracking-widest">No documentation images available</p>
                            </div>
                        )}
                    </div>
                </div>

                <section className="mb-12">
                    <h3 className="text-[10px] font-bold uppercase border-b-2 border-black pb-1 mb-3 font-sans tracking-widest">Archaeological Description</h3>
                    <textarea 
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className="w-full bg-transparent border-none p-0 text-[15px] leading-relaxed outline-none resize-none font-serif min-h-[150px] italic text-gray-800"
                    />
                </section>

                <div className="border-t-2 border-black pt-6 flex justify-between items-center opacity-40 text-[10px] font-sans font-bold uppercase tracking-[0.2em]">
                    <p>Verified via FindSpot</p>
                    <p>facebook.com/FindSpot</p>
                </div>
            </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-3 mt-2">
            <button 
                onClick={generatePDF}
                disabled={generating}
                className="bg-slate-800 hover:bg-slate-700 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 uppercase tracking-widest text-[10px] border border-white/10 transition-all active:scale-95"
            >
                {generating ? "..." : (
                    <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Download PDF
                    </>
                )}
            </button>
            <button 
                onClick={sendEmail}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 uppercase tracking-widest text-[10px] shadow-lg shadow-emerald-900/20 transition-all active:scale-95"
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
                Send to FLO
            </button>
        </div>

      </div>
    </Modal>
  );
};

function CheckItem({ label, status }: { label: string; status: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs font-bold text-slate-300">{label}</span>
      {status ? (
        <span className="text-emerald-500 font-black text-[10px] bg-emerald-500/10 px-2 py-1 rounded uppercase tracking-tighter">Verified</span>
      ) : (
        <span className="text-slate-600 font-black text-[10px] bg-slate-800 px-2 py-1 rounded uppercase tracking-tighter">Missing</span>
      )}
    </div>
  );
}

export default PASReportModal;
