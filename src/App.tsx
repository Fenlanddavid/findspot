import React, { useEffect, useState, Suspense } from "react";
import { BrowserRouter, Routes, Route, Link, NavLink, useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { useRegisterSW } from 'virtual:pwa-register/react';
import { db } from "./db";
import { ensureDefaultProject, ensureDefaultPermission } from "./app/seed";
import { requestPersistentStorage, setSetting, getSetting } from "./services/data";

// Eagerly loaded — core navigation paths
import Home from "./pages/Home";
import PermissionPage from "./pages/Permission";
import FindPage from "./pages/Find";
import Settings from "./pages/Settings";
import GlobalActions from "./components/GlobalActions";
import OnboardingFlow from "./components/OnboardingFlow";

// Lazily loaded — heavy pages (map, PDF, turf)
const SessionPage = React.lazy(() => import("./pages/Session"));
const AllFinds = React.lazy(() => import("./pages/AllFinds"));
const FindsBox = React.lazy(() => import("./pages/FindsBox"));
const AllPermissions = React.lazy(() => import("./pages/AllPermissions"));
const FieldGuide = React.lazy(() => import("./pages/FieldGuide"));
const Discover = React.lazy(() => import("./pages/Discover"));

export function Logo() {
  return (
    <svg className="w-10 h-10 sm:w-16 sm:h-16" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="50%" stopColor="#14b8a6" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>
      
      {/* Outer Ring */}
      <circle cx="256" cy="256" r="200" stroke="url(#logo-grad)" strokeWidth="32" fill="none" />
      
      {/* Middle Ring */}
      <circle cx="256" cy="256" r="120" stroke="url(#logo-grad)" strokeWidth="24" fill="none" opacity="0.6" />
      
      {/* Center Bullseye */}
      <circle cx="256" cy="256" r="50" fill="url(#logo-grad)" />
      
      {/* Crosshairs */}
      <rect x="244" y="20" width="24" height="80" rx="4" fill="url(#logo-grad)" opacity="0.4" />
      <rect x="244" y="412" width="24" height="80" rx="4" fill="url(#logo-grad)" opacity="0.4" />
      <rect x="20" y="244" width="80" height="24" rx="4" fill="url(#logo-grad)" opacity="0.4" />
      <rect x="412" y="244" width="80" height="24" rx="4" fill="url(#logo-grad)" opacity="0.4" />
    </svg>
  );
}

function Shell() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [showBackupReminder, setShowBackupReminder] = useState(false);
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(true);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [showQuotaWarning, setShowQuotaWarning] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    ensureDefaultProject().then(async (id) => {
      await ensureDefaultPermission(id);
      setProjectId(id);
    });
    requestPersistentStorage();

    // Track unique installation (one-time per device)
    const trackInstallation = async () => {
      try {
        const isInstalled = localStorage.getItem("fs_installed");
        if (!isInstalled) {
          await fetch("https://api.counterapi.dev/v1/findspot-uk/installs/up");
          localStorage.setItem("fs_installed", "true");
        }
      } catch (e) {
        console.error("Installation tracking failed", e);
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
  }, []);

  const androidIntentUrl = `intent://${window.location.host}${window.location.pathname}#Intent;scheme=https;package=com.android.chrome;end`;

  async function checkBackupStatus() {
    // Check if there is any data worth backing up
    const permCount = await db.permissions.count();
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
  }

  async function snoozeBackup() {
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    await setSetting("backupSnoozedUntil", thirtyDaysFromNow.toISOString());
    setShowBackupReminder(false);
  }

  const project = useLiveQuery(async () => (projectId ? db.projects.get(projectId) : null), [projectId]);
  const settings = useLiveQuery(() => db.settings.toArray());
  const theme = settings?.find(s => s.key === "theme")?.value ?? "dark";

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  if (!projectId || !project) return <div className="p-4 text-center font-bold text-emerald-600 animate-pulse">Loading FindSpot…</div>;

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 font-sans text-gray-900 dark:text-gray-100 min-h-screen overflow-x-hidden">
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

      <header className="flex flex-col gap-4 mb-6 border-b border-gray-200 dark:border-gray-700 pb-4">
        <div className="flex items-center justify-between gap-4">
            <Link to="/" className="no-underline flex items-center gap-3 group">
              <Logo />
              <h1 className="m-0 text-2xl sm:text-5xl font-black tracking-tighter bg-gradient-to-r from-emerald-500 via-teal-500 to-sky-500 bg-clip-text text-transparent group-hover:from-emerald-400 group-hover:to-sky-400 transition-all duration-500">FindSpot</h1>
            </Link>
            
            <div className="flex items-center gap-3 border-l pl-4 border-gray-300 dark:border-gray-600 sm:border-0 sm:pl-0">
                {!isStandalone && (
                  <div className="relative">
                    <button
                      onClick={() => setShowInstallHelp(h => !h)}
                      className="text-[10px] font-bold text-amber-600 dark:text-emerald-400 bg-amber-50 dark:bg-emerald-950/20 px-2 py-1 rounded border border-amber-200 dark:border-emerald-800 animate-pulse"
                    >
                      ⚠️ Not Installed
                    </button>
                    {showInstallHelp && (
                      <div className="absolute right-0 top-8 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl p-3 shadow-xl w-56 text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
                        Tap your browser's menu (⋮ or share icon) and select 'Add to Home Screen'.
                        <button onClick={() => setShowInstallHelp(false)} className="block mt-2 text-emerald-600 font-bold">Got it</button>
                      </div>
                    )}
                  </div>
                )}
                <NavLink to="/settings" className={({ isActive }) => `hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-300 ${isActive ? "text-emerald-600 dark:text-emerald-400 font-bold" : ""}`}>Settings</NavLink>
            </div>
        </div>

        <div className="flex items-center justify-between gap-4 flex-wrap">
            <nav className="flex gap-x-3 sm:gap-x-5 gap-y-2 flex-wrap items-center text-[13px] sm:text-sm font-medium text-gray-600 dark:text-gray-300">
              <NavLink to="/" className={({ isActive }) => `hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors ${isActive ? "text-emerald-600 dark:text-emerald-400 font-bold" : ""}`}>Home</NavLink>
              <NavLink to="/fieldguide" className={({ isActive }) => `hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors ${isActive ? "text-emerald-600 dark:text-emerald-400 font-bold" : ""}`}>FieldGuide</NavLink>
              <NavLink to="/permissions" className={({ isActive }) => `hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors ${isActive ? "text-emerald-600 dark:text-emerald-400 font-bold" : ""}`}>Permissions</NavLink>
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
              <span className="font-bold">Update available.</span> A new version of FindSpot is ready to install.
            </div>
            <button
              onClick={() => {
                if (confirm("Update FindSpot now? Any unsaved changes will be lost.")) {
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
        {showBackupReminder && (
          <div className="mb-6 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 animate-in fade-in slide-in-from-top-4">
            <div className="flex items-center gap-3">
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
        <PageErrorBoundary>
        <Suspense fallback={<div className="p-8 text-center text-emerald-600 font-bold animate-pulse">Loading…</div>}>
        <Routes>
            <Route path="/" element={<HomeRouter projectId={projectId} />} />
            <Route path="/permission" element={<PermissionPage projectId={projectId} onSaved={(id) => nav(`/permission/${id}`)} />} />
            <Route path="/permission/:id" element={<PermissionPage projectId={projectId} onSaved={() => {}} />} />
            <Route path="/permissions" element={<AllPermissions projectId={projectId} />} />
            <Route path="/session/new" element={<SessionPage projectId={projectId} />} />
            <Route path="/session/:id" element={<SessionPage projectId={projectId} />} />
            <Route path="/find" element={<FindRouter projectId={projectId} />} />
            <Route path="/discover" element={<Discover projectId={projectId} />} />
            <Route path="/finds" element={<AllFinds projectId={projectId} />} />
            <Route path="/finds-box" element={<FindsBox projectId={projectId} />} />
            <Route path="/fieldguide" element={<FieldGuide projectId={projectId} />} />
            <Route path="/settings" element={<Settings />} />
        </Routes>
        </Suspense>
        </PageErrorBoundary>
      </main>

      <GlobalActions projectId={projectId} />
      <OnboardingFlow />
    </div>
  );
}


function HomeRouter({ projectId }: { projectId: string }) {
  const nav = useNavigate();
  return (
    <Home
      projectId={projectId}
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
      goAllFinds={() => nav("/finds")}
      goFindsWithFilter={(filter: string) => nav(`/finds?${filter}`)}
      goFindsBox={() => nav("/finds-box")}
      goFieldGuide={() => nav("/fieldguide")}
    />
  );
}

function FindRouter({ projectId }: { projectId: string }) {
  const [params] = useSearchParams();
  const permissionId = params.get("permissionId");
  const sessionId = params.get("sessionId");
  const quickId = params.get("quickId");
  const lat = params.get("lat");
  const lon = params.get("lon");
  return <FindPage 
    projectId={projectId} 
    permissionId={permissionId ?? null} 
    sessionId={sessionId ?? null} 
    quickId={quickId ?? null}
    initialLat={lat ? parseFloat(lat) : null}
    initialLon={lon ? parseFloat(lon) : null}
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