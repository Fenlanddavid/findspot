import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  isStoragePersistent,
  requestPersistentStorage,
  getSetting,
  setSetting,
  exportData,
  importData,
  exportToCSV,
  markExternalBackupSaved,
  estimateMediaSizeBytes,
  MEDIA_EXPORT_WARN_BYTES,
} from "../services/data";
import { exportDiagLog } from "../services/diagLog";
import { db } from "../db";
import {
  FIELDGUIDE_PROPRIETARY_NOTICE,
  FIELDGUIDE_USE_RESTRICTION,
  FINDSPOT_COPYRIGHT_NOTICE,
  FINDSPOT_CORE_IP_NOTICE,
  TERMS_OF_USE_INTRO,
  TERMS_OF_USE_SECTIONS,
  TERMS_OF_USE_VERSION,
} from "../utils/legalCopy";

type RestoreCounts = {
  projects: number;
  permissions: number;
  fields: number;
  sessions: number;
  finds: number;
  significantFinds: number;
  media: number;
  tracks: number;
};

type RestorePreview = RestoreCounts & {
  exportedAt?: string;
};

type SettingsTab = "data" | "profile" | "detectors" | "app";

const RESTORE_CONFIRMATION = "RESTORE";

function isSettingsTab(value: string | null): value is SettingsTab {
  return value === "data" || value === "profile" || value === "detectors" || value === "app";
}

function normalizeSettingsTab(value: string | null): SettingsTab | null {
  if (value === "legal") return "app";
  return isSettingsTab(value) ? value : null;
}

