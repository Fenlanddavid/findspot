import React, { useState } from "react";
import Modal from "./Modal";

export function ClubRallyChoiceModal({
  onClose,
  onSolo,
  onJoinUrl,
}: {
  onClose: () => void;
  onSolo: () => void;
  onJoinUrl: (url: string) => void;
}) {
  const [showPaste, setShowPaste] = useState(false);
  const [pastedUrl, setPastedUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);

  function handleGoLink() {
    const trimmed = pastedUrl.trim();
    setUrlError(null);

    let searchString: string | null = null;

    try {
      if (trimmed.startsWith("http")) {
        const parsed = new URL(trimmed);
        if (parsed.pathname.replace(/\/$/, "").endsWith("/join") && parsed.searchParams.get("sid")) {
          searchString = parsed.search;
        }
      } else {
        // Could be a relative path like /join?sid=... or just the query string
        const queryIndex = trimmed.indexOf("?");
        if (queryIndex !== -1) {
          const qs = trimmed.slice(queryIndex);
          const params = new URLSearchParams(qs);
          if (params.get("sid")) {
            searchString = qs;
          }
        }
      }
    } catch {
      // fall through to error
    }

    if (!searchString) {
      setUrlError("That doesn't look like a valid FindSpot club day link. Check the link from your organiser.");
      return;
    }

    onJoinUrl(`/join${searchString}`);
  }

  if (showPaste) {
    return (
      <Modal onClose={onClose} title="Join a club day">
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 leading-relaxed">
          Paste the link your organiser shared — from WhatsApp, email, or anywhere else.
        </p>

        <div className="mb-2">
          <input
            type="url"
            value={pastedUrl}
            onChange={e => { setPastedUrl(e.target.value); setUrlError(null); }}
            placeholder="Paste link here…"
            autoFocus
            className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-teal-500 outline-none transition-all"
          />
          {urlError && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1.5">{urlError}</p>
          )}
        </div>

        <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-6 leading-relaxed">
          Tip: scan the QR code with your phone camera — it will open the link automatically.
        </p>

        <div className="flex gap-3">
          <button
            onClick={() => { setShowPaste(false); setUrlError(null); setPastedUrl(""); }}
            className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-gray-500 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl transition-colors"
          >
            Back
          </button>
          <button
            onClick={handleGoLink}
            disabled={!pastedUrl.trim()}
            className="flex-1 bg-teal-600 hover:bg-teal-500 disabled:opacity-40 disabled:cursor-not-allowed text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
          >
            Join Event
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} title="Club Day / Rally">
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">How are you joining?</p>

      {/* Option 1 — Primary */}
      <div className="mb-3 p-4 bg-teal-50 dark:bg-teal-950/30 border-2 border-teal-200 dark:border-teal-800 rounded-2xl">
        <div className="text-[9px] font-black uppercase tracking-widest text-teal-500 mb-1">Organiser-led event</div>
        <h3 className="font-black text-gray-900 dark:text-gray-100 text-base mb-1">Join a club day</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">
          Scan a QR code or open a link from your organiser.
        </p>
        <button
          onClick={() => setShowPaste(true)}
          className="w-full bg-teal-600 hover:bg-teal-500 text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
        >
          Scan / Paste Link
        </button>
      </div>

      {/* Option 2 — Secondary */}
      <div className="p-4 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-2xl">
        <div className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Solo</div>
        <h3 className="font-black text-gray-900 dark:text-gray-100 text-base mb-1">Going solo</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">
          Log your own finds at a rally or event.
        </p>
        <button
          onClick={onSolo}
          className="w-full bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
        >
          Create Rally Permission
        </button>
      </div>
    </Modal>
  );
}
