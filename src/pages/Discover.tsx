import React, { useState, useEffect, useMemo } from "react";
import { v4 as uuid } from "uuid";

// ─── Types ────────────────────────────────────────────────────────────────────

type EventType = "rally" | "club_dig" | "other";
type VerificationStatus = "verified" | "community" | "unconfirmed";

export type DetectingEvent = {
  id: string;
  type: EventType;
  title: string;
  description?: string;
  startDate: string;
  endDate?: string;
  startTime?: string;
  town?: string;
  county?: string;
  postcode?: string;
  lat?: number;
  lon?: number;
  organiserName?: string;
  sourceUrl?: string;
  entryFee?: string;
  verificationStatus: VerificationStatus;
  createdAt: string;
};

export type ClubListing = {
  id: string;
  name: string;
  description?: string;
  town?: string;
  county?: string;
  postcode?: string;
  lat?: number;
  lon?: number;
  websiteUrl?: string;
  facebookUrl?: string;
  digDays?: string;
  contactName?: string;
  verificationStatus: VerificationStatus;
};

type UserLocation = { lat: number; lon: number };

// ─── Constants ────────────────────────────────────────────────────────────────

const RADIUS_OPTIONS = [10, 25, 50, 100] as const;
type Radius = (typeof RADIUS_OPTIONS)[number];

const TYPE_OPTIONS: { value: EventType | "all"; label: string }[] = [
  { value: "all", label: "All Events" },
  { value: "rally", label: "Rallies" },
  { value: "club_dig", label: "Club Digs" },
];

// JSON files served from /public — update these paths when you move to a hosted API.
const EVENTS_URL = "/findspot/events.json";
const CLUBS_URL = "/findspot/clubs.json";
// Submissions are POSTed here if available; always stored locally too.
const SUBMIT_URL = "https://findspot.app/api/submit";

const LOCAL_SUBMISSIONS_KEY = "fs_event_submissions";
const LOCAL_CLUB_SUBMISSIONS_KEY = "fs_club_submissions";
const EVENTS_CACHE_KEY = "fs_events_cache";
const CLUBS_CACHE_KEY = "fs_clubs_cache";
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// ─── Helpers ──────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isThisWeekend(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const day = now.getDay(); // 0=Sun, 6=Sat
  // Find the upcoming Saturday
  const daysToSat = day === 6 ? 0 : (6 - day);
  const sat = new Date(now);
  sat.setDate(now.getDate() + daysToSat);
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  sun.setHours(23, 59, 59, 999);
  return d >= sat && d <= sun;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function verificationStyle(s: VerificationStatus): string {
  switch (s) {
    case "verified":
      return "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800";
    case "community":
      return "text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-800";
    case "unconfirmed":
      return "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800";
  }
}

function verificationLabel(s: VerificationStatus): string {
  switch (s) {
    case "verified": return "✓ Verified";
    case "community": return "Community Added";
    case "unconfirmed": return "? Unconfirmed";
  }
}

function typeLabel(t: EventType): string {
  switch (t) {
    case "rally": return "Rally";
    case "club_dig": return "Club Dig";
    case "other": return "Event";
  }
}

async function fetchWithCache<T>(url: string, cacheKey: string): Promise<T[]> {
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const { data, ts } = JSON.parse(cached);
      if (Date.now() - ts < CACHE_TTL) return data as T[];
    }
  } catch {}

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(tid);
    if (!res.ok) return [];
    const json = await res.json();
    const data: T[] = Array.isArray(json) ? json : (json.items ?? []);
    localStorage.setItem(cacheKey, JSON.stringify({ data, ts: Date.now() }));
    return data;
  } catch {
    clearTimeout(tid);
    return [];
  }
}

// Resolve postcodes → lat/lon via postcodes.io (free, no key needed).
// Items that already have lat+lon are left untouched.
// Accepts full postcodes ("PE13 1AA") or outward codes ("PE13").
async function resolveCoordinates<T extends { lat?: number; lon?: number; postcode?: string }>(
  items: T[]
): Promise<T[]> {
  const unresolved = items.filter((i) => i.postcode && (i.lat == null || i.lon == null));
  if (unresolved.length === 0) return items;

  const outcodeCache = new Map<string, { lat: number; lon: number } | null>();

  await Promise.all(
    unresolved.map(async (item) => {
      const outcode = item.postcode!.trim().toUpperCase().split(" ")[0];
      if (outcodeCache.has(outcode)) return;
      try {
        const res = await fetch(`https://api.postcodes.io/outcodes/${outcode}`);
        if (res.ok) {
          const json = await res.json();
          outcodeCache.set(outcode, json.result ? { lat: json.result.latitude, lon: json.result.longitude } : null);
        } else {
          outcodeCache.set(outcode, null);
        }
      } catch {
        outcodeCache.set(outcode, null);
      }
    })
  );

  return items.map((item) => {
    if (item.lat != null && item.lon != null) return item;
    if (!item.postcode) return item;
    const outcode = item.postcode.trim().toUpperCase().split(" ")[0];
    const coords = outcodeCache.get(outcode);
    return coords ? { ...item, lat: coords.lat, lon: coords.lon } : item;
  });
}

