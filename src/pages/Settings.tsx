import React, { useEffect, useState } from "react";
import { isStoragePersistent, requestPersistentStorage, getSetting, setSetting } from "../services/data";

const POPULAR_MODELS = [
  "Minelab Equinox 900", 
  "Minelab Equinox 800", 
  "Minelab Equinox 700",
  "Minelab Equinox 600",
  "Minelab Manticore", 
  "Minelab CTX 3030",
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
  "Garrett AT Pro", 
  "Garrett Apex", 
  "Garrett Ace 400i",
  "Garrett Ace 300i",
  "Garrett Ace 200i",
  "Garrett Ace Apex",
  "Teknetics T2",
  "Teknetics G2",
  "Fisher F75",
  "C.Scope 6MXi",
  "C.Scope 4MXi"
].sort();

export default function Settings() {
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [detectorist, setDetectorist] = useState("");
  const [email, setEmail] = useState("");
  const [ncmdNumber, setNcmdNumber] = useState("");
  const [ncmdExpiry, setNcmdExpiry] = useState("");
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [theme, setTheme] = useState("dark");
  const [detectors, setDetectors] = useState<string[]>([]);
  const [defaultDetector, setDefaultDetector] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [installCount, setInstallCount] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [persistenceMsg, setPersistenceMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [eggPhase, setEggPhase] = useState<'idle' | 'signal' | 'mission'>('idle');

  useEffect(() => {
    isStoragePersistent().then(setPersistent);
    getSetting("detectorist", "").then(setDetectorist);
    getSetting("detectoristEmail", "").then(setEmail);
    getSetting("ncmdNumber", "").then(setNcmdNumber);
    getSetting("ncmdExpiry", "").then(setNcmdExpiry);
    getSetting("lastBackupDate", null).then(setLastBackup);
    getSetting("theme", "dark").then(setTheme);
    getSetting("detectors", ["Minelab Equinox 800", "Nokta Legend"]).then(val => {
      if (Array.isArray(val)) setDetectors(val);
      else setDetectors(["Minelab Equinox 800", "Nokta Legend"]);
    });
    getSetting("defaultDetector", "").then(setDefaultDetector);

    // Fetch Community Stats — non-critical, abort after 5s
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    fetch("https://api.counterapi.dev/v1/findspot-uk/installs/", { signal: controller.signal })
      .then(res => res.json())
      .then(data => {
        clearTimeout(timeoutId);
        if (data && typeof data.count === 'number') setInstallCount(data.count);
      })
      .catch(() => {}); // Non-critical — ignore failures

    return () => {
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, []);

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

  async function saveSettings() {
    await setSetting("detectorist", detectorist);
    await setSetting("detectoristEmail", email);
    await setSetting("ncmdNumber", ncmdNumber);
    await setSetting("ncmdExpiry", ncmdExpiry);
    await setSetting("defaultDetector", defaultDetector);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 pb-20 mt-4">
      <h1 className="text-2xl sm:text-3xl font-black mb-8 bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">Settings</h1>

      <div className="space-y-8">
        <section className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <span>🎨</span> Appearance
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
              {theme === "dark" ? "🌙 Dark" : "☀️ Light"}
            </button>
          </div>
        </section>

        <section className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <span>🔍</span> Detector Profiles
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
                onChange={(e) => setDefaultDetector(e.target.value)}
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

        <section className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <span>👤</span> User Preferences
          </h2>
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Default Detectorist Name</label>
                <input
                  type="text"
                  value={detectorist}
                  onChange={(e) => setDetectorist(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="john@example.com"
                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-1 italic">These details will be used as the default for new records and included in your reports.</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-gray-100 dark:border-gray-700">
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">NCMD Membership No.</label>
                <input
                  type="text"
                  value={ncmdNumber}
                  onChange={(e) => setNcmdNumber(e.target.value)}
                  placeholder="e.g. 123456"
                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Insurance Expiry Date</label>
                <input
                  type="date"
                  value={ncmdExpiry}
                  onChange={(e) => setNcmdExpiry(e.target.value)}
                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1 italic sm:col-span-2">Your National Council for Metal Detecting insurance details for landowner peace of mind.</p>
            </div>

            <button
              onClick={saveSettings}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 px-6 rounded-lg transition-colors flex items-center gap-2"
            >
              {saved ? "✓ Saved" : "Save Preferences"}
            </button>
          </div>
        </section>

        <section className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <span>💾</span> Local Data & Persistence
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
                <h3 className="font-bold text-gray-800 dark:text-gray-100">Last Backup</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {lastBackup 
                    ? `Last backed up on ${new Date(lastBackup).toLocaleDateString()} at ${new Date(lastBackup).toLocaleTimeString()}`
                    : "You haven't backed up your data yet."}
                </p>
              </div>
              <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded ${lastBackup ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                {lastBackup ? "Protected" : "Unprotected"}
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

        <section className="bg-amber-50 dark:bg-amber-900/20 p-5 rounded-2xl border border-amber-200 dark:border-amber-800/50 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-black text-amber-700 dark:text-amber-400 mb-0.5">Quick Start Guide</h2>
            <p className="text-xs text-amber-600/70 dark:text-amber-500/70">Walk through the app features again from the beginning.</p>
          </div>
          <button
            onClick={() => { localStorage.removeItem('fs_onboarding_done'); localStorage.setItem('fs_onboarding_force', '1'); window.location.href = '/'; }}
            className="shrink-0 text-xs font-black text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40 hover:bg-amber-200 dark:hover:bg-amber-800/60 border border-amber-300 dark:border-amber-700 px-3 py-2 rounded-lg transition-colors"
          >
            Show again →
          </button>
        </section>

        <section className="bg-emerald-50 dark:bg-emerald-900/20 p-6 rounded-2xl border border-emerald-100 dark:border-emerald-800/50">
          <h2 className="text-lg font-bold text-emerald-800 dark:text-emerald-300 mb-2 flex items-center gap-2">
            <span>🛡️</span> Privacy Guarantee
          </h2>
          <p className="text-sm text-emerald-700 dark:text-emerald-400 leading-relaxed">
            FindSpot is built to be <strong>local-first</strong>. Your data never leaves this device unless you explicitly export it. 
            There are no servers, no tracking, and no cloud synchronization. Your find spots are your secrets.
          </p>
        </section>

        {typeof installCount === 'number' && (
          <div className="mt-2 flex flex-col items-end pr-2 gap-1">
            <div
              className="flex items-center gap-1 opacity-40 hover:opacity-100 transition-opacity cursor-default"
              onClick={() => {
                if (eggPhase !== 'idle') return;
                setEggPhase('signal');
                setTimeout(() => setEggPhase('mission'), 3500);
                setTimeout(() => setEggPhase('idle'), 9000);
              }}
            >
              <span className="text-[8px] font-black uppercase tracking-widest text-emerald-800 dark:text-emerald-400">#</span>
              <span className="text-[9px] font-black text-emerald-900 dark:text-emerald-200 tabular-nums">{installCount.toLocaleString()}</span>
            </div>
            <div
              className="overflow-hidden transition-all duration-700 ease-in-out"
              style={{ maxHeight: eggPhase === 'signal' ? '80px' : '0px', opacity: eggPhase === 'signal' ? 1 : 0 }}
            >
              <div className="mt-1 px-3 py-2 rounded-lg border border-emerald-400/30 dark:border-emerald-500/20 bg-emerald-50/60 dark:bg-emerald-950/40 text-right">
                <p className="text-[10px] font-mono tracking-wide text-emerald-700 dark:text-emerald-400 leading-relaxed">
                  Signal detected.<br />
                  <span className="opacity-70">Most wouldn't have noticed that.</span>
                </p>
              </div>
            </div>
            <div
              className="overflow-hidden transition-all duration-700 ease-in-out"
              style={{ maxHeight: eggPhase === 'mission' ? '80px' : '0px', opacity: eggPhase === 'mission' ? 1 : 0 }}
            >
              <div className="mt-1 px-3 py-2 rounded-lg border border-emerald-400/30 dark:border-emerald-500/20 bg-emerald-50/60 dark:bg-emerald-950/40 text-right">
                <p className="text-[10px] font-mono tracking-wide text-emerald-700 dark:text-emerald-400 leading-relaxed">
                  Leave a{' '}
                  <a
                    href="https://www.facebook.com/FindSpot/posts/pfbid02bQuUYmHua9Hg82jiL7bL3rjfaBHUcNAxZb9gKn9N5XtGXuidHFdzczPcGL5iVyXml"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2"
                  >
                    "Signal detected"
                  </a>
                  {' '}comment.<br />
                  <span className="opacity-70">You know where to find it.</span>
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
