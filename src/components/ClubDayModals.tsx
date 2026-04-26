import React, { useState, useEffect, useRef } from "react";
import QRCode from "qrcode";
import { db, Field } from "../db";
import { createClubDayPack, exportClubDayData, mergeClubDayData, ClubDayMergeResult, getSetting, setSetting } from "../services/data";

// ─── Build join URL from event details ───────────────────────────────────────

function buildJoinUrl(params: {
  sid: string;
  name: string;
  date: string;
  contact: string;
  email: string;
  instructions: string;
  publicNotes: string;
}): string {
  const base = window.location.origin + import.meta.env.BASE_URL + "join";
  const q = new URLSearchParams();
  q.set("sid", params.sid);
  if (params.name)         q.set("n", params.name);
  if (params.date)         q.set("d", params.date);
  if (params.contact)      q.set("c", params.contact);
  if (params.email)        q.set("e", params.email);
  if (params.instructions) q.set("i", params.instructions);
  if (params.publicNotes)  q.set("p", params.publicNotes);
  return `${base}?${q.toString()}`;
}

// ─── QR display screen ────────────────────────────────────────────────────────

function QRScreen({
  joinUrl,
  permissionName,
  eventName,
  onBack,
  onClose,
}: {
  joinUrl: string;
  permissionName: string;
  eventName: string;
  onBack: () => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrReady, setQrReady] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, joinUrl, {
      width: 240,
      margin: 2,
      color: { dark: "#134e4a", light: "#f0fdfa" },
    }).then(() => setQrReady(true)).catch(console.error);
  }, [joinUrl]);

  async function handleShare() {
    if (navigator.share) {
      try {
        await navigator.share({ title: `Join ${permissionName} on FindSpot`, url: joinUrl });
        return;
      } catch { /* fall through */ }
    }
    handleCopy();
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(joinUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <div className="p-5 space-y-5 overflow-y-auto flex-1 flex flex-col items-center">
      <div className="text-center space-y-1">
        <div className="text-[9px] font-black uppercase tracking-widest text-teal-500">Ready to share</div>
        <h3 className="font-black text-gray-900 dark:text-gray-100">{eventName || permissionName}</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">Members scan the QR or use the link below. Works on any phone.</p>
      </div>

      {/* QR code */}
      <div className="bg-teal-50 dark:bg-teal-950/30 rounded-2xl p-4 flex items-center justify-center border border-teal-200 dark:border-teal-800">
        <canvas ref={canvasRef} className={`rounded-xl transition-opacity ${qrReady ? "opacity-100" : "opacity-0"}`} />
        {!qrReady && (
          <div className="w-60 h-60 flex items-center justify-center text-teal-400 animate-pulse text-sm font-bold">
            Generating…
          </div>
        )}
      </div>

      {/* Shareable link */}
      <div className="w-full">
        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5">Join link — share via WhatsApp, email, etc.</p>
        <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5">
          <span className="flex-1 text-[10px] font-mono text-gray-600 dark:text-gray-400 truncate select-all">{joinUrl}</span>
          <button
            onClick={handleCopy}
            className={`shrink-0 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg transition-all ${copied ? "bg-emerald-600 text-white" : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"}`}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>

      {/* Action buttons */}
      <div className="w-full grid gap-2">
        {!!navigator.share && (
          <button
            onClick={handleShare}
            className="w-full py-3 rounded-xl border-2 border-teal-300 dark:border-teal-700 text-[10px] font-black uppercase tracking-widest text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors"
          >
            Share via…
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Create Club Day Pack Modal ───────────────────────────────────────────────

export function CreateClubDayPackModal({
  permissionId,
  permissionName,
  organiserContactNumber,
  organiserEmail: organiserEmailProp,
  significantFindInstructions,
  clubDayPublicNotes,
  fields,
  onClose,
}: {
  permissionId: string;
  permissionName: string;
  organiserContactNumber?: string;
  organiserEmail?: string;
  significantFindInstructions?: string;
  clubDayPublicNotes?: string;
  fields: Field[];
  onClose: () => void;
}) {
  const [selectedFieldIds, setSelectedFieldIds] = useState<Set<string>>(
    new Set(fields.map(f => f.id))
  );
  const [eventName, setEventName] = useState(permissionName);
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [contactNumber, setContactNumber] = useState(organiserContactNumber ?? "");
  const [organiserEmail, setOrganiserEmail] = useState(organiserEmailProp ?? "");
  const [sigFindInstructions, setSigFindInstructions] = useState(
    significantFindInstructions ?? "Stop digging and contact the organiser immediately."
  );
  const [publicNotes, setPublicNotes] = useState(clubDayPublicNotes ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  const [sharedPermissionId, setSharedPermissionId] = useState<string | null>(null);

  function toggleField(id: string) {
    setSelectedFieldIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleGenerate() {
    setSaving(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      await db.permissions.update(permissionId, {
        name: eventName.trim() || permissionName,
        validFrom: eventDate || undefined,
        organiserContactNumber: contactNumber || undefined,
        organiserEmail: organiserEmail || undefined,
        significantFindInstructions: sigFindInstructions || undefined,
        clubDayPublicNotes: publicNotes || undefined,
        updatedAt: now,
      });

      // Ensure sharedPermissionId is set (createClubDayPack does this)
      // We also need it for the URL, so call the function and read it back
      await createClubDayPack(permissionId, Array.from(selectedFieldIds));
      const updated = await db.permissions.get(permissionId);
      const sid = (updated as any)?.sharedPermissionId ?? permissionId;
      setSharedPermissionId(sid);

      const perm = await db.permissions.get(permissionId);
      const url = buildJoinUrl({
        sid,
        name: perm?.name ?? (eventName.trim() || permissionName),
        date: eventDate,
        contact: contactNumber,
        email: organiserEmail,
        instructions: sigFindInstructions,
        publicNotes: publicNotes,
      });
      setJoinUrl(url);
    } catch (e: any) {
      setError(e?.message ?? "Failed to generate Club Day pack");
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-teal-500 outline-none transition-all";
  const labelClass = "text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 block";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg shadow-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-5 pb-3 border-b border-gray-100 dark:border-gray-800 shrink-0 flex items-center justify-between">
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest text-teal-500 mb-1">Club / Rally Dig</div>
            <h2 className="font-black text-gray-900 dark:text-gray-100">
              {joinUrl ? "Share with Members" : "Set Up Club/Rally"}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg">✕</button>
        </div>

        {joinUrl && sharedPermissionId ? (
          <QRScreen
            joinUrl={joinUrl}
            permissionName={permissionName}
            eventName={eventName}
            onBack={() => setJoinUrl(null)}
            onClose={onClose}
          />
        ) : (
          <>
            <div className="p-5 space-y-5 overflow-y-auto flex-1">
              {error && (
                <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-300">
                  {error}
                </div>
              )}

              <div>
                <label className={labelClass}>Event name</label>
                <input
                  type="text"
                  value={eventName}
                  onChange={e => setEventName(e.target.value)}
                  placeholder="e.g. Summer Rally 2026"
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Event date</label>
                <input
                  type="date"
                  value={eventDate}
                  onChange={e => setEventDate(e.target.value)}
                  className={inputClass}
                />
              </div>

              {/* Field selector */}
              {fields.length > 0 && (
                <div>
                  <label className={labelClass}>Fields to include</label>
                  <p className="text-[10px] text-gray-400 mb-2">Select which fields are active for this event — useful for multi-day rallies.</p>
                  <div className="grid gap-2">
                    {fields.map(f => (
                      <label key={f.id} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 cursor-pointer hover:border-teal-400 transition-colors">
                        <input
                          type="checkbox"
                          checked={selectedFieldIds.has(f.id)}
                          onChange={() => toggleField(f.id)}
                          className="w-4 h-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-sm text-gray-800 dark:text-gray-100">{f.name}</div>
                          {f.notes && <div className="text-[10px] text-gray-400 truncate">{f.notes}</div>}
                        </div>
                        <span className="text-[9px] font-bold text-teal-600 dark:text-teal-400">
                          {f.boundary ? "Mapped" : "No boundary"}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className={labelClass}>Your contact number (shown to members)</label>
                <input
                  type="tel"
                  value={contactNumber}
                  onChange={e => setContactNumber(e.target.value)}
                  placeholder="e.g. 07123 456789"
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Export email address (members send finds here)</label>
                <input
                  type="email"
                  value={organiserEmail}
                  onChange={e => setOrganiserEmail(e.target.value)}
                  placeholder="e.g. organiser@example.com"
                  className={inputClass}
                  autoCapitalize="off"
                  autoCorrect="off"
                />
                <p className="text-[10px] text-gray-400 mt-1">Members will see this on their export screen so they know where to send their data.</p>
              </div>

              <div>
                <label className={labelClass}>Significant find instructions</label>
                <textarea
                  value={sigFindInstructions}
                  onChange={e => setSigFindInstructions(e.target.value)}
                  rows={2}
                  className={`${inputClass} resize-none`}
                />
              </div>

              <div>
                <label className={labelClass}>Public notes (optional)</label>
                <textarea
                  value={publicNotes}
                  onChange={e => setPublicNotes(e.target.value)}
                  rows={2}
                  placeholder="Parking details, site rules, timings…"
                  className={`${inputClass} resize-none`}
                />
              </div>

              <label className="flex items-start gap-3 cursor-pointer p-3 bg-teal-50 dark:bg-teal-950/20 border border-teal-200 dark:border-teal-800 rounded-xl">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={e => setConfirmed(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                />
                <span className="text-xs text-teal-700 dark:text-teal-300 font-medium leading-relaxed">
                  Landowner details, agreements and private notes will not be shared with members.
                </span>
              </label>
            </div>

            <div className="p-5 pt-3 border-t border-gray-100 dark:border-gray-800 flex gap-3 shrink-0">
              <button onClick={onClose} className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-gray-500 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl transition-colors">
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                disabled={!confirmed || saving}
                className="flex-1 bg-teal-600 hover:bg-teal-500 disabled:opacity-40 disabled:cursor-not-allowed text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
              >
                {saving ? "Generating…" : "Generate QR"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Export Club Day Data Modal ───────────────────────────────────────────────

export function ExportClubDayModal({
  permissionId,
  sharedPermissionId,
  permissionName,
  organiserEmail,
  onClose,
}: {
  permissionId: string;
  sharedPermissionId: string;
  permissionName: string;
  organiserEmail?: string;
  onClose: () => void;
}) {
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [exportedFile, setExportedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recorderName, setRecorderName] = useState("");

  useEffect(() => {
    getSetting<string>("recorderName", "").then(v => { if (v) setRecorderName(v); });
  }, []);

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      if (recorderName.trim()) {
        await setSetting("recorderName", recorderName.trim());
      }
      const json = await exportClubDayData(sharedPermissionId, recorderName.trim() || undefined);
      const filename = `clubday-export-${permissionName.replace(/[^a-z0-9]/gi, "_").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;
      const file = new File([json], filename, { type: "application/json" });

      // Always download first — most reliable across all devices
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      await db.permissions.update(permissionId, { submittedAt: new Date().toISOString() });
      setExportedFile(file);
      setExported(true);
    } catch (e: any) {
      setError(e?.message ?? "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function handleShareFile() {
    if (!exportedFile) return;
    if (navigator.share) {
      try {
        await navigator.share({ files: [exportedFile], title: `Club Day Export — ${permissionName}` });
        return;
      } catch (e: any) {
        if (e?.name === "AbortError") return; // user cancelled — don't re-download
        // NotSupportedError or similar — fall through to re-download
      }
    }
    // Fallback: re-download
    const url = URL.createObjectURL(exportedFile);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportedFile.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  const mailtoHref = organiserEmail
    ? `mailto:${organiserEmail}?subject=${encodeURIComponent(`Club Day Finds — ${permissionName}`)}&body=${encodeURIComponent(`Hi,\n\nPlease find my Club Day export for ${permissionName} attached.\n\n${recorderName || ""}`.trim())}`
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md shadow-2xl p-6" onClick={e => e.stopPropagation()}>
        <div className="text-[9px] font-black uppercase tracking-widest text-teal-500 mb-1">Club Day</div>
        <h2 className="font-black text-gray-900 dark:text-gray-100 mb-2">Export Your Club Day Data</h2>

        {exported ? (
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center mx-auto text-xl font-black text-teal-600">✓</div>
            <p className="text-sm text-center text-gray-600 dark:text-gray-400">
              File saved to your device. Now send it to the organiser.
            </p>
            <button
              onClick={handleShareFile}
              className="w-full py-3 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
            >
              Share File…
            </button>
            {organiserEmail && (
              <div className="p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl space-y-3">
                <div className="text-[9px] font-black uppercase tracking-widest text-gray-400">Or send via email</div>
                <p className="text-xs text-gray-500 dark:text-gray-400 font-bold break-all">{organiserEmail}</p>
                <a
                  href={mailtoHref!}
                  className="flex items-center justify-center w-full py-2.5 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
                >
                  Open Email App
                </a>
                <p className="text-[10px] font-bold text-gray-700 dark:text-gray-200 text-center">Attach the file from your Downloads folder.</p>
              </div>
            )}
            <button onClick={onClose} className="w-full py-3 text-[10px] font-black uppercase tracking-widest text-gray-500 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl transition-colors">
              Done
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 leading-relaxed">
              This exports only your sessions and finds from <strong>{permissionName}</strong>. Send the file to the organiser so they can merge it into their record.
            </p>

            <div className="mb-4">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1.5">
                Your name
              </label>
              <input
                type="text"
                value={recorderName}
                onChange={e => setRecorderName(e.target.value)}
                placeholder="e.g. John Smith"
                className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                autoComplete="name"
              />
              <p className="text-[10px] text-gray-400 mt-1.5">Shown to the organiser alongside your finds.</p>
            </div>

            {organiserEmail && (
              <div className="mb-4 px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl flex items-center gap-2">
                <span className="text-base">✉️</span>
                <div className="min-w-0">
                  <div className="text-[9px] font-black uppercase tracking-widest text-gray-400">Send to</div>
                  <div className="text-xs font-bold text-gray-700 dark:text-gray-300 truncate">{organiserEmail}</div>
                </div>
              </div>
            )}

            {error && (
              <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-300">
                {error}
              </div>
            )}

            <div className="p-3 bg-teal-50 dark:bg-teal-950/20 border border-teal-200 dark:border-teal-800 rounded-xl text-xs text-teal-700 dark:text-teal-300 mb-5">
              No server. No account. Your data is only shared when you export it.
            </div>

            <div className="flex gap-3">
              <button onClick={onClose} className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-gray-500 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl transition-colors">
                Cancel
              </button>
              <button
                onClick={handleExport}
                disabled={exporting}
                className="flex-1 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
              >
                {exporting ? "Exporting…" : "Export & Send"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Import Club Day Data Modal (Organiser merge) ─────────────────────────────

export function ImportClubDayDataModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ClubDayMergeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImporting(true);
    setResult(null);
    setError(null);
    try {
      const text = await file.text();
      const r = await mergeClubDayData(text);
      setResult(r);
    } catch (e: any) {
      if (e?.message === "ALREADY_IMPORTED") {
        setError("This export has already been imported.");
      } else {
        setError(e?.message ?? "Import failed");
      }
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md shadow-2xl p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest text-teal-500 mb-1">Club Day</div>
            <h2 className="font-black text-gray-900 dark:text-gray-100">Import Club Day Data</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg mt-1">✕</button>
        </div>

        {!result && (
          <>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 leading-relaxed">
              Import a member's Club Day export. Their sessions and finds will be merged into this permission.
            </p>

            {error && (
              <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-300">
                {error}
              </div>
            )}

            <label className={`flex items-center justify-center gap-2 w-full py-4 rounded-xl border-2 border-dashed text-sm font-black uppercase tracking-widest transition-colors ${importing ? "opacity-50 cursor-not-allowed border-gray-200 text-gray-400" : "border-teal-300 dark:border-teal-700 text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/20 cursor-pointer"}`}>
              {importing ? "Importing…" : "Select Export File"}
              {!importing && <input type="file" accept=".json" onChange={handleFile} className="hidden" />}
            </label>
          </>
        )}

        {result && (
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center mx-auto text-xl font-black text-teal-600">✓</div>
            <div className="text-center">
              <p className="font-black text-gray-900 dark:text-gray-100">Import complete</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">From: {result.recorderName}</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "New sessions", value: result.newSessions },
                { label: "New finds", value: result.newFinds },
                { label: "Already present", value: result.alreadyPresent },
              ].map(({ label, value }) => (
                <div key={label} className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 text-center">
                  <div className="text-2xl font-black text-teal-600 dark:text-teal-400">{value}</div>
                  <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mt-0.5">{label}</div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center">Import another member's file or close when done.</p>

            {/* Allow importing another file without closing */}
            <label className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border border-teal-300 dark:border-teal-700 text-[10px] font-black uppercase tracking-widest text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/20 cursor-pointer transition-colors">
              Import Another
              <input type="file" accept=".json" onChange={handleFile} className="hidden" />
            </label>
          </div>
        )}

        <button onClick={onClose} className="w-full mt-4 py-3 text-[10px] font-black uppercase tracking-widest text-gray-500 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl transition-colors">
          Close
        </button>
      </div>
    </div>
  );
}
