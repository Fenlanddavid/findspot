import React, { useCallback, useEffect, useState, Suspense } from "react";
import { BrowserRouter, Routes, Route, Link, NavLink, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { useRegisterSW } from 'virtual:pwa-register/react';
import { db } from "./db";
import { ensureDefaultProject, ensureDefaultPermission } from "./app/seed";
import { setSetting, getSetting } from "./services/data";
import { ensureProtectionOnStartup } from "./services/storagePersistence";
import { closeStaleActiveTracks } from "./services/tracking";
import { UPDATE_NOTES } from "./version";
import "maplibre-gl/dist/maplibre-gl.css";

// Eagerly loaded — core navigation paths
import Home from "./pages/Home";
import GlobalActions from "./components/GlobalActions";
import OnboardingFlow from "./components/OnboardingFlow";
import { ClubRallyChoiceModal } from "./components/ClubRallyChoiceModal";
import { useConfirmDialog } from "./components/ConfirmModal";
import { Logo } from "./components/Logo";
import { FINDSPOT_COPYRIGHT_NOTICE } from "./utils/legalCopy";
import SignificantFindWorkflow from "./components/SignificantFindWorkflow";
import { useSignificantFindWorkflow } from "./hooks/useSignificantFindWorkflow";
import type { WorkflowState, WorkflowPath, WorkflowStep } from "./types/significantFind";
import { detectJurisdiction } from "./utils/jurisdictionDetect";
import { toOSGridRef } from "./services/gps";
import { findResumable, buildResumeContext, PATH_STEP_ORDER } from "./services/significantFindResume";
import { PATH_LABELS } from "./components/significant/significantFindDisplay";
import type { SignificantFind } from "./db";

export { Logo } from "./components/Logo";

// Lazily loaded — heavy pages (map, PDF, turf)
const PermissionPage = React.lazy(() => import("./pages/Permission"));
const FindPage = React.lazy(() => import("./pages/Find"));
const SessionPage = React.lazy(() => import("./pages/Session"));
const AllFinds = React.lazy(() => import("./pages/AllFinds"));
const FindsBox = React.lazy(() => import("./pages/FindsBox"));
const PendingFinds = React.lazy(() => import("./pages/PendingFinds"));
const AllPermissions = React.lazy(() => import("./pages/AllPermissions"));
const FieldGuide = React.lazy(() => import("./pages/FieldGuide"));
const Discover = React.lazy(() => import("./pages/Discover"));
const Settings = React.lazy(() => import("./pages/Settings"));
const JoinClubDay = React.lazy(() => import("./pages/JoinClubDay"));

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function Shell() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [showBackupReminder, setShowBackupReminder] = useState(false);
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(true);
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showQuotaWarning, setShowQuotaWarning] = useState(false);
  const [showClubRallyModal, setShowClubRallyModal] = useState(false);
  const { confirm: confirmAction, dialog: confirmDialog } = useConfirmDialog();
  const nav = useNavigate();
  const location = useLocation();
  const sfWorkflow = useSignificantFindWorkflow(projectId ?? "");
  const [resumableSf, setResumableSf] = React.useState<SignificantFind | null>(null);
  const [resumeDismissed, setResumeDismissed] = React.useState(false);

  // Check for a resumable wizard on mount and whenever the workflow closes
  React.useEffect(() => {
    if (!projectId || sfWorkflow.isOpen) return;
    findResumable(projectId).then(setResumableSf).catch(() => setResumableSf(null));
  }, [projectId, sfWorkflow.isOpen]);

  const checkBackupStatus = useCallback(async () => {
    // Check if there is any data worth backing up
    const permCount = await db.permissions.filter(p => !p.isDefault).count();
    const findCount = await db.finds.count();
    if (permCount === 0 && findCount === 0) {
      setShowBackupReminder(false);
      return;
    }

    const snoozedUntil = await getSetting<string | null>("backupSnoozedUntil", null);
    if (snoozedUntil && new Date(snoozedUntil) > new Date()) {
      setShowBackupReminder(false);
      return;
    }

    const lastBackup = await getSetting<string | null>("lastBackupDate", null);
    if (!lastBackup) {
      setShowBackupReminder(true);
      return;
    }

    const lastDate = new Date(lastBackup).getTime();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - lastDate > thirtyDays) {
      setShowBackupReminder(true);
    }
  }, []);

  useEffect(() => {
    ensureDefaultProject().then(async (id) => {
      await ensureDefaultPermission(id);
      setProjectId(id);
    });
    void ensureProtectionOnStartup();
    closeStaleActiveTracks().catch((e) => console.error("Stale tracking cleanup failed", e));

    // Track unique installation (one-time per device).
    // Flag lives in IndexedDB (durable) with a one-time migration from localStorage.
    const trackInstallation = async () => {
      const inLocalStorage = !!localStorage.getItem("fs_installed");
      const inDB = await getSetting<boolean>("fs_installed", false);
      if (!inLocalStorage && !inDB) {
        try {
          await fetch("https://findspot-counter.trials-uk.workers.dev/up");
          await setSetting("fs_installed", true);
        } catch (e) {
          // silent fail — will retry on next launch
        }
      } else if (inLocalStorage && !inDB) {
        // Migrate existing users without re-firing the counter
        await setSetting("fs_installed", true);
      }
    };
    trackInstallation();

    // Detect Standalone mode
    try {
      const isPWA = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || (navigator as any).standalone;
      setIsStandalone(!!isPWA);
    } catch (e) {
      setIsStandalone(true);
    }
    
    // Detect In-App Browsers (Facebook, Instagram, etc.)
    const ua = navigator.userAgent || navigator.vendor || (window as any).opera;
    const isFB = ua.indexOf("FBAN") > -1 || ua.indexOf("FBAV") > -1;
    const isInsta = ua.indexOf("Instagram") > -1;
    const isAndroid = /Android/i.test(ua);
    const isApple = /iPhone|iPad|iPod/i.test(ua);
    
    setIsIOS(isApple);
    if ((isFB || isInsta) && (isAndroid || isApple)) {
        setIsInAppBrowser(true);
    }

    // Check backup status
    checkBackupStatus();

    // Check storage quota — warn if over 80% full
    const checkStorageQuota = async () => {
      try {
        if (!navigator.storage?.estimate) return;
        const { usage = 0, quota = 1 } = await navigator.storage.estimate();
        if (quota > 0 && usage / quota > 0.8) setShowQuotaWarning(true);
      } catch {}
    };
    checkStorageQuota();
  }, [checkBackupStatus]);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPromptEvent(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setInstallPromptEvent(null);
      setIsStandalone(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!installPromptEvent) return false;
    try {
      await installPromptEvent.prompt();
      await installPromptEvent.userChoice.catch(() => null);
      setInstallPromptEvent(null);
      return true;
    } catch {
      setInstallPromptEvent(null);
      return false;
    }
  }, [installPromptEvent]);

  const androidIntentUrl = `intent://${window.location.host}${window.location.pathname}#Intent;scheme=https;package=com.android.chrome;end`;

  async function snoozeBackup() {
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    await setSetting("backupSnoozedUntil", thirtyDaysFromNow.toISOString());
    setShowBackupReminder(false);
  }

  const project = useLiveQuery(async () => (projectId ? db.projects.get(projectId) : null), [projectId]);
  const settings = useLiveQuery(() => db.settings.toArray());
  const clubRallyPermissions = useLiveQuery(
    async () => {
      if (!projectId) return [];
      const rows = await db.permissions.where("projectId").equals(projectId).toArray();
      return rows
        .filter(p => !p.isClubDayMember && !p.isDefault)
        .map(p => ({ id: p.id, name: p.name, type: p.type }));
    },
    [projectId]
  );
  const theme = settings?.find(s => s.key === "theme")?.value ?? "dark";

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  // Keep sfWorkflow.projectId in sync if projectId changes (edge case)
  React.useEffect(() => {
    if (projectId && sfWorkflow.workflowState.projectId !== projectId) {
      sfWorkflow.updateState({ projectId });
    }
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const openSignificantFind = React.useCallback(async (
    triggeredBy: "auto" | "manual",
    initialContext: Partial<WorkflowState> = {},
  ) => {
    if (!projectId) return;

    const linkedFind = initialContext.linkedFindId
      ? await db.finds.get(initialContext.linkedFindId).catch(() => undefined)
      : undefined;

    const activeSession = await db.sessions
      .where("projectId").equals(projectId)
      .filter(s => !s.isFinished)
      .sortBy("updatedAt")
      .then(arr => arr[arr.length - 1])
      .catch(() => undefined);

    let permissionId =
      initialContext.permissionId ??
      linkedFind?.permissionId ??
      activeSession?.permissionId ??
      null;

    let permission = permissionId ? await db.permissions.get(permissionId).catch(() => undefined) : undefined;
    if (permission?.projectId !== projectId) permission = undefined;

    if (!permission) {
      permission = await db.permissions
        .where("projectId").equals(projectId)
        .toArray()
        .then(rows => rows.find(p => !p.isDefault) ?? rows[0])
        .catch(() => undefined);
      permissionId = permission?.id ?? null;
    }

    const lat = initialContext.lat ?? linkedFind?.lat ?? activeSession?.lat ?? permission?.lat ?? null;
    const lon = initialContext.lon ?? linkedFind?.lon ?? activeSession?.lon ?? permission?.lon ?? null;
    const gpsAccuracyM = initialContext.gpsAccuracyM ?? linkedFind?.gpsAccuracyM ?? activeSession?.gpsAccuracyM ?? permission?.gpsAccuracyM ?? null;
    const osGridRef = initialContext.osGridRef ?? linkedFind?.osGridRef ?? (lat != null && lon != null ? toOSGridRef(lat, lon) : "");
    const w3w = initialContext.w3w ?? linkedFind?.w3w ?? "";

    const enrichedContext: Partial<WorkflowState> = {
      ...initialContext,
      projectId,
      permissionId,
      sessionId: initialContext.sessionId ?? linkedFind?.sessionId ?? activeSession?.id ?? null,
      permissionName: permission?.name ?? "",
      permissionType: permission?.type ?? null,
      isClubDayMember: !!permission?.isClubDayMember,
      organiserContactNumber: permission?.organiserContactNumber ?? "",
      organiserEmail: permission?.organiserEmail ?? "",
      significantFindInstructions: permission?.significantFindInstructions ?? "",
      lat,
      lon,
      gpsAccuracyM,
      osGridRef,
      w3w,
      jurisdiction: initialContext.jurisdiction ?? (lat != null && lon != null ? detectJurisdiction(lat, lon) : "unknown"),
      linkedFindId: initialContext.linkedFindId ?? null,
      findDescription: initialContext.findDescription ?? linkedFind?.objectType ?? "",
    };

    sfWorkflow.open({ triggeredBy, initialContext: enrichedContext });
  }, [projectId, sfWorkflow.open]);

  if (!projectId || !project) return <div className="p-4 text-center font-bold text-emerald-600 animate-pulse">Loading FindSpot…</div>;

  const shouldShowBackupReminder = showBackupReminder && (location.pathname === "/" || location.pathname === "/settings");

  return (
    <div className="max-w-6xl mx-auto p-3 pb-28 sm:p-4 font-sans text-gray-900 dark:text-gray-100 min-h-screen overflow-x-hidden">
      {isInAppBrowser && (
        <div className="bg-emerald-600 text-white p-4 rounded-xl mb-4 shadow-lg flex flex-col items-center gap-3 text-center border-2 border-white animate-pulse">
            <div className="text-2xl">{isIOS ? "🍎" : "🌍"}</div>
            <div>
                <h3 className="font-black uppercase tracking-tight text-lg text-white">
                    {isIOS ? "Open in Safari to Install" : "Open in Chrome & Install"}
                </h3>
                <p className="text-xs opacity-90 leading-tight mt-1 text-emerald-50">
                    {isIOS 
                        ? "Tap the ⋯ menu and select 'Open in External Browser' or 'Open in Safari' to install."
                        : "To install FindSpot and save data properly, open it in Chrome then tap 'Add to Home Screen'."}
                </p>
            </div>
            {!isIOS ? (
                <a 
                    href={androidIntentUrl}
                    className="bg-white text-emerald-600 font-black px-6 py-2 rounded-full text-sm uppercase tracking-widest hover:bg-emerald-50 transition-colors shadow-md no-underline"
                >
                    Open & Install
                </a>
            ) : (
                <div className="bg-emerald-700/50 p-2 rounded-lg text-[10px] font-mono border border-emerald-400">
                    Step: Tap ⋯ → Open in External Browser
                </div>
            )}
            <button 
                onClick={() => setIsInAppBrowser(false)} 
                className="text-[10px] opacity-70 hover:opacity-100 underline"
            >
                Continue anyway (Not Recommended)
            </button>
        </div>
      )}

      <header className="mb-4 flex flex-col gap-3 border-b border-gray-200/80 bg-white/80 px-3 pb-3 pt-2 backdrop-blur dark:border-gray-800 dark:bg-gray-900/75 sm:mb-6 sm:gap-4 sm:px-4 sm:pt-3">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
            <Link to="/" className="no-underline flex items-center gap-2 sm:gap-3 group min-w-0 outline-none [-webkit-tap-highlight-color:transparent] focus:outline-none focus-visible:rounded-lg focus-visible:ring-2 focus-visible:ring-emerald-400/60">
              <Logo />
              <h1 className="m-0 text-xl min-[360px]:text-2xl sm:text-4xl font-black tracking-tight bg-gradient-to-r from-emerald-500 via-teal-500 to-sky-500 bg-clip-text text-transparent group-hover:from-emerald-400 group-hover:to-sky-400 transition-all duration-500">FindSpot</h1>
            </Link>
            
            <div className="flex items-center gap-1 sm:gap-2 border-l border-gray-200 pl-2 dark:border-gray-700 sm:border-0 sm:pl-0 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowClubRallyModal(true)}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl px-0.5 transition-colors"
                  aria-label="Club/Rally tools"
                >
                  <span className="inline-flex h-6 items-center justify-center rounded-full border border-gray-200 bg-white/70 px-1.5 text-[9px] font-bold leading-none text-gray-500 transition-colors hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-400 dark:hover:border-teal-700 dark:hover:bg-teal-950/30 dark:hover:text-teal-300 whitespace-nowrap">
                    Club/Rally
                  </span>
                </button>
                <NavLink to="/settings" aria-label="Settings" className={({ isActive }) => `inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors text-xs sm:min-h-0 sm:min-w-0 sm:rounded-none sm:text-sm font-medium text-gray-600 dark:text-gray-300 ${isActive ? "text-emerald-600 dark:text-emerald-400 font-bold" : ""}`}>
                  <span className="min-[400px]:hidden text-xl leading-none">⚙</span>
                  <span className="hidden min-[400px]:inline">Settings</span>
                </NavLink>
            </div>
        </div>

        <div className="hidden sm:flex items-center justify-between gap-4 flex-wrap">
            <nav className="flex gap-x-3 sm:gap-x-5 gap-y-2 flex-wrap items-center text-[13px] sm:text-sm font-medium text-gray-600 dark:text-gray-300">
              <NavLink to="/" className={({ isActive }) => `hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors ${isActive ? "text-emerald-600 dark:text-emerald-400 font-bold" : ""}`}>Home</NavLink>
              <NavLink to="/fieldguide" className={({ isActive }) => `hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors ${isActive ? "text-emerald-600 dark:text-emerald-400 font-bold" : ""}`}>
                FieldGuide
              </NavLink>
              <NavLink to="/permissions" className={({ isActive }) => `hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors ${isActive ? "text-emerald-600 dark:text-emerald-400 font-bold" : ""}`}>
                Permissions
              </NavLink>
              <NavLink to="/discover" className={({ isActive }) => `hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors ${isActive ? "text-emerald-600 dark:text-emerald-400 font-bold" : ""}`}>Discover</NavLink>
              <NavLink to="/finds-box" className={({ isActive }) => `hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors ${isActive ? "text-emerald-600 dark:text-emerald-400 font-bold" : ""}`}>Finds</NavLink>
            </nav>

            <div className="hidden sm:flex items-center gap-3">
                <div className="opacity-60 text-[10px] font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded max-w-[100px] truncate">{project.name}</div>
            </div>
        </div>
      </header>

      <main>
        {needRefresh && (
          <div className="mb-4 bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 rounded-xl p-4 flex items-center justify-between gap-4">
            <div className="text-sm text-sky-800 dark:text-sky-300">
              <span className="font-bold">Update available.</span> {UPDATE_NOTES}
            </div>
            <button
              onClick={async () => {
                if (await confirmAction({
                  title: "Update FindSpot?",
                  message: "Any unsaved changes will be lost while the app reloads.",
                  confirmLabel: "Update Now",
                })) {
                  updateServiceWorker(true);
                }
              }}
              className="bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors shrink-0"
            >
              Update Now
            </button>
          </div>
        )}
        {showQuotaWarning && (
          <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-xl">🔴</span>
              <div>
                <h4 className="text-sm font-bold text-red-900 dark:text-red-100">Storage Almost Full</h4>
                <p className="text-xs text-red-800 dark:text-red-300 opacity-80">Your device storage is over 80% full. Back up your data now to avoid losing finds.</p>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => { setShowQuotaWarning(false); nav("/settings"); }} className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors">Back Up Now</button>
              <button onClick={() => setShowQuotaWarning(false)} className="text-red-700 dark:text-red-400 text-xs font-bold hover:underline px-2">Dismiss</button>
            </div>
          </div>
        )}
        {shouldShowBackupReminder && (
          <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4 animate-in fade-in slide-in-from-top-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-2xl">🛡️</span>
              <div>
                <h4 className="text-sm font-bold text-amber-900 dark:text-amber-100">Backup Recommended</h4>
                <p className="text-xs text-amber-800 dark:text-amber-300 opacity-80">It's been a while since your last backup. Since FindSpot is local-only, a backup protects your finds if your device is lost or broken.</p>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => { setShowBackupReminder(false); nav("/settings"); }}
                className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors"
              >
                Go to Settings →
              </button>
              <button
                onClick={snoozeBackup}
                className="text-amber-700 dark:text-amber-400 text-xs font-bold hover:underline px-2"
              >
                Later
              </button>
            </div>
          </div>
        )}
        {resumableSf && !sfWorkflow.isOpen && !resumeDismissed && (
          <ResumeSignificantFindBanner
            sf={resumableSf}
            onResume={() => void openSignificantFind("manual", buildResumeContext(resumableSf))}
            onDismiss={() => setResumeDismissed(true)}
          />
        )}
        <PageErrorBoundary>
        <Suspense fallback={<div className="p-8 text-center text-emerald-600 font-bold animate-pulse">Loading…</div>}>
        <Routes>
            <Route path="/" element={<HomeRouter projectId={projectId} isStandalone={isStandalone} promptInstall={promptInstall} />} />
            <Route path="/permission" element={<PermissionPage projectId={projectId} onSaved={(id) => nav(`/permission/${id}`)} />} />
            <Route path="/permission/:id" element={<PermissionPage projectId={projectId} onSaved={() => {}} />} />
            <Route path="/permissions" element={<AllPermissions projectId={projectId} />} />
            <Route path="/session/new" element={<SessionPage projectId={projectId} onSignificantFind={(context) => { void openSignificantFind("manual", context); }} />} />
            <Route path="/session/:id" element={<SessionPage projectId={projectId} onSignificantFind={(context) => { void openSignificantFind("manual", context); }} />} />
            <Route path="/find" element={<FindRouter projectId={projectId} onSignificantFind={(context) => { void openSignificantFind("manual", context); }} />} />
            <Route path="/discover" element={<Discover projectId={projectId} />} />
            <Route path="/finds" element={<AllFinds projectId={projectId} />} />
            <Route path="/finds-box" element={<FindsBox projectId={projectId} />} />
            <Route path="/pending" element={<PendingFinds projectId={projectId} />} />
            <Route path="/fieldguide" element={<FieldGuide projectId={projectId} onSignificantFind={(context) => { void openSignificantFind("auto", context); }} />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/join" element={<JoinClubDay />} />
        </Routes>
        </Suspense>
        </PageErrorBoundary>
      </main>

      <footer className="hidden sm:flex items-center justify-between gap-4 border-t border-gray-200/80 px-4 py-3 text-[10px] font-bold text-gray-400 dark:border-gray-800 dark:text-gray-600">
        <span>{FINDSPOT_COPYRIGHT_NOTICE}</span>
        <Link to="/settings?tab=app&section=terms" className="text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 dark:hover:text-emerald-300">
          Terms &amp; IP
        </Link>
      </footer>

      <nav className="sm:hidden fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white/95 px-2 pb-[calc(0.4rem+env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-8px_24px_rgba(15,23,42,0.12)] backdrop-blur dark:border-gray-800 dark:bg-gray-950/95" aria-label="Primary">
        <div className="mx-auto grid max-w-md grid-cols-5 gap-1">
          {[
            { to: "/", label: "Home", icon: "⌂" },
            { to: "/fieldguide", label: "FieldGuide", icon: "◎" },
            { to: "/permissions", label: "Permissions", icon: "□" },
            { to: "/discover", label: "Discover", icon: "⌕" },
            { to: "/finds-box", label: "Finds", icon: "☆" },
          ].map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) => `flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[10px] font-black transition-colors ${isActive ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "text-gray-500 dark:text-gray-400"}`}
            >
              <span className="text-lg leading-none" aria-hidden="true">{item.icon}</span>
              <span className="max-w-full truncate">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      {showClubRallyModal && (
        <ClubRallyChoiceModal
          onClose={() => setShowClubRallyModal(false)}
          onSolo={() => { setShowClubRallyModal(false); nav("/permission?type=rally"); }}
          onJoinUrl={(url) => { setShowClubRallyModal(false); nav(url); }}
          onOrganiseNew={() => { setShowClubRallyModal(false); nav("/permission?type=rally&organiserSetup=true"); }}
          onOrganiseExisting={(id) => { setShowClubRallyModal(false); nav(`/permission/${id}?openClubDay=true`); }}
          permissions={clubRallyPermissions || []}
        />
      )}

      <GlobalActions projectId={projectId} onSignificantFind={(context) => { void openSignificantFind("manual", context); }} />
      <OnboardingFlow />
      {confirmDialog}
      <SignificantFindWorkflow
        isOpen={sfWorkflow.isOpen}
        workflowState={sfWorkflow.workflowState}
        onClose={sfWorkflow.close}
        updateState={sfWorkflow.updateState}
        goToStep={sfWorkflow.goToStep}
        setPath={sfWorkflow.setPath}
      />
    </div>
  );
}


