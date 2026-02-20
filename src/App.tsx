import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Link, NavLink, useNavigate, useSearchParams, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";
import { ensureDefaultProject } from "./app/seed";
import { exportData, importData, exportToCSV, requestPersistentStorage, setSetting, getSetting } from "./services/data";

import Home from "./pages/Home";
import PermissionPage from "./pages/Permission";
import SessionPage from "./pages/Session";
import FindPage from "./pages/Find";
import MapPage from "./pages/Map";
import AllFinds from "./pages/AllFinds";
import AllPermissions from "./pages/AllPermissions";
import Settings from "./pages/Settings";

export function Logo() {
  return (
    <svg width="40" height="40" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#10b981" />
          <stop offset="50%" stop-color="#14b8a6" />
          <stop offset="100%" stop-color="#0ea5e9" />
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
  const [projectId, setProjectId] = useState<string | null>(null);
  const [showBackupReminder, setShowBackupReminder] = useState(false);
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(true);
  const nav = useNavigate();

  useEffect(() => {
    ensureDefaultProject().then(setProjectId);
    requestPersistentStorage();

    // Detect Standalone mode
    const isPWA = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
    setIsStandalone(!!isPWA);
    
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

  async function handleExport() {
    try {
      const json = await exportData();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `findspot-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      
      // Update last backup date
      await setSetting("lastBackupDate", new Date().toISOString());
    } catch (e) {
      alert("Export failed: " + e);
    }
  }

  async function handleCSVExport() {
    try {
      const csv = await exportToCSV();
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `findspot-records-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("CSV Export failed: " + e);
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm("This will merge imported data into your current database. Continue?")) return;
    
    try {
      const text = await file.text();
      await importData(text);
      alert("Import successful! Reloading to refresh data...");
      window.location.reload();
    } catch (e) {
      alert("Import failed: " + e);
    }
  }

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
              <h1 className="m-0 text-2xl sm:text-3xl font-black tracking-tighter bg-gradient-to-r from-emerald-500 via-teal-500 to-sky-500 bg-clip-text text-transparent group-hover:from-emerald-400 group-hover:to-sky-400 transition-all duration-500">FindSpot</h1>
            </Link>
            
            <div className="flex items-center gap-3 border-l pl-4 border-gray-300 dark:border-gray-600 sm:border-0 sm:pl-0">
                {!isStandalone && (
                  <button 
                    onClick={() => alert("To install FindSpot, tap your browser's menu (⋮ or share icon) and select 'Add to Home Screen'.")}
                    className="text-[10px] font-bold text-amber-600 dark:text-emerald-400 bg-amber-50 dark:bg-emerald-950/20 px-2 py-1 rounded border border-amber-200 dark:border-emerald-800 animate-pulse"
                  >
                    ⚠️ Not Installed
                  </button>
                )}
                <button onClick={handleCSVExport} className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 hover:underline uppercase tracking-widest bg-emerald-50 dark:bg-emerald-950/30 px-2 py-1 rounded">
                    CSV
                </button>
                <div className="hidden sm:flex gap-3 items-center">
                    <button onClick={handleExport} className="text-xs font-medium opacity-70 hover:opacity-100 hover:text-emerald-600 transition-colors">
                        Backup
                    </button>
                    <label className="text-xs font-medium opacity-70 hover:opacity-100 hover:text-emerald-600 transition-colors cursor-pointer">
                        Restore
                        <input type="file" accept=".json" onChange={handleImport} className="hidden" />
                    </label>
                </div>
            </div>
        </div>

        <div className="flex items-center justify-between gap-4 flex-wrap">
            <nav className="flex gap-x-4 gap-y-2 flex-wrap items-center text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-300">
              <NavLink to="/" className={({ isActive }) => `hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors ${isActive ? "text-emerald-600 dark:text-emerald-400 font-bold" : ""}`}>Home</NavLink>
              <NavLink to="/map" className={({ isActive }) => `hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors ${isActive ? "text-emerald-600 dark:text-emerald-400 font-bold" : ""}`}>Map</NavLink>
              <NavLink to="/permissions" className={({ isActive }) => `hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors ${isActive ? "text-emerald-600 dark:text-emerald-400 font-bold" : ""}`}>Permissions</NavLink>
              <NavLink to="/find" className={({ isActive }) => `hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors ${isActive ? "text-emerald-600 dark:text-emerald-400 font-bold" : ""}`}>Club Dig</NavLink>
              <NavLink to="/settings" className={({ isActive }) => `hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors ${isActive ? "text-emerald-600 dark:text-emerald-400 font-bold" : ""}`}>Settings</NavLink>
            </nav>

            <div className="flex items-center gap-3">
                <div className="opacity-60 text-[10px] font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded max-w-[100px] truncate">{project.name}</div>
                <div className="flex sm:hidden gap-3 items-center">
                    <button onClick={handleExport} className="text-xs font-medium opacity-70 hover:opacity-100 hover:text-emerald-600 transition-colors">
                        Backup
                    </button>
                    <label className="text-xs font-medium opacity-70 hover:opacity-100 hover:text-emerald-600 transition-colors cursor-pointer">
                        Restore
                        <input type="file" accept=".json" onChange={handleImport} className="hidden" />
                    </label>
                </div>
            </div>
        </div>
      </header>

      <main>
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
                onClick={() => {
                  handleExport();
                  setShowBackupReminder(false);
                }}
                className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors"
              >
                Backup Now
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
        <Routes>
            <Route path="/" element={<HomeRouter projectId={projectId} />} />
            <Route path="/permission" element={<PermissionPage projectId={projectId} onSaved={(id) => nav(`/session/new?permissionId=${encodeURIComponent(id)}`)} />} />
            <Route path="/permission/:id" element={<PermissionPage projectId={projectId} onSaved={() => {}} />} />
            <Route path="/permissions" element={<AllPermissions projectId={projectId} />} />
            <Route path="/session/new" element={<SessionPage projectId={projectId} />} />
            <Route path="/session/:id" element={<SessionPage projectId={projectId} />} />
            <Route path="/find" element={<FindRouter projectId={projectId} />} />
            <Route path="/finds" element={<AllFinds projectId={projectId} />} />
            <Route path="/map" element={<MapPage projectId={projectId} />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/permission" element={<LinkToPermission />} />
            <Route path="/permission/:id" element={<LinkToPermission />} />
        </Routes>
      </main>
    </div>
  );
}

function LinkToPermission() {
    const nav = useNavigate();
    const { id } = useParams();
    useEffect(() => {
        nav(id ? `/permission/${id}` : "/permission", { replace: true });
    }, [id, nav]);
    return null;
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
      goFind={(permissionId?: string) => {
        const q = permissionId ? `?permissionId=${encodeURIComponent(permissionId)}` : "";
        nav(`/find${q}`);
      }}
      goAllFinds={() => nav("/finds")}
      goFindsWithFilter={(filter: string) => nav(`/finds?${filter}`)}
      goMap={() => nav("/map")}
    />
  );
}

function FindRouter({ projectId }: { projectId: string }) {
  const [params] = useSearchParams();
  const permissionId = params.get("permissionId");
  const sessionId = params.get("sessionId");
  return <FindPage projectId={projectId} permissionId={permissionId ?? null} sessionId={sessionId ?? null} />;
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Shell />
    </BrowserRouter>
  );
}