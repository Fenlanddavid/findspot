import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { importClubDayPack, getSetting, setSetting } from "../services/data";
import { Logo } from "../App";

export default function JoinClubDay() {
  const [params] = useSearchParams();
  const nav = useNavigate();

  const sid   = params.get("sid") ?? "";
  const name  = params.get("n")   ?? "Club Day Event";
  const date  = params.get("d")   ?? "";
  const contact = params.get("c") ?? "";
  const email = params.get("e") ?? "";
  const instructions = params.get("i") ?? "";
  const publicNotes  = params.get("p") ?? "";

  const [recorderName, setRecorderName] = useState("");
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [alreadyJoined, setAlreadyJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSetting<string>("recorderName", "").then(v => {
      if (v) setRecorderName(v);
    });
  }, []);

  if (!sid) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50 dark:bg-gray-950">
        <div className="text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h1 className="text-lg font-black text-gray-800 dark:text-gray-100">Invalid Club Day link</h1>
          <p className="text-sm text-gray-500 mt-2">This link is missing event details. Ask your organiser to reshare it.</p>
        </div>
      </div>
    );
  }

  async function handleJoin() {
    if (!recorderName.trim()) {
      setError("Please enter your name so the organiser knows who recorded what.");
      return;
    }
    setJoining(true);
    setError(null);
    try {
      // Save the name for future exports
      await setSetting("recorderName", recorderName.trim());

      // Build a lightweight pack from URL params (no field boundaries)
      const pack = {
        type: "findspot-club-day-pack",
        version: 1,
        sharedPermissionId: sid,
        eventName: name,
        eventDate: date || new Date().toISOString().slice(0, 10),
        organiserContactNumber: contact || undefined,
        organiserEmail: email || undefined,
        significantFindInstructions: instructions || undefined,
        publicNotes: publicNotes || undefined,
        boundary: undefined,
        fields: [],
        createdAt: new Date().toISOString(),
      };

      const result = await importClubDayPack(JSON.stringify(pack));

      if (result.alreadyImported) {
        setAlreadyJoined(true);
      } else {
        setJoined(true);
      }
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong. Try again.");
    } finally {
      setJoining(false);
    }
  }

  const formattedDate = date
    ? new Date(date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : "";

  if (joined || alreadyJoined) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50 dark:bg-gray-950">
        <div className="w-full max-w-sm text-center space-y-5">
          <div className="w-16 h-16 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center mx-auto text-2xl font-black text-teal-600">
            {alreadyJoined ? "✓" : "✓"}
          </div>
          <div>
            <h1 className="text-xl font-black text-gray-900 dark:text-gray-100">
              {alreadyJoined ? "Already joined" : "You're in!"}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {alreadyJoined
                ? `${name} is already on your device.`
                : `${name} has been added to your permissions.`}
            </p>
          </div>
          <div className="p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl text-left space-y-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-teal-500 mb-2">What's next</div>
            <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
              Open FindSpot and find <strong className="text-gray-800 dark:text-gray-200">{name}</strong> in your permissions. Start a session when you're ready to detect.
            </p>
            {contact && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                📞 Organiser: <a href={`tel:${contact}`} className="font-bold text-teal-600 dark:text-teal-400 underline">{contact}</a>
              </p>
            )}
          </div>
          <button
            onClick={() => nav("/")}
            className="w-full bg-teal-600 hover:bg-teal-500 text-white py-3.5 rounded-2xl font-black text-sm uppercase tracking-widest transition-colors"
          >
            Open FindSpot
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-start justify-center p-4 pt-8">
      <div className="w-full max-w-sm space-y-5">

        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <Logo />
          </div>
          <div className="text-[9px] font-black uppercase tracking-widest text-teal-500">Club Day</div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-gray-100 leading-tight">{name}</h1>
          {formattedDate && (
            <p className="text-sm font-bold text-gray-500 dark:text-gray-400">{formattedDate}</p>
          )}
        </div>

        {/* Event details card */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4 space-y-3">
          {contact && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-base">📞</span>
              <div>
                <div className="text-[9px] font-black uppercase tracking-widest text-gray-400">Organiser</div>
                <a href={`tel:${contact}`} className="font-bold text-teal-600 dark:text-teal-400">{contact}</a>
              </div>
            </div>
          )}
          {instructions && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl">
              <span className="text-base shrink-0">⚠️</span>
              <div>
                <div className="text-[9px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400 mb-0.5">Significant Find?</div>
                <p className="text-xs text-amber-800 dark:text-amber-300">{instructions}</p>
              </div>
            </div>
          )}
          {publicNotes && (
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{publicNotes}</p>
          )}
        </div>

        {/* Name input */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4 space-y-3">
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1.5">
              Your name
            </label>
            <input
              type="text"
              value={recorderName}
              onChange={e => setRecorderName(e.target.value)}
              placeholder="e.g. John Smith"
              className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-teal-500 outline-none transition-all"
              autoComplete="name"
            />
            <p className="text-[10px] text-gray-400 mt-1.5">
              Shown to the organiser when you send your finds at the end of the day.
            </p>
          </div>

          {error && (
            <div className="px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <button
            onClick={handleJoin}
            disabled={joining || !recorderName.trim()}
            className="w-full bg-teal-600 hover:bg-teal-500 disabled:opacity-40 disabled:cursor-not-allowed text-white py-3.5 rounded-2xl font-black text-sm uppercase tracking-widest transition-colors"
          >
            {joining ? "Joining…" : "Join This Club Day"}
          </button>
        </div>

        {/* Install nudge for non-installed users */}
        <div className="p-4 bg-teal-50 dark:bg-teal-950/20 border border-teal-200 dark:border-teal-800 rounded-2xl text-xs text-teal-700 dark:text-teal-400 space-y-1.5 leading-relaxed">
          <p className="font-black text-[10px] uppercase tracking-widest">New to FindSpot?</p>
          <p>FindSpot is a free detecting app that stores everything on your device — no account needed.</p>
          <p>To install: tap your browser's <strong>Share</strong> or <strong>menu</strong> button and choose <strong>"Add to Home Screen"</strong>.</p>
        </div>

        <p className="text-[9px] text-gray-400 dark:text-gray-600 text-center leading-relaxed pb-8">
          No server. No account. Your data is stored only on your device.
        </p>

      </div>
    </div>
  );
}