function countBackupRows(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function previewBackup(json: string): RestorePreview {
  const parsed = JSON.parse(json) as Record<string, unknown>;
  return {
    exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : undefined,
    projects: countBackupRows(parsed.projects),
    permissions: countBackupRows(parsed.permissions),
    fields: countBackupRows(parsed.fields),
    sessions: countBackupRows(parsed.sessions),
    finds: countBackupRows(parsed.finds),
    significantFinds: countBackupRows(parsed.significantFinds),
    media: countBackupRows(parsed.media),
    tracks: countBackupRows(parsed.tracks),
  };
}

async function getCurrentDataCounts(): Promise<RestoreCounts> {
  const [projects, permissions, fields, sessions, finds, significantFinds, media, tracks] = await Promise.all([
    db.projects.count(),
    db.permissions.count(),
    db.fields.count(),
    db.sessions.count(),
    db.finds.count(),
    db.significantFinds.count(),
    db.media.count(),
    db.tracks.count(),
  ]);
  return { projects, permissions, fields, sessions, finds, significantFinds, media, tracks };
}

const POPULAR_MODELS = [
  "Minelab Equinox 900", 
  "Minelab Equinox 800", 
  "Minelab Equinox 700",
  "Minelab Equinox 600",
  "Minelab Manticore", 
  "Minelab CTX 3030",
  "Minelab Vanquish 560",
  "Minelab Vanquish 460",
  "Minelab Vanquish 360",
  "Minelab Vanquish 540",
  "Minelab Vanquish 440",
  "Minelab X-Terra Pro",
  "Minelab X-Terra Elite",
  "XP Deus II",
  "XP Deus",
  "XP ORX",
  "Nokta Legend",
  "Nokta Simplex Ultra",
  "Nokta Simplex BT",
  "Nokta Simplex Lite",
  "Nokta Score / Double Score",
  "Garrett ACE Apex",
  "Garrett AT Pro",
  "Garrett Ace 400i",
  "Garrett Ace 300i",
  "Garrett Ace 200i",
  "Teknetics T2",
  "Teknetics G2",
  "Fisher F75",
  "C.Scope 6MXi",
  "C.Scope 4MXi"
].sort();

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(() => {
    const tabParam = searchParams.get("tab");
    const savedTab = localStorage.getItem("fs_settings_tab");
    const normalizedTab = normalizeSettingsTab(tabParam);
    const normalizedSavedTab = normalizeSettingsTab(savedTab);
    if (normalizedTab) return normalizedTab;
    if (normalizedSavedTab) return normalizedSavedTab;
    return "data";
  });
  const [termsOpen, setTermsOpen] = useState(() => (
    searchParams.get("tab") === "legal" ||
    searchParams.get("section") === "terms" ||
    localStorage.getItem("fs_settings_tab") === "legal"
  ));
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [detectorist, setDetectorist] = useState("");
  const [recorderName, setRecorderName] = useState("");
  const [email, setEmail] = useState("");
  const [insuranceProvider, setInsuranceProvider] = useState("");
  const [ncmdNumber, setNcmdNumber] = useState("");
  const [ncmdExpiry, setNcmdExpiry] = useState("");
  const [membershipCardImage, setMembershipCardImage] = useState<string | null>(null);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [theme, setTheme] = useState("dark");
  const [detectors, setDetectors] = useState<string[]>([]);
  const [defaultDetector, setDefaultDetector] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [saved, setSaved] = useState(false);
  const [persistenceMsg, setPersistenceMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [importPendingFile, setImportPendingFile] = useState<File | null>(null);
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const [restorePreviewError, setRestorePreviewError] = useState<string | null>(null);
  const [currentDataCounts, setCurrentDataCounts] = useState<RestoreCounts | null>(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState("");
  const [dataError, setDataError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportingWithMedia, setExportingWithMedia] = useState(false);
  const [exportingCSV, setExportingCSV] = useState(false);
  const [importing, setImporting] = useState(false);
  const [mediaPhotoCount, setMediaPhotoCount] = useState<number | null>(null);
  const [mediaSizeBytes, setMediaSizeBytes] = useState<number | null>(null);
  const [mediaWarnPending, setMediaWarnPending] = useState(false);
  const [exportingDiagLog, setExportingDiagLog] = useState(false);
  const [installCount, setInstallCount] = useState<number | null>(null);
  const [easterEggUnlocked, setEasterEggUnlocked] = useState(() => localStorage.getItem('fs_dev_egg') === '1');
  const [versionTapCount, setVersionTapCount] = useState(0);
  const [geologyEnabled, setGeologyEnabled] = useState(true);

  useEffect(() => {
    isStoragePersistent().then(setPersistent);

    // Fetch community install count — non-critical, abort after 5s
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    fetch("https://findspot-counter.trials-uk.workers.dev/count", { signal: controller.signal })
      .then(res => res.json())
      .then(data => {
        clearTimeout(timeoutId);
        if (typeof data.count === 'number') setInstallCount(data.count);
      })
      .catch(() => clearTimeout(timeoutId));
    getSetting("detectorist", "").then(setDetectorist);
    getSetting("recorderName", "").then(setRecorderName);
    getSetting("detectoristEmail", "").then(setEmail);
    getSetting("insuranceProvider", "").then(setInsuranceProvider);
    getSetting("ncmdNumber", "").then(setNcmdNumber);
    getSetting("ncmdExpiry", "").then(setNcmdExpiry);
    getSetting("membershipCardImage", null).then(setMembershipCardImage);
    getSetting("lastBackupDate", null).then(setLastBackup);
    getSetting("theme", "dark").then(setTheme);
    getSetting("detectors", ["Minelab Equinox 800", "Nokta Legend"]).then(val => {
      if (Array.isArray(val)) setDetectors(val);
      else setDetectors(["Minelab Equinox 800", "Nokta Legend"]);
    });
    getSetting("defaultDetector", "").then(setDefaultDetector);
    getSetting("fs_geology_enabled", true).then(v => setGeologyEnabled(v !== false));
    estimateMediaSizeBytes().then(({ count, bytes }) => {
      setMediaPhotoCount(count);
      setMediaSizeBytes(bytes);
    }).catch(() => {});

  }, []);

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    const sectionParam = searchParams.get("section");
    if (tabParam === "legal") {
      setSettingsTab("app");
      setTermsOpen(true);
      localStorage.setItem("fs_settings_tab", "app");
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.set("tab", "app");
        next.set("section", "terms");
        return next;
      }, { replace: true });
      return;
    }
    if (isSettingsTab(tabParam) && tabParam !== settingsTab) {
      setSettingsTab(tabParam);
      localStorage.setItem("fs_settings_tab", tabParam);
    }
    if (sectionParam === "terms") {
      setTermsOpen(true);
      if (settingsTab !== "app") {
        setSettingsTab("app");
        localStorage.setItem("fs_settings_tab", "app");
      }
    }
  }, [searchParams, setSearchParams, settingsTab]);

  function selectSettingsTab(tab: SettingsTab) {
    setSettingsTab(tab);
    localStorage.setItem("fs_settings_tab", tab);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (tab === "data") next.delete("tab");
      else next.set("tab", tab);
      next.delete("section");
      return next;
    }, { replace: true });
  }

  function openTerms() {
    setSettingsTab("app");
    setTermsOpen(true);
    localStorage.setItem("fs_settings_tab", "app");
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set("tab", "app");
      next.set("section", "terms");
      return next;
    }, { replace: false });
    window.requestAnimationFrame(() => {
      document.getElementById("findspot-terms")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function handleRequestPersistence() {
    const success = await requestPersistentStorage();
    setPersistent(success);
    setPersistenceMsg(
      success
        ? { ok: true, text: "Storage is now persistent. Your browser will prioritise keeping this data safe." }
        : { ok: false, text: "Persistence could not be granted. This usually depends on browser settings or available disk space." }
    );
    setTimeout(() => setPersistenceMsg(null), 5000);
  }

  async function toggleTheme() {
    const newTheme = theme === "dark" ? "light" : "dark";
    await setSetting("theme", newTheme);
    localStorage.setItem("fs_theme", newTheme);
    setTheme(newTheme);
  }

  async function addDetector() {
    let nameToAdd = "";
    if (selectedModel === "Other") {
      nameToAdd = customModel.trim();
    } else {
      nameToAdd = selectedModel;
    }

    if (!nameToAdd || detectors.includes(nameToAdd)) return;

    const newList = [...detectors, nameToAdd];
    setDetectors(newList);
    await setSetting("detectors", newList);
    
    // Reset inputs
    setSelectedModel("");
    setCustomModel("");
  }

  async function removeDetector(name: string) {
    const newList = detectors.filter(d => d !== name);
    setDetectors(newList);
    await setSetting("detectors", newList);
    if (defaultDetector === name) {
      setDefaultDetector("");
      await setSetting("defaultDetector", "");
    }
  }

  async function saveField(key: string, value: string) {
    await setSetting(key, value);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function saveSettings() {
    await setSetting("detectorist", detectorist);
    await setSetting("recorderName", recorderName);
    await setSetting("detectoristEmail", email);
    await setSetting("insuranceProvider", insuranceProvider);
    await setSetting("ncmdNumber", ncmdNumber);
    await setSetting("ncmdExpiry", ncmdExpiry);
    await setSetting("defaultDetector", defaultDetector);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }


  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleExport() {
    setExporting(true);
    try {
      // Data-only by default — photos excluded to avoid OOM on mobile.
      const json = await exportData({ includeMedia: false });
      triggerDownload(new Blob([json], { type: "application/json" }), `findspot-backup-${new Date().toISOString().slice(0, 10)}.json`);
      const savedAt = await markExternalBackupSaved();
      setLastBackup(savedAt);
    } catch (e) {
      setDataError("Export failed: " + e);
    } finally {
      setExporting(false);
    }
  }

  function requestExportWithMedia() {
    // If estimated export size exceeds threshold, require explicit confirmation.
    const estimatedBytes = (mediaSizeBytes ?? 0) * 1.37; // base64 overhead
    if (estimatedBytes > MEDIA_EXPORT_WARN_BYTES) {
      setMediaWarnPending(true);
    } else {
      void doExportWithMedia();
    }
  }

  async function doExportWithMedia() {
    setMediaWarnPending(false);
    setExportingWithMedia(true);
    try {
      const json = await exportData({ includeMedia: true });
      triggerDownload(new Blob([json], { type: "application/json" }), `findspot-full-backup-${new Date().toISOString().slice(0, 10)}.json`);
      const savedAt = await markExternalBackupSaved();
      setLastBackup(savedAt);
    } catch (e) {
      setDataError("Full backup failed: " + e);
    } finally {
      setExportingWithMedia(false);
    }
  }

  async function handleExportDiagLog() {
    setExportingDiagLog(true);
    try {
      const json = await exportDiagLog();
      triggerDownload(new Blob([json], { type: "application/json" }), `findspot-diagnostics-${new Date().toISOString().slice(0, 10)}.json`);
    } catch (e) {
      setDataError("Diagnostic log export failed: " + e);
    } finally {
      setExportingDiagLog(false);
    }
  }

  async function handleCSVExport() {
    setExportingCSV(true);
    try {
      const csv = await exportToCSV();
      triggerDownload(new Blob([csv], { type: "text/csv" }), `findspot-records-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      setDataError("CSV export failed: " + e);
    } finally {
      setExportingCSV(false);
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportPendingFile(file);
    setRestorePreview(null);
    setRestorePreviewError(null);
    setCurrentDataCounts(null);
    setRestoreConfirmText("");
    e.target.value = "";
    getCurrentDataCounts().then(setCurrentDataCounts).catch(() => setCurrentDataCounts(null));
    try {
      setRestorePreview(previewBackup(await file.text()));
    } catch {
      setRestorePreviewError("Preview unavailable. FindSpot will still validate the backup before replacing any data.");
    }
  }

  async function confirmImport() {
    if (!importPendingFile) return;
    if (restoreConfirmText !== RESTORE_CONFIRMATION) return;
    const file = importPendingFile;
    setDataError(null);
    setImporting(true);
    try {
      const text = await file.text();
      await importData(text);
      setImportPendingFile(null);
      setRestorePreview(null);
      setRestorePreviewError(null);
      setCurrentDataCounts(null);
      setRestoreConfirmText("");
      window.location.assign(new URL("./", window.location.href).toString());
    } catch (e) {
      setDataError("Import failed: " + e);
      setImporting(false);
    }
  }

  function formatBackupDate(value?: string | null) {
    if (!value) return "Never";
    const date = new Date(value);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }

  const restoreCanConfirm = restoreConfirmText === RESTORE_CONFIRMATION;

  const restoreRows: Array<[string, number | string]> = restorePreview ? [
    ["Projects", restorePreview.projects],
    ["Permissions", restorePreview.permissions],
    ["Fields", restorePreview.fields],
    ["Sessions", restorePreview.sessions],
    ["Finds", restorePreview.finds],
    ["Significant", restorePreview.significantFinds],
    ["Media", restorePreview.media],
    ["Tracks", restorePreview.tracks],
  ] : [];

  const currentRows: Array<[string, number | string]> = currentDataCounts ? [
    ["Projects", currentDataCounts.projects],
    ["Permissions", currentDataCounts.permissions],
    ["Fields", currentDataCounts.fields],
    ["Sessions", currentDataCounts.sessions],
    ["Finds", currentDataCounts.finds],
    ["Significant", currentDataCounts.significantFinds],
    ["Media", currentDataCounts.media],
    ["Tracks", currentDataCounts.tracks],
  ] : [
    ["Projects", "Checking"],
    ["Permissions", "Checking"],
    ["Fields", "Checking"],
    ["Sessions", "Checking"],
    ["Finds", "Checking"],
    ["Significant", "Checking"],
    ["Media", "Checking"],
    ["Tracks", "Checking"],
  ];

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 pb-20 mt-4">
      {importing && (
        <div className="fixed inset-0 z-[80] bg-gray-950/70 backdrop-blur-sm flex items-center justify-center p-4" role="status" aria-live="assertive">
          <div className="w-full max-w-sm rounded-2xl border border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-900 p-5 shadow-2xl text-center">
            <div className="mx-auto mb-3 h-10 w-10 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin" />
            <h2 className="text-base font-black text-gray-900 dark:text-gray-100">Restoring Backup</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Keep FindSpot open until it reloads with the restored data.
            </p>
          </div>
        </div>
      )}
      <h1 className="text-2xl sm:text-3xl font-black mb-4 bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">Settings</h1>
      <div className="mb-5 grid grid-cols-2 gap-2 rounded-2xl border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-900 sm:grid-cols-4">
        {[
          ["data", "Backup"],
          ["profile", "Profile"],
          ["detectors", "Detector"],
          ["app", "App"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => selectSettingsTab(key as SettingsTab)}
            className={`min-h-11 rounded-xl px-3 py-2 text-xs font-black uppercase tracking-widest transition-colors ${settingsTab === key ? "bg-white text-emerald-700 shadow-sm dark:bg-gray-800 dark:text-emerald-300" : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {settingsTab === "data" && (
      <>
      <div className="mb-6 rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-black text-emerald-900 dark:text-emerald-100 m-0">Backup & Restore</h2>
            <p className="text-sm text-emerald-800/70 dark:text-emerald-300/80 mt-1">
              FindSpot is local-only. Backups are the safety net for this device.
            </p>
          </div>
          <span className={`hidden sm:inline-flex text-xs font-black uppercase tracking-widest px-2 py-1 rounded ${lastBackup ? "bg-emerald-600 text-white" : "bg-amber-100 text-amber-800"}`}>
            {lastBackup ? "Backup saved" : "Save backup"}
          </span>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-1 text-sm font-black text-gray-900 dark:text-gray-100">Privacy Guarantee</h2>
        <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
          Saved finds, permissions, landowner details, photos and backups stay on this device unless you export or share them.
        </p>
      </div>

      {dataError && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-300">
          <span>{dataError}</span>
          <button onClick={() => setDataError(null)} className="font-bold shrink-0">✕</button>
        </div>
      )}

      {importPendingFile && (
        <div className="px-4 py-4 mb-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-800 rounded-xl text-sm text-amber-950 dark:text-amber-200">
          <div className="min-w-0">
            <span><strong>Restore "{importPendingFile.name}"?</strong> This restore will replace current FindSpot data on this device.</span>
            <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/75">
              Treat this like replacing an archive: finds, significant finds, permissions, sessions, tracks and media currently on this device will be cleared before the backup is loaded.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-amber-700/70 dark:text-amber-300/70">Current data on this device</div>
                <div className="grid grid-cols-2 gap-2">
                  {currentRows.map(([label, count]) => (
                    <div key={label} className="rounded-lg bg-white/75 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-800 px-2 py-1">
                      <div className="text-[9px] font-black uppercase tracking-widest text-amber-600/70">{label}</div>
                      <div className="text-sm font-black">{count}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-amber-700/70 dark:text-amber-300/70">Backup to restore</div>
                {restorePreview && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      {restoreRows.map(([label, count]) => (
                        <div key={label} className="rounded-lg bg-white/75 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-800 px-2 py-1">
                          <div className="text-[9px] font-black uppercase tracking-widest text-amber-600/70">{label}</div>
                          <div className="text-sm font-black">{count}</div>
                        </div>
                      ))}
                    </div>
                    {restorePreview.exportedAt && (
                      <p className="mt-2 text-xs text-amber-800/80 dark:text-amber-200/75">
                        Backup created {formatBackupDate(restorePreview.exportedAt)}
                      </p>
                    )}
                  </>
                )}
                {restorePreviewError && (
                  <p className="text-xs text-amber-800/80 dark:text-amber-200/75">{restorePreviewError}</p>
                )}
              </div>
            </div>
            <label className="mt-4 block">
              <span className="text-[10px] font-black uppercase tracking-widest text-amber-800 dark:text-amber-200">Type RESTORE to confirm replacement</span>
              <input
                type="text"
                value={restoreConfirmText}
                onChange={(event) => setRestoreConfirmText(event.target.value)}
                disabled={importing}
                className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:ring-2 focus:ring-amber-500 dark:border-amber-800 dark:bg-gray-950 dark:text-gray-100"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={confirmImport} disabled={importing || !restoreCanConfirm} className="bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors">{importing ? "Importing..." : "Confirm Import"}</button>
            <button disabled={importing} onClick={() => { setImportPendingFile(null); setRestorePreview(null); setRestorePreviewError(null); setCurrentDataCounts(null); setRestoreConfirmText(""); }} className="text-amber-800 dark:text-amber-300 disabled:opacity-40 text-xs font-bold hover:underline px-2">Cancel</button>
          </div>
        </div>
      )}

      {mediaWarnPending && (
        <div className="mb-4 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20 p-4 text-sm text-amber-900 dark:text-amber-200">
          <p className="font-black mb-1">Large backup — confirm before proceeding</p>
          <p className="mb-3 text-amber-800/80 dark:text-amber-300/80">
            Estimated export size is {mediaSizeBytes !== null ? `~${Math.round((mediaSizeBytes * 1.37) / (1024 * 1024))} MB` : "large"}.
            On older devices this may be slow or run out of memory.
          </p>
          <div className="flex gap-2">
            <button onClick={doExportWithMedia} disabled={exportingWithMedia} className="bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors">
              {exportingWithMedia ? "Saving…" : "Proceed with full backup"}
            </button>
            <button onClick={() => setMediaWarnPending(false)} className="text-amber-800 dark:text-amber-300 text-xs font-bold hover:underline px-2">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-[1.5fr_1fr_1fr] gap-3">
        <button
          onClick={handleExport}
          disabled={exporting}
          className="col-span-2 sm:col-span-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-sm font-black uppercase tracking-widest py-3 rounded-xl transition-colors shadow-sm"
        >
          {exporting ? "Saving…" : "Backup JSON"}
        </button>
        <label className={`flex items-center justify-center bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-xs font-black uppercase tracking-widest py-3 rounded-xl hover:border-emerald-400 transition-colors shadow-sm ${importing ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}>
          {importing ? "Restoring…" : "Restore Backup"}
          {!importing && <input type="file" accept=".json" onChange={handleImportFile} className="hidden" />}
        </label>
        <button
          onClick={handleCSVExport}
          disabled={exportingCSV}
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-xs font-black uppercase tracking-widest py-3 rounded-xl hover:border-emerald-400 disabled:opacity-60 transition-colors shadow-sm"
        >
          {exportingCSV ? "Exporting…" : "Export CSV"}
        </button>
      </div>

      {/* Media size info + full backup */}
      <div className="mt-3 mb-8 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          <span className="font-bold">Backup JSON</span> saves records only (no photos).
          {mediaPhotoCount !== null && mediaPhotoCount > 0 && mediaSizeBytes !== null && (
            <> {mediaPhotoCount} photo{mediaPhotoCount !== 1 ? 's' : ''} on device
              ({Math.round(mediaSizeBytes / (1024 * 1024))} MB raw).</>
          )}
          {mediaPhotoCount === 0 && ' No photos stored.'}
        </p>
        {mediaPhotoCount !== null && mediaPhotoCount > 0 && (
          <button
            onClick={requestExportWithMedia}
            disabled={exportingWithMedia || mediaWarnPending}
            className="shrink-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-xs font-black uppercase tracking-widest px-3 py-2 rounded-lg hover:border-emerald-400 disabled:opacity-60 transition-colors"
          >
            {exportingWithMedia ? "Saving…" : "Backup + Photos"}
          </button>
        )}
      </div>

      {/* Diagnostic log export */}
      <div className="mb-8 flex items-center justify-between gap-3 rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
        <div>
          <p className="text-xs font-black text-gray-700 dark:text-gray-200">Diagnostic Log</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">On-device error log for field troubleshooting. Never sent anywhere.</p>
        </div>
        <button
          onClick={handleExportDiagLog}
          disabled={exportingDiagLog}
          className="shrink-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-xs font-black uppercase tracking-widest px-3 py-2 rounded-lg hover:border-gray-400 disabled:opacity-60 transition-colors"
        >
          {exportingDiagLog ? "Exporting…" : "Export Log"}
        </button>
      </div>
      </>
      )}

      <div className="space-y-8">
        {settingsTab === "detectors" && (
        <section className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            Detector Profiles
          </h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Your Detectors</label>
              <div className="flex flex-wrap gap-2 mb-4">
                {!Array.isArray(detectors) || detectors.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No detectors added yet.</p>
                ) : (
                  detectors.map(d => (
                    <div key={d} className="flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/50 px-3 py-1.5 rounded-lg shadow-sm">
                      <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">{d}</span>
                      <button 
                        onClick={() => removeDetector(d)}
                        className="text-emerald-500 hover:text-red-500 ml-1 transition-colors flex items-center justify-center p-1"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-700">
                <div className="text-xs font-black uppercase tracking-widest text-gray-400 mb-1">Add to your list</div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="flex-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    <option value="">(Select Model)</option>
                    {POPULAR_MODELS.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                    <option value="Other">Custom / Other...</option>
                  </select>
                  
                  {selectedModel === "Other" && (
                    <input
                      type="text"
                      value={customModel}
                      onChange={(e) => setCustomModel(e.target.value)}
                      placeholder="Enter detector name"
                      className="flex-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none animate-in slide-in-from-left-2"
                    />
                  )}

                  <button
                    onClick={addDetector}
                    disabled={!selectedModel || (selectedModel === "Other" && !customModel.trim())}
                    className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-bold transition-all shadow-sm"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-gray-100 dark:border-gray-700">
              <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Default Detector for New Finds</label>
              <select
                value={defaultDetector}
                onChange={(e) => { setDefaultDetector(e.target.value); saveField("defaultDetector", e.target.value); }}
                className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                <option value="">(None)</option>
                {Array.isArray(detectors) && detectors.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </div>
        </section>
        )}

        {settingsTab === "profile" && (
        <section className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            Profile & Insurance
          </h2>
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Default Detectorist Name</label>
                <input
                  type="text"
                  value={detectorist}
                  onChange={(e) => setDetectorist(e.target.value)}
                  onBlur={(e) => saveField("detectorist", e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Club Day Name</label>
                <input
                  type="text"
                  value={recorderName}
                  onChange={(e) => setRecorderName(e.target.value)}
                  placeholder="Name shown on club day exports"
                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
                />
                <p className="text-[10px] text-gray-400 mt-1">Shown to the organiser when you export your Club Day data. Stored on this device only.</p>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={(e) => saveField("detectoristEmail", e.target.value)}
                  placeholder="john@example.com"
                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-1 italic">These details will be used as the default for new records and included in your reports.</p>

            <div className="space-y-4 pt-4 border-t border-gray-100 dark:border-gray-700">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Insurance Provider</label>
                  <input
                    type="text"
                    value={insuranceProvider}
                    onChange={(e) => setInsuranceProvider(e.target.value)}
                    onBlur={(e) => saveField("insuranceProvider", e.target.value)}
                    placeholder="e.g. NCMD, AMDS, club name..."
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Membership No.</label>
                  <input
                    type="text"
                    value={ncmdNumber}
                    onChange={(e) => setNcmdNumber(e.target.value)}
                    onBlur={(e) => saveField("ncmdNumber", e.target.value)}
                    placeholder="e.g. 123456"
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Insurance Expiry Date</label>
                  <input
                    type="date"
                    value={ncmdExpiry}
                    onChange={(e) => { setNcmdExpiry(e.target.value); saveField("ncmdExpiry", e.target.value); }}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">Membership Card</label>
                {membershipCardImage ? (
                  <div className="relative inline-block">
                    <img
                      src={membershipCardImage}
                      alt="Membership card"
                      className="max-h-40 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm object-contain"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        setMembershipCardImage(null);
                        await setSetting("membershipCardImage", null);
                      }}
                      className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center shadow transition-colors"
                      title="Remove card image"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center gap-3 cursor-pointer w-fit bg-gray-50 dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-600 hover:border-emerald-500 dark:hover:border-emerald-500 px-4 py-3 rounded-xl transition-colors group">
                    <svg className="w-5 h-5 text-gray-400 group-hover:text-emerald-500 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                      <circle cx="8.5" cy="8.5" r="1.5"></circle>
                      <polyline points="21 15 16 10 5 21"></polyline>
                    </svg>
                    <span className="text-sm text-gray-500 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">Upload photo or scan of card</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = async (ev) => {
                          const dataUrl = ev.target?.result as string;
                          setMembershipCardImage(dataUrl);
                          await setSetting("membershipCardImage", dataUrl);
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                  </label>
                )}
              </div>

              <p className="text-xs text-gray-500 italic">Your insurance details for landowner peace of mind. Stored locally on this device only.</p>
            </div>

            <button
              onClick={saveSettings}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 px-6 rounded-lg transition-colors flex items-center gap-2"
            >
              {saved ? "✓ Saved" : "Save Preferences"}
            </button>
          </div>
        </section>
        )}

        {settingsTab === "data" && (
        <section className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            App Storage
          </h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-xl">
              <div>
                <h3 className="font-bold text-gray-800 dark:text-gray-100">Storage Persistence</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {persistent 
                    ? "Your browser has granted persistent storage. Data will not be deleted unless you clear it manually."
                    : "Storage is currently 'best-effort'. The browser might delete it if the device runs low on space."}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded ${persistent ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                  {persistent ? "Persistent" : "Standard"}
                </span>
                {!persistent && (
                  <button
                    onClick={handleRequestPersistence}
                    className="text-xs font-bold text-emerald-600 hover:underline"
                  >
                    Request Persistence
                  </button>
                )}
              </div>
            </div>
            {persistenceMsg && (
              <div className={`px-4 py-3 rounded-xl text-sm font-medium ${persistenceMsg.ok ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300" : "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"}`}>
                {persistenceMsg.text}
              </div>
            )}

            <div className="flex items-center justify-between gap-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-xl">
              <div>
                <h3 className="font-bold text-gray-800 dark:text-gray-100">Saved JSON Backup</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {lastBackup 
                    ? `Last backed up on ${new Date(lastBackup).toLocaleDateString()} at ${new Date(lastBackup).toLocaleTimeString()}`
                    : "No JSON backup has been saved from this browser yet."}
                </p>
              </div>
              <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded ${lastBackup ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                {lastBackup ? "Saved" : "Not saved"}
              </span>
            </div>
            
            <div className="p-4 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl text-center">
              <p className="text-sm text-gray-500 mb-0 italic">
                All "FindSpot" data is stored exclusively in your browser's IndexedDB.
                Using "Persistent Storage" helps ensure your finds and maps remain available offline.
              </p>
            </div>
          </div>
        </section>
        )}

        {settingsTab === "app" && (
        <>
        <section className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            App Appearance
          </h2>
          <div className="flex justify-between items-center py-2">
            <div>
              <div className="font-medium text-gray-800 dark:text-gray-100">Interface Theme</div>
              <div className="text-sm text-gray-500">
                Default is Dark mode.
              </div>
            </div>
            <button
              onClick={toggleTheme}
              className="flex items-center gap-2 bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-4 py-2 rounded-lg font-bold hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              {theme === "dark" ? "Dark" : "Light"}
            </button>
          </div>
        </section>


        <section className="bg-amber-50 dark:bg-amber-900/20 p-5 rounded-2xl border border-amber-200 dark:border-amber-800/50 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-black text-amber-700 dark:text-amber-400 mb-0.5">Quick Start Guide</h2>
            <p className="text-xs text-amber-600/70 dark:text-amber-500/70">Walk through the app features again from the beginning.</p>
          </div>
          <button
            onClick={() => { localStorage.removeItem('fs_onboarding_done'); localStorage.setItem('fs_onboarding_force', '1'); window.location.href = import.meta.env.BASE_URL; }}
            className="shrink-0 text-xs font-black text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40 hover:bg-amber-200 dark:hover:bg-amber-800/60 border border-amber-300 dark:border-amber-700 px-3 py-2 rounded-lg transition-colors"
          >
            Show again →
          </button>
        </section>

        <section className="bg-emerald-50 dark:bg-emerald-900/20 p-6 rounded-2xl border border-emerald-100 dark:border-emerald-800/50">
          <h2 className="text-lg font-bold text-emerald-800 dark:text-emerald-300 mb-2 flex items-center gap-2">
            Privacy Guarantee
          </h2>
          <p className="text-sm text-emerald-700 dark:text-emerald-400 leading-relaxed">
            FindSpot is built to be <strong>local-first</strong>. Saved finds, permissions, landowner details, photos and backups stay on this device unless you export or share them. Online maps, address search and landscape scanning may request map/search data for the area you are viewing. Discover only sends details you type into its submit forms.
          </p>
        </section>

        <section className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
	          <h2 className="text-xl font-bold mb-1">External Data Sources</h2>
	          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
	            FieldGuide may request public map and heritage datasets for the area being viewed. These requests do not include your finds, permissions, sessions, notes or photos.
	          </p>

          <div className="flex justify-between items-start py-3 border-t border-gray-100 dark:border-gray-700">
            <div className="flex-1 pr-4">
	              <div className="font-medium text-gray-800 dark:text-gray-100 text-sm">BGS Geology Context</div>
	              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
	                Optional public BGS geology lookup for the current map area. Personal FindSpot records are never sent.
	              </div>
            </div>
            <button
              onClick={async () => {
                const next = !geologyEnabled;
                setGeologyEnabled(next);
                await setSetting("fs_geology_enabled", next);
              }}
              className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm border transition-colors ${
                geologyEnabled
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-400'
                  : 'bg-gray-100 border-gray-200 text-gray-500 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-500'
              }`}
            >
	              {geologyEnabled ? 'On' : 'Off'}
	            </button>
	          </div>

	          <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
	            <div className="space-y-2 text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
	              <p>Contains British Geological Survey materials © UKRI 2025. BGS data is used under the Open Government Licence.</p>
		              <p>Scheduled Monument and AIM data are provided through public Historic England map services.</p>
	              <p>Contains Environment Agency information © Environment Agency and database right, licensed under the Open Government Licence v3.0.</p>
              <p>Wales LiDAR data © Crown copyright, Natural Resources Wales / Welsh Government. Licensed under the Open Government Licence v3.0. Source: DataMapWales (datamap.gov.wales).</p>
              <p>Historical map tiles reproduced with the permission of the National Library of Scotland.</p>
            </div>
          </div>
        </section>

        <section className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
                About FindSpot
              </h2>
              <p className="text-sm font-bold text-gray-800 dark:text-gray-100">
                {FINDSPOT_COPYRIGHT_NOTICE}
              </p>
            </div>
            <button
              type="button"
              onClick={openTerms}
              aria-controls="findspot-terms"
              aria-expanded={termsOpen}
              className="shrink-0 text-[9px] font-black uppercase tracking-widest rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700 transition-colors hover:bg-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
            >
              Terms
            </button>
          </div>
          <div className="mt-4 space-y-3 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
            <p>{FINDSPOT_CORE_IP_NOTICE}</p>
            <p>{FIELDGUIDE_PROPRIETARY_NOTICE}</p>
            <p>{FIELDGUIDE_USE_RESTRICTION}</p>
          </div>
        </section>

        {termsOpen && (
        <>
        <section id="findspot-terms" className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 scroll-mt-24">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Terms of Use &amp; IP Notice</h2>
              <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-300">{TERMS_OF_USE_INTRO}</p>
            </div>
            <span className="w-fit shrink-0 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
              v{TERMS_OF_USE_VERSION}
            </span>
          </div>
          <div className="mt-5 grid gap-3">
            {TERMS_OF_USE_SECTIONS.map((section) => (
              <article key={section.title} className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/60">
                <h3 className="text-sm font-black text-gray-900 dark:text-gray-100">{section.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-300">{section.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="bg-emerald-50 dark:bg-emerald-900/20 p-6 rounded-2xl border border-emerald-100 dark:border-emerald-800/50">
          <h2 className="text-lg font-bold text-emerald-800 dark:text-emerald-300 mb-2">Ownership Summary</h2>
          <div className="space-y-3 text-sm leading-relaxed text-emerald-800 dark:text-emerald-300">
            <p>Users own their own finds records, photos, permission information, field boundaries and local exports.</p>
            <p>{FINDSPOT_CORE_IP_NOTICE}</p>
            <p>{FIELDGUIDE_PROPRIETARY_NOTICE}</p>
          </div>
        </section>
        </>
        )}

        <div className="mt-2 px-2">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              className="text-[9px] font-black leading-none text-sky-700 dark:text-sky-300 select-none bg-transparent border-none p-0 cursor-default"
              onClick={() => {
                const next = versionTapCount + 1;
                if (next >= 5) {
                  const newState = !easterEggUnlocked;
                  setEasterEggUnlocked(newState);
                  if (newState) localStorage.setItem('fs_dev_egg', '1');
                  else localStorage.removeItem('fs_dev_egg');
                  setVersionTapCount(0);
                } else {
                  setVersionTapCount(next);
                }
              }}
            >
              Version 3.0
            </button>
            {easterEggUnlocked ? (
              typeof installCount === 'number' && (
                <div className="flex items-center gap-1 opacity-80">
                  <span className="text-[8px] font-black uppercase tracking-widest text-emerald-800 dark:text-emerald-400">#</span>
                  <span className="text-[9px] font-black text-emerald-900 dark:text-emerald-200 tabular-nums">{installCount.toLocaleString()}</span>
                </div>
              )
            ) : (
              <span className="text-[9px] font-black text-emerald-800 dark:text-emerald-300 opacity-60">Trusted by 4,000+ detectorists</span>
            )}
          </div>
        </div>
        </>
        )}

      </div>
    </div>
  );
}