function loadLocalSubmissions(): DetectingEvent[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_SUBMISSIONS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLocalSubmission(e: DetectingEvent) {
  const existing = loadLocalSubmissions();
  localStorage.setItem(LOCAL_SUBMISSIONS_KEY, JSON.stringify([...existing, e]));
}

function loadLocalClubSubmissions(): ClubListing[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_CLUB_SUBMISSIONS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLocalClubSubmission(c: ClubListing) {
  const existing = loadLocalClubSubmissions();
  localStorage.setItem(LOCAL_CLUB_SUBMISSIONS_KEY, JSON.stringify([...existing, c]));
}

// ─── EventCard ────────────────────────────────────────────────────────────────

function EventCard({
  event,
  distanceKm,
  onClick,
}: {
  event: DetectingEvent;
  distanceKm?: number;
  onClick: () => void;
}) {
  const dist = distanceKm != null ? ` • ${(distanceKm * 0.621371).toFixed(1)} mi` : "";
  const location = [event.town, event.county].filter(Boolean).join(", ");

  return (
    <div
      onClick={onClick}
      className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4 cursor-pointer hover:shadow-md hover:border-emerald-300 dark:hover:border-emerald-700 transition-all group"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-black text-sm text-gray-900 dark:text-gray-100 leading-tight group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
          {event.title}
        </h3>
        {event.sourceUrl && (
          <a
            href={event.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-gray-400 hover:text-emerald-500 shrink-0 mt-0.5"
            title="Open source"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        )}
      </div>
      <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1.5 flex flex-wrap gap-x-2 gap-y-0">
        <span className="font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-500">
          {typeLabel(event.type)}
        </span>
        <span>•</span>
        <span>{formatDate(event.startDate)}{dist}</span>
      </div>
      {location && (
        <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{location}</div>
      )}
      <div className="mt-2.5 flex items-center gap-2 flex-wrap">
        <span
          className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${verificationStyle(event.verificationStatus)}`}
        >
          {verificationLabel(event.verificationStatus)}
        </span>
        {event.entryFee && (
          <span className="text-[9px] text-gray-400 dark:text-gray-500">{event.entryFee}</span>
        )}
      </div>
    </div>
  );
}

// ─── ClubCard ─────────────────────────────────────────────────────────────────

function ClubCard({ club, distanceKm }: { club: ClubListing; distanceKm?: number }) {
  const dist = distanceKm != null ? `${(distanceKm * 0.621371).toFixed(1)} mi` : null;
  const location = [club.town, club.county].filter(Boolean).join(", ");
  const meta = [location, dist].filter(Boolean).join(" • ");

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-black text-sm text-gray-900 dark:text-gray-100">{club.name}</div>
          {meta && <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{meta}</div>}
        </div>
        <span className={`shrink-0 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${verificationStyle(club.verificationStatus)}`}>
          {verificationLabel(club.verificationStatus)}
        </span>
      </div>
      {club.description && (
        <p className="text-xs text-gray-600 dark:text-gray-300 mt-2 leading-relaxed">{club.description}</p>
      )}
      {club.digDays && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          {club.digDays}
        </div>
      )}
      {(club.facebookUrl || club.websiteUrl) && (
        <div className="mt-3 flex gap-2">
          {club.facebookUrl && (
            <a
              href={club.facebookUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[9px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 px-3 py-1.5 rounded-xl hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
            >
              Facebook
            </a>
          )}
          {club.websiteUrl && (
            <a
              href={club.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[9px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-3 py-1.5 rounded-xl hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
            >
              Website
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ─── EventDetailModal ─────────────────────────────────────────────────────────

function EventDetailModal({
  event,
  distanceKm,
  onClose,
}: {
  event: DetectingEvent;
  distanceKm?: number;
  onClose: () => void;
}) {
  const dist = distanceKm != null ? ` • ${(distanceKm * 0.621371).toFixed(1)} mi away` : "";
  const location = [event.town, event.county].filter(Boolean).join(", ");

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg p-6 shadow-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest text-emerald-500 mb-1">
              {typeLabel(event.type)}
            </div>
            <h2 className="text-xl font-black text-gray-900 dark:text-gray-100 leading-tight">{event.title}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 mt-1 shrink-0 text-lg">✕</button>
        </div>

        <div className="grid gap-3 text-sm">
          <Row label="Date">
            {formatDate(event.startDate)}
            {event.endDate && event.endDate !== event.startDate && ` – ${formatDate(event.endDate)}`}
            {event.startTime && ` at ${event.startTime}`}
          </Row>
          {location && <Row label="Location">{location}{dist}</Row>}
          {event.organiserName && <Row label="Organiser">{event.organiserName}</Row>}
          {event.entryFee && <Row label="Entry">{event.entryFee}</Row>}
          {event.description && (
            <div className="mt-1 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
              {event.description}
            </div>
          )}
        </div>

        <div className="mt-3">
          <span
            className={`text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-full border ${verificationStyle(event.verificationStatus)}`}
          >
            {verificationLabel(event.verificationStatus)}
          </span>
        </div>

        <div className="mt-5 flex gap-2">
          {event.sourceUrl && (
            <a
              href={event.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest py-3 rounded-xl text-center transition-colors"
            >
              Open Source
            </a>
          )}
          {event.lat != null && event.lon != null && (
            <a
              href={`https://maps.google.com/?q=${event.lat},${event.lon}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-[10px] font-black uppercase tracking-widest py-3 rounded-xl text-center transition-colors"
            >
              Directions
            </a>
          )}
          <button
            onClick={onClose}
            className="px-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-[10px] font-black uppercase tracking-widest"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="text-gray-400 w-16 text-[10px] font-bold uppercase shrink-0 pt-0.5">{label}</span>
      <span className="text-gray-700 dark:text-gray-300 font-medium">{children}</span>
    </div>
  );
}

// ─── SubmitEventModal ─────────────────────────────────────────────────────────

type DraftEvent = {
  type: EventType;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  startTime: string;
  town: string;
  county: string;
  postcode: string;
  organiserName: string;
  sourceUrl: string;
  entryFee: string;
};

const EMPTY_DRAFT: DraftEvent = {
  type: "rally", title: "", description: "", startDate: "", endDate: "",
  startTime: "", town: "", county: "", postcode: "", organiserName: "",
  sourceUrl: "", entryFee: "",
};

function SubmitEventModal({
  onClose,
  onSubmitted,
}: {
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [draft, setDraft] = useState<DraftEvent>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const update = (patch: Partial<DraftEvent>) => setDraft((p) => ({ ...p, ...patch }));

  async function submit() {
    setSubmitting(true);
    const newEvent: DetectingEvent = {
      id: uuid(),
      type: draft.type,
      title: draft.title.trim(),
      description: draft.description.trim() || undefined,
      startDate: draft.startDate,
      endDate: draft.endDate || undefined,
      startTime: draft.startTime || undefined,
      town: draft.town.trim() || undefined,
      county: draft.county.trim() || undefined,
      organiserName: draft.organiserName.trim() || undefined,
      sourceUrl: draft.sourceUrl.trim() || undefined,
      entryFee: draft.entryFee.trim() || undefined,
      verificationStatus: "unconfirmed",
      createdAt: new Date().toISOString(),
    };

    // Save locally so it appears in their own Discover screen immediately
    saveLocalSubmission(newEvent);

    // Send via Web3Forms — silent POST, no email app needed
    const typeLabelMap: Record<EventType, string> = {
      rally: "Rally",
      club_dig: "Club Dig",
      other: "Other Event",
    };
    const details = [
      `Event Type: ${typeLabelMap[newEvent.type]}`,
      `Title: ${newEvent.title}`,
      `Start Date: ${newEvent.startDate}`,
      newEvent.endDate       ? `End Date: ${newEvent.endDate}`           : null,
      newEvent.startTime     ? `Start Time: ${newEvent.startTime}`       : null,
      newEvent.town          ? `Town: ${newEvent.town}`                  : null,
      newEvent.county        ? `County: ${newEvent.county}`              : null,
      draft.postcode         ? `Postcode Area: ${draft.postcode}`        : null,
      newEvent.organiserName ? `Organiser: ${newEvent.organiserName}`    : null,
      newEvent.sourceUrl     ? `Source Link: ${newEvent.sourceUrl}`      : null,
      newEvent.entryFee      ? `Entry Fee: ${newEvent.entryFee}`         : null,
      newEvent.description   ? `Description: ${newEvent.description}`    : null,
    ].filter(Boolean).join("\n");

    try {
      await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_key: "4a147e0a-663e-4916-a50b-825c4fe7e673",
          subject: `FindSpot Event Submission: ${newEvent.title}`,
          message: details,
          from_name: newEvent.organiserName || "FindSpot User",
        }),
      });
    } catch {}

    setSubmitting(false);
    setDone(true);
  }

  if (done) {
    return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
        <div className="bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md p-8 shadow-2xl text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-4 text-2xl font-black text-emerald-600">✓</div>
          <h2 className="text-xl font-black text-gray-900 dark:text-gray-100">Submitted!</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
            Thanks — your submission has been sent for review. Once approved it will appear in Discover for everyone to see.
          </p>
          <button
            onClick={() => { onSubmitted(); onClose(); }}
            className="mt-6 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-3 rounded-xl text-sm uppercase tracking-widest transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  const canProceed = [
    true, // step 1 — type always selected
    !!draft.title.trim() && !!draft.startDate,
    !!(draft.town.trim() || draft.county.trim() || draft.postcode.trim()),
    true, // step 4 — organiser optional
  ][step - 1];

  const inputClass =
    "w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all";
  const labelClass = "text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 block";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg shadow-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 pb-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between shrink-0">
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest text-gray-400">
              Step {step} of 4
            </div>
            <h2 className="font-black text-gray-900 dark:text-gray-100">Submit an Event</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg">✕</button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-gray-100 dark:bg-gray-800 shrink-0">
          <div
            className="h-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${(step / 4) * 100}%` }}
          />
        </div>

        {/* Body */}
        <div className="p-5 grid gap-4 overflow-y-auto flex-1">
          {step === 1 && (
            <>
              <p className="text-xs text-gray-500 dark:text-gray-400">What kind of event is this?</p>
              {(["rally", "club_dig", "other"] as EventType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => update({ type: t })}
                  className={`py-3 px-4 rounded-xl border-2 font-black text-sm text-left transition-all ${
                    draft.type === t
                      ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400"
                      : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-emerald-300 dark:hover:border-emerald-700"
                  }`}
                >
                  {typeLabel(t)}
                </button>
              ))}
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-xs text-gray-500 dark:text-gray-400">Event details</p>
              <div>
                <label className={labelClass}>Event Title *</label>
                <input value={draft.title} onChange={(e) => update({ title: e.target.value })} placeholder="e.g. Spring Charity Rally" className={inputClass} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Start Date *</label>
                  <input type="date" value={draft.startDate} onChange={(e) => update({ startDate: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>End Date</label>
                  <input type="date" value={draft.endDate} onChange={(e) => update({ endDate: e.target.value })} className={inputClass} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Start Time</label>
                  <input type="time" value={draft.startTime} onChange={(e) => update({ startTime: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Entry Fee</label>
                  <input value={draft.entryFee} onChange={(e) => update({ entryFee: e.target.value })} placeholder="e.g. £25 per person" className={inputClass} />
                </div>
              </div>
              <div>
                <label className={labelClass}>Description</label>
                <textarea value={draft.description} onChange={(e) => update({ description: e.target.value })} rows={3} placeholder="Brief event description (optional)" className={`${inputClass} resize-none`} />
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Where is it? Approximate area is fine — exact grid references aren't needed.
              </p>
              <div>
                <label className={labelClass}>Nearest Town *</label>
                <input value={draft.town} onChange={(e) => update({ town: e.target.value })} placeholder="e.g. Spalding" className={inputClass} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>County</label>
                  <input value={draft.county} onChange={(e) => update({ county: e.target.value })} placeholder="e.g. Lincolnshire" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Postcode Area</label>
                  <input value={draft.postcode} onChange={(e) => update({ postcode: e.target.value })} placeholder="e.g. PE11" className={inputClass} />
                </div>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Organiser details (optional, but helps with verification)
              </p>
              <div>
                <label className={labelClass}>Organiser Name</label>
                <input value={draft.organiserName} onChange={(e) => update({ organiserName: e.target.value })} placeholder="e.g. Fenland Detecting Club" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Source Link</label>
                <input value={draft.sourceUrl} onChange={(e) => update({ sourceUrl: e.target.value })} placeholder="Facebook event, website, Eventbrite…" className={inputClass} />
              </div>
              <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl text-[10px] text-amber-700 dark:text-amber-400 leading-relaxed">
                Your submission will appear in Discover with an <strong>Unconfirmed</strong> badge. A source link helps us verify and promote it to <strong>Verified</strong> status.
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 pt-3 border-t border-gray-100 dark:border-gray-800 flex gap-3 shrink-0">
          {step > 1 && (
            <button
              onClick={() => setStep((s) => (s - 1) as typeof step)}
              className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-gray-500 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl transition-colors"
            >
              Back
            </button>
          )}
          {step < 4 ? (
            <button
              onClick={() => setStep((s) => (s + 1) as typeof step)}
              disabled={!canProceed}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
            >
              Next
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={submitting}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
            >
              {submitting ? "Submitting…" : "Submit Event"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── SubmitClubModal ──────────────────────────────────────────────────────────

type DraftClub = {
  name: string;
  description: string;
  town: string;
  county: string;
  postcode: string;
  facebookUrl: string;
  websiteUrl: string;
  digDays: string;
  contactName: string;
};

const EMPTY_DRAFT_CLUB: DraftClub = {
  name: "", description: "", town: "", county: "", postcode: "",
  facebookUrl: "", websiteUrl: "", digDays: "", contactName: "",
};

function SubmitClubModal({
  onClose,
  onSubmitted,
}: {
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [draft, setDraft] = useState<DraftClub>(EMPTY_DRAFT_CLUB);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const update = (patch: Partial<DraftClub>) => setDraft((p) => ({ ...p, ...patch }));

  const canSubmit = !!draft.name.trim() && !!(draft.town.trim() || draft.county.trim() || draft.postcode.trim());

  async function submit() {
    setSubmitting(true);
    const newClub: ClubListing = {
      id: uuid(),
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      town: draft.town.trim() || undefined,
      county: draft.county.trim() || undefined,
      facebookUrl: draft.facebookUrl.trim() || undefined,
      websiteUrl: draft.websiteUrl.trim() || undefined,
      digDays: draft.digDays.trim() || undefined,
      contactName: draft.contactName.trim() || undefined,
      verificationStatus: "unconfirmed",
    };

    saveLocalClubSubmission(newClub);

    const details = [
      `Club Name: ${newClub.name}`,
      newClub.town         ? `Town: ${newClub.town}`              : null,
      newClub.county       ? `County: ${newClub.county}`          : null,
      draft.postcode       ? `Postcode Area: ${draft.postcode}`   : null,
      newClub.digDays      ? `Dig Days: ${newClub.digDays}`       : null,
      newClub.facebookUrl  ? `Facebook: ${newClub.facebookUrl}`   : null,
      newClub.websiteUrl   ? `Website: ${newClub.websiteUrl}`     : null,
      newClub.contactName  ? `Contact: ${newClub.contactName}`    : null,
      newClub.description  ? `About: ${newClub.description}`      : null,
    ].filter(Boolean).join("\n");

    try {
      await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_key: "4a147e0a-663e-4916-a50b-825c4fe7e673",
          subject: `FindSpot Club Submission: ${newClub.name}`,
          message: details,
          from_name: newClub.contactName || "FindSpot User",
        }),
      });
    } catch {}

    setSubmitting(false);
    setDone(true);
  }

  const inputClass =
    "w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all";
  const labelClass = "text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 block";

  if (done) {
    return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
        <div className="bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md p-8 shadow-2xl text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-4 text-2xl font-black text-emerald-600">✓</div>
          <h2 className="text-xl font-black text-gray-900 dark:text-gray-100">Club Listed!</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
            Your club has been submitted for review. Once approved it will appear in the clubs directory for detectorists near you.
          </p>
          <button
            onClick={() => { onSubmitted(); onClose(); }}
            className="mt-6 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-3 rounded-xl text-sm uppercase tracking-widest transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg shadow-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 pb-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between shrink-0">
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest text-gray-400">Club Directory</div>
            <h2 className="font-black text-gray-900 dark:text-gray-100">List Your Club</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg">✕</button>
        </div>

        {/* Body */}
        <div className="p-5 grid gap-4 overflow-y-auto flex-1">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Add your club to the directory so other detectorists nearby can find you.
          </p>

          <div>
            <label className={labelClass}>Club Name *</label>
            <input value={draft.name} onChange={(e) => update({ name: e.target.value })} placeholder="e.g. Fenland Detecting Club" className={inputClass} />
          </div>

          <div>
            <label className={labelClass}>About the Club</label>
            <textarea value={draft.description} onChange={(e) => update({ description: e.target.value })} rows={3} placeholder="Brief description — experience levels, area covered, etc." className={`${inputClass} resize-none`} />
          </div>

          <div>
            <label className={labelClass}>Nearest Town *</label>
            <input value={draft.town} onChange={(e) => update({ town: e.target.value })} placeholder="e.g. Spalding" className={inputClass} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>County</label>
              <input value={draft.county} onChange={(e) => update({ county: e.target.value })} placeholder="e.g. Lincolnshire" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Postcode Area</label>
              <input value={draft.postcode} onChange={(e) => update({ postcode: e.target.value })} placeholder="e.g. PE11" className={inputClass} />
            </div>
          </div>

          <div>
            <label className={labelClass}>Dig Days</label>
            <input value={draft.digDays} onChange={(e) => update({ digDays: e.target.value })} placeholder="e.g. First Sunday of each month" className={inputClass} />
          </div>

          <div>
            <label className={labelClass}>Facebook Page URL</label>
            <input value={draft.facebookUrl} onChange={(e) => update({ facebookUrl: e.target.value })} placeholder="https://www.facebook.com/yourclub" className={inputClass} />
          </div>

          <div>
            <label className={labelClass}>Website (optional)</label>
            <input value={draft.websiteUrl} onChange={(e) => update({ websiteUrl: e.target.value })} placeholder="https://yourclub.co.uk" className={inputClass} />
          </div>

          <div>
            <label className={labelClass}>Your Name (optional)</label>
            <input value={draft.contactName} onChange={(e) => update({ contactName: e.target.value })} placeholder="Contact name for verification" className={inputClass} />
          </div>

          <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl text-[10px] text-amber-700 dark:text-amber-400 leading-relaxed">
            Your club will appear immediately on your device with an <strong>Unconfirmed</strong> badge. Once we've verified it, it'll show as <strong>Verified</strong> for everyone nearby.
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 pt-3 border-t border-gray-100 dark:border-gray-800 shrink-0">
          <button
            onClick={submit}
            disabled={!canSubmit || submitting}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
          >
            {submitting ? "Submitting…" : "List My Club"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SectionHeader ────────────────────────────────────────────────────────────

function SectionHeader({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <h3
      className={`text-[10px] font-black uppercase tracking-widest mb-3 ${
        accent ? "text-emerald-500" : "text-gray-500 dark:text-gray-400"
      }`}
    >
      {children}
    </h3>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Discover({ projectId: _projectId }: { projectId: string }) {
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [locationError, setLocationError] = useState(false);
  const [locating, setLocating] = useState(false);
  const [radius, setRadius] = useState<Radius>(25);
  const [typeFilter, setTypeFilter] = useState<EventType | "all">("all");

  const [remoteEvents, setRemoteEvents] = useState<DetectingEvent[]>([]);
  const [remoteClubs, setRemoteClubs] = useState<ClubListing[]>([]);
  const [localEvents, setLocalEvents] = useState<DetectingEvent[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(false);

  const [selectedEvent, setSelectedEvent] = useState<DetectingEvent | null>(null);
  const [showSubmit, setShowSubmit] = useState(false);
  const [submissionTick, setSubmissionTick] = useState(0);
  const [showSubmitClub, setShowSubmitClub] = useState(false);
  const [clubSubmissionTick, setClubSubmissionTick] = useState(0);
  const [localClubs, setLocalClubs] = useState<ClubListing[]>([]);
  const [showAllClubs, setShowAllClubs] = useState(false);
  const [showAllEvents, setShowAllEvents] = useState(false);

  // Get user location on mount
  function requestLocation() {
    setLocating(true);
    setLocationError(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setLocationError(true);
        setLocating(false);
      },
      { timeout: 8000 }
    );
  }

  useEffect(() => { requestLocation(); }, []);

  // Fetch remote data on mount, resolving any postcode fields to lat/lon
  useEffect(() => {
    setLoadingRemote(true);
    const today = new Date().toISOString().slice(0, 10);
    Promise.all([
      fetchWithCache<DetectingEvent>(EVENTS_URL, EVENTS_CACHE_KEY),
      fetchWithCache<ClubListing>(CLUBS_URL, CLUBS_CACHE_KEY),
    ]).then(([events, clubs]) =>
      Promise.all([resolveCoordinates(events), resolveCoordinates(clubs)])
    ).then(([events, clubs]) => {
      setRemoteEvents(events.filter((e) => e.startDate >= today));
      setRemoteClubs(clubs);
      setLoadingRemote(false);
    });
  }, []);

  // Reload local submissions after each submit
  useEffect(() => {
    setLocalEvents(loadLocalSubmissions());
  }, [submissionTick]);

  useEffect(() => {
    setLocalClubs(loadLocalClubSubmissions());
  }, [clubSubmissionTick]);

  const radiusKm = radius * 1.60934;

  // Process events: merge remote + local, filter by type, sort nearest first then by date
  const processedEvents = useMemo(() => {
    const all = [...remoteEvents, ...localEvents];
    return all
      .map((event) => ({
        event,
        distanceKm:
          userLocation && event.lat != null && event.lon != null
            ? haversineKm(userLocation.lat, userLocation.lon, event.lat, event.lon)
            : undefined,
      }))
      .filter(({ event }) => typeFilter === "all" || event.type === typeFilter)
      .sort((a, b) => {
        // If we have distances for both, nearest first
        if (a.distanceKm !== undefined && b.distanceKm !== undefined)
          return a.distanceKm - b.distanceKm;
        // Events with a known distance sort before those without
        if (a.distanceKm !== undefined) return -1;
        if (b.distanceKm !== undefined) return 1;
        // Fall back to date order
        return a.event.startDate.localeCompare(b.event.startDate);
      });
  }, [remoteEvents, localEvents, userLocation, typeFilter]);

  // Process clubs: merge remote + local, filter by radius, sort by distance
  const processedClubs = useMemo(() => {
    return [...remoteClubs, ...localClubs]
      .map((club) => ({
        club,
        distanceKm:
          userLocation && club.lat != null && club.lon != null
            ? haversineKm(userLocation.lat, userLocation.lon, club.lat, club.lon)
            : undefined,
      }))
      .filter(({ distanceKm }) => !userLocation || distanceKm === undefined || distanceKm <= radiusKm)
      .sort((a, b) => {
        if (a.distanceKm !== undefined && b.distanceKm !== undefined)
          return a.distanceKm - b.distanceKm;
        return a.club.name.localeCompare(b.club.name);
      });
  }, [remoteClubs, localClubs, userLocation, radiusKm]);

  const selectedEventDistance = useMemo(() => {
    if (!selectedEvent) return undefined;
    return processedEvents.find((p) => p.event.id === selectedEvent.id)?.distanceKm;
  }, [selectedEvent, processedEvents]);

  const selectClass =
    "appearance-none bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl pl-4 pr-8 py-2 text-[10px] font-black uppercase tracking-widest focus:ring-2 focus:ring-emerald-500 outline-none cursor-pointer";

  return (
    <div className="max-w-3xl mx-auto px-4 pb-24 mt-4">

      {/* Page heading */}
      <div className="mb-6">
        <h2 className="text-2xl font-black text-gray-900 dark:text-gray-100 tracking-tighter uppercase leading-none">
          Discover
        </h2>
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mt-1">
          Rallies, club digs &amp; local clubs
        </p>
        {(locationError || (!userLocation && !locating)) && (
          <button
            onClick={requestLocation}
            className="mt-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-widest hover:bg-amber-100 transition-colors"
          >
            {locating ? "Locating…" : "Enable Location"}
          </button>
        )}
      </div>

      {/* ── CLUBS ────────────────────────────────────────────── */}

      {/* Got a local club? CTA */}
      <div className="bg-gradient-to-br from-blue-950/10 to-indigo-950/10 dark:from-blue-950/30 dark:to-indigo-950/30 border border-blue-200 dark:border-blue-800/50 rounded-2xl p-5 flex items-center justify-between gap-4 mb-4">
        <div>
          <p className="text-sm font-black text-gray-900 dark:text-gray-100">Got a local club?</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Add your club so detectorists nearby can find you
          </p>
        </div>
        <button
          onClick={() => setShowSubmitClub(true)}
          className="shrink-0 bg-blue-600 hover:bg-blue-500 text-white font-black py-2.5 px-5 rounded-xl text-[10px] uppercase tracking-widest transition-colors"
        >
          List Club
        </button>
      </div>

      {/* Local clubs list */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <SectionHeader>Local Clubs</SectionHeader>
          <div className="relative shrink-0 -mt-3">
            <select value={radius} onChange={(e) => { setRadius(Number(e.target.value) as Radius); setShowAllClubs(false); }} className={selectClass}>
              {RADIUS_OPTIONS.map((r) => (
                <option key={r} value={r}>{r} miles</option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-[8px]">▼</span>
          </div>
        </div>
        {loadingRemote ? (
          <div className="text-center py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest animate-pulse">Loading…</div>
        ) : processedClubs.length === 0 ? (
          <div className="bg-gray-50 dark:bg-gray-800/50 border border-dashed border-gray-300 dark:border-gray-700 rounded-2xl p-6 text-center">
            <p className="text-sm font-bold text-gray-500 dark:text-gray-400">No clubs found within {radius} miles</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Try a larger radius or list yours above</p>
          </div>
        ) : (
          <>
            <div className="grid gap-3">
              {(showAllClubs ? processedClubs : processedClubs.slice(0, 4)).map(({ club, distanceKm }) => (
                <ClubCard key={club.id} club={club} distanceKm={distanceKm} />
              ))}
            </div>
            {processedClubs.length > 4 && (
              <button
                onClick={() => setShowAllClubs((v) => !v)}
                className="mt-3 w-full text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 hover:underline"
              >
                {showAllClubs ? "Show less" : `See all ${processedClubs.length} clubs`}
              </button>
            )}
          </>
        )}
      </section>

      {/* ── EVENTS ───────────────────────────────────────────── */}

      {/* Run a rally or club dig? CTA */}
      <div className="bg-gradient-to-br from-emerald-950/10 to-teal-950/10 dark:from-emerald-950/30 dark:to-teal-950/30 border border-emerald-200 dark:border-emerald-800/50 rounded-2xl p-5 flex items-center justify-between gap-4 mb-4">
        <div>
          <p className="text-sm font-black text-gray-900 dark:text-gray-100">Run a rally or club dig?</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Add it so other detectorists can find it
          </p>
        </div>
        <button
          onClick={() => setShowSubmit(true)}
          className="shrink-0 bg-emerald-600 hover:bg-emerald-500 text-white font-black py-2.5 px-5 rounded-xl text-[10px] uppercase tracking-widest transition-colors"
        >
          Add Event
        </button>
      </div>

      {/* Events list */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <SectionHeader>Upcoming Events</SectionHeader>
          <div className="relative shrink-0 -mt-3">
            <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value as EventType | "all"); setShowAllEvents(false); }} className={selectClass}>
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-[8px]">▼</span>
          </div>
        </div>
        {loadingRemote ? (
          <div className="text-center py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest animate-pulse">Loading…</div>
        ) : processedEvents.length === 0 ? (
          <div className="bg-gray-50 dark:bg-gray-800/50 border border-dashed border-gray-300 dark:border-gray-700 rounded-2xl p-6 text-center">
            <div className="text-3xl mb-2 opacity-20">🗺️</div>
            <p className="text-sm font-bold text-gray-500 dark:text-gray-400">No upcoming events</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Be the first to add one above</p>
          </div>
        ) : (
          <>
            <div className="grid gap-3">
              {(showAllEvents ? processedEvents : processedEvents.slice(0, 4)).map(({ event, distanceKm }) => (
                <EventCard key={event.id} event={event} distanceKm={distanceKm} onClick={() => setSelectedEvent(event)} />
              ))}
            </div>
            {processedEvents.length > 4 && (
              <button
                onClick={() => setShowAllEvents((v) => !v)}
                className="mt-3 w-full text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 hover:underline"
              >
                {showAllEvents ? "Show less" : `See all ${processedEvents.length} events`}
              </button>
            )}
          </>
        )}
      </section>

      {/* Modals */}
      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          distanceKm={selectedEventDistance}
          onClose={() => setSelectedEvent(null)}
        />
      )}
      {showSubmit && (
        <SubmitEventModal
          onClose={() => setShowSubmit(false)}
          onSubmitted={() => setSubmissionTick((t) => t + 1)}
        />
      )}
      {showSubmitClub && (
        <SubmitClubModal
          onClose={() => setShowSubmitClub(false)}
          onSubmitted={() => setClubSubmissionTick((t) => t + 1)}
        />
      )}
    </div>
  );
}