function ResumeSignificantFindBanner({
  sf,
  onResume,
  onDismiss,
}: {
  sf: SignificantFind;
  onResume: () => void;
  onDismiss: () => void;
}) {
  const path = sf.path as NonNullable<WorkflowPath>;
  const pathLabel = PATH_LABELS[sf.path];
  const stepOrder = PATH_STEP_ORDER[path] ?? [];
  const stepIdx = sf.workflowStep ? stepOrder.indexOf(sf.workflowStep as WorkflowStep) : -1;
  const totalSteps = stepOrder.length;

  const age = React.useMemo(() => {
    const diffMs = Date.now() - new Date(sf.updatedAt).getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 2) return "just now";
    if (diffMin < 60) return `${diffMin} minutes ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH} hour${diffH !== 1 ? "s" : ""} ago`;
    const diffD = Math.floor(diffH / 24);
    return `${diffD} day${diffD !== 1 ? "s" : ""} ago`;
  }, [sf.updatedAt]);

  return (
    <div className="mb-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in slide-in-from-top-4">
      <div className="flex items-start gap-3 min-w-0">
        <span className="text-xl shrink-0" aria-hidden="true">⏸</span>
        <div className="min-w-0">
          <p className="text-sm font-black text-amber-900 dark:text-amber-100">
            Resume {pathLabel}
            {stepIdx >= 0 ? ` — step ${stepIdx + 1} of ${totalSteps}` : ""}
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
            {sf.findDescription || "Significant find"} · Interrupted {age}
          </p>
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={onResume}
          className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-black px-4 py-2 rounded-lg transition-colors"
        >
          Resume
        </button>
        <button
          onClick={onDismiss}
          className="text-amber-700 dark:text-amber-400 text-xs font-bold hover:underline px-2"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function HomeRouter({ projectId, isStandalone, promptInstall }: { projectId: string; isStandalone: boolean; promptInstall: () => Promise<boolean> }) {
  const nav = useNavigate();
  return (
    <Home
      projectId={projectId}
      isStandalone={isStandalone}
      promptInstall={promptInstall}
      goPermission={() => nav("/permission")}
      goPermissionWithParam={(type: string) => nav(`/permission?type=${type}`)}
      goPermissionEdit={(id: string) => nav(`/permission/${id}`)}
      goPermissions={() => nav("/permissions")}
      goFind={(permissionId?: string, quickId?: string) => {
        const params = new URLSearchParams();
        if (permissionId) params.set("permissionId", permissionId);
        if (quickId) params.set("quickId", quickId);
        const q = params.toString();
        nav(`/find${q ? `?${q}` : ""}`);
      }}
      goAllFinds={() => nav("/finds-box")}
      goFindsWithFilter={(filter: string) => filter === 'filter=pending' ? nav('/pending') : nav(`/finds-box?${filter}`)}
      goFindsBox={() => nav("/finds-box")}
      goFieldGuide={() => nav("/fieldguide")}
    />
  );
}

function FindRouter({ projectId, onSignificantFind }: { projectId: string; onSignificantFind?: (initialContext?: Partial<WorkflowState>) => void }) {
  const [params] = useSearchParams();
  const permissionId = params.get("permissionId");
  const sessionId = params.get("sessionId");
  const fieldId = params.get("fieldId");
  const quickId = params.get("quickId");
  const lat = params.get("lat");
  const lon = params.get("lon");
  const manual = params.get("manual") === "true";
  const mode = params.get("mode");
  return <FindPage
    projectId={projectId}
    permissionId={permissionId ?? null}
    sessionId={sessionId ?? null}
    fieldId={fieldId ?? null}
    quickId={quickId ?? null}
    initialLat={lat ? parseFloat(lat) : null}
    initialLon={lon ? parseFloat(lon) : null}
    initialMode={mode === "quick" || mode === "full" ? mode : null}
    manual={manual}
    onSignificantFind={onSignificantFind}
  />;
}

class PageErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="p-8 text-center border border-red-200 rounded-xl bg-red-50 dark:bg-red-900/10 dark:border-red-800 mt-4">
          <p className="text-red-700 dark:text-red-400 font-bold mb-2">This page failed to load.</p>
          <p className="text-xs text-red-600 dark:text-red-500 mb-4 font-mono">{this.state.error.message}</p>
          <button onClick={() => this.setState({ error: null })} className="text-sm text-emerald-600 dark:text-emerald-400 font-bold underline">Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "2rem", fontFamily: "monospace", background: "#111", color: "#fff", minHeight: "100vh" }}>
          <h2 style={{ color: "#ef4444" }}>App Error</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: "12px", color: "#fca5a5" }}>{this.state.error.message}</pre>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: "10px", opacity: 0.6 }}>{this.state.error.stack}</pre>
          <button onClick={() => window.location.reload()} style={{ marginTop: "1rem", padding: "0.5rem 1rem", background: "#10b981", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer" }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <AppErrorBoundary>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Shell />
      </BrowserRouter>
    </AppErrorBoundary>
  );
}
