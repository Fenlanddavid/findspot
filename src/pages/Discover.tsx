import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { pagePersistence } from "../services/pagePersistence";
import { v4 as uuid } from "uuid";
import {
  ephemeralLocal,
  getDurableSetting,
  setDurableSetting,
  useDurableSetting,
} from '../services/clientStorage';
import { CACHE_POLICIES } from '../shared/cachePolicy';

// ─── Types ────────────────────────────────────────────────────────────────────

type EventType = "rally" | "club_dig" | "other";
type VerificationStatus = "verified" | "community" | "unconfirmed";
type DistanceBand = "all" | "under-50" | "50-100" | "100-plus";

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
  facebookUrl?: string;
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
  { value: "all", label: "All" },
  { value: "rally", label: "Rallies" },
  { value: "club_dig", label: "Club Digs" },
];

const DISTANCE_BANDS: { value: DistanceBand; label: string; minKm?: number; maxKm?: number }[] = [
  { value: "all",       label: "All" },
  { value: "under-50",  label: "Under 50 mi", maxKm: 80.47 },
  { value: "50-100",    label: "50–100 mi",   minKm: 80.47, maxKm: 160.93 },
  { value: "100-plus",  label: "100 mi+",     minKm: 160.93 },
];

// JSON files served from /public — update these paths when you move to a hosted API.
const EVENTS_URL = "/findspot/events.json";
const CLUBS_URL = "/findspot/clubs.json";
const LOCAL_SUBMISSIONS_KEY = "fs_event_submissions";
const LOCAL_CLUB_SUBMISSIONS_KEY = "fs_club_submissions";
const EVENTS_CACHE_KEY = "fs_events_cache";
const CLUBS_CACHE_KEY = "fs_clubs_cache";
const CACHE_TTL = CACHE_POLICIES.discoverReferenceData.expiry.durationMs;
const GOING_KEY = "fs_going_events";
const REVIEW_SUBMISSION_URL = "https://api.web3forms.com/submit";
const REVIEW_ACCESS_KEY = (import.meta.env.VITE_WEB3FORMS_ACCESS_KEY as string | undefined)?.trim();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function submitForReview({
  subject,
  message,
  fromName,
}: {
  subject: string;
  message: string;
  fromName: string;
}): Promise<boolean> {
  if (!REVIEW_ACCESS_KEY) return false;

  const res = await fetch(REVIEW_SUBMISSION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      access_key: REVIEW_ACCESS_KEY,
      subject,
      message,
      from_name: fromName,
    }),
  });

  if (!res.ok) {
    throw new Error(`Review submission failed with HTTP ${res.status}`);
  }

  const payload = await res.json().catch(() => null);
  if (payload && payload.success === false) {
    throw new Error(payload.message || "Review submission was rejected.");
  }

  return true;
}

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
  const day = now.getDay();
  const daysToSat = day === 6 ? 0 : (6 - day);
  const sat = new Date(now);
  sat.setDate(now.getDate() + daysToSat);
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  sun.setHours(23, 59, 59, 999);
  return d >= sat && d <= sun;
}

function isWithinDays(dateStr: string, days: number): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const future = new Date(now);
  future.setDate(now.getDate() + days);
  return d >= now && d <= future;
}

function timeBucket(dateStr: string): "weekend" | "soon" | "later" {
  if (isThisWeekend(dateStr)) return "weekend";
  if (isWithinDays(dateStr, 14)) return "soon";
  return "later";
}

function scoreEvent(event: DetectingEvent, distanceKm?: number): number {
  let score = 0;
  // Distance
  if (distanceKm !== undefined) {
    if (distanceKm < 80.47)        score += 20; // <50 mi
    else if (distanceKm < 160.93)  score += 12; // 50–100 mi
    else                           score += 4;  // 100 mi+
  }
  // Date proximity
  const bucket = timeBucket(event.startDate);
  if (bucket === "weekend")       score += 20;
  else if (bucket === "soon")     score += 12;
  else                            score += 5;
  // Type
  if (event.type === "rally")         score += 10;
  else if (event.type === "club_dig") score += 8;
  else                                score += 3;
  // Verification
  if (event.verificationStatus === "verified") score += 10;
  // Information quality
  if (event.description)                           score += 5;
  if (event.sourceUrl || event.facebookUrl)        score += 5;
  if (event.lat != null && event.lon != null)      score += 5;
  return score;
}

function getScoreLabel(score: number): { label: string; cls: string } {
  if (score >= 55) return {
    label: "Worth checking",
    cls: "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800",
  };
  if (score >= 35) return {
    label: "Local interest",
    cls: "text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-800",
  };
  return {
    label: "New / untested",
    cls: "text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700",
  };
}

function getQualityLabel(event: DetectingEvent): { label: string; style: string } {
  const hasDesc = !!event.description;
  const hasLink = !!(event.sourceUrl || event.facebookUrl);
  if (event.verificationStatus === "verified") {
    return { label: "Verified", style: verificationStyle("verified") };
  }
  if (hasDesc && hasLink) {
    return { label: "Well documented", style: verificationStyle("community") };
  }
  if (!hasDesc && !hasLink) {
    return { label: "Basic info", style: "text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700" };
  }
  return { label: "Unverified", style: verificationStyle("unconfirmed") };
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
    case "verified":    return "✓ Verified";
    case "community":   return "Community Added";
    case "unconfirmed": return "? Unconfirmed";
  }
}

function typeLabel(t: EventType): string {
  switch (t) {
    case "rally":    return "Rally";
    case "club_dig": return "Club Dig";
    case "other":    return "Event";
  }
}

const RALLY_VERIFY_TEXT = "Verify with organiser before attending.";

function hasEventPublicLink(event: DetectingEvent): boolean {
  return !!(event.sourceUrl || event.facebookUrl);
}

function hasClubPublicLink(club: ClubListing): boolean {
  return !!(club.facebookUrl || club.websiteUrl);
}

async function fetchWithCache<T>(url: string, cacheKey: string): Promise<T[]> {
  try {
    const cached = ephemeralLocal.get(cacheKey as 'fs_events_cache' | 'fs_clubs_cache');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed?.data) && typeof parsed?.ts === "number") {
        if (Date.now() - parsed.ts < CACHE_TTL) return parsed.data as T[];
      } else {
        ephemeralLocal.remove(cacheKey as 'fs_events_cache' | 'fs_clubs_cache');
      }
    }
  } catch {
    ephemeralLocal.remove(cacheKey as 'fs_events_cache' | 'fs_clubs_cache');
  }

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(tid);
    if (!res.ok) return [];
    const json = await res.json();
    const data: T[] = Array.isArray(json) ? json : (json.items ?? []);
    ephemeralLocal.set(cacheKey as 'fs_events_cache' | 'fs_clubs_cache', JSON.stringify({ data, ts: Date.now() }));
    return data;
  } catch {
    clearTimeout(tid);
    return [];
  }
}

function normalizeOutcode(postcode: string | undefined): string | null {
  const compact = postcode?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
  const match = compact.match(/^([A-Z]{1,2}\d[A-Z\d]?)/);
  return match ? match[1] : null;
}

// Resolve postcodes → lat/lon via postcodes.io (free, no key needed).
async function resolveCoordinates<T extends { lat?: number; lon?: number; postcode?: string }>(
  items: T[]
): Promise<T[]> {
  const unresolved = items.filter((i) => i.postcode && (i.lat == null || i.lon == null));
  if (unresolved.length === 0) return items;

  const outcodeCache = new Map<string, { lat: number; lon: number } | null>();
  const outcodes = [...new Set(unresolved.map((item) => normalizeOutcode(item.postcode)).filter(Boolean) as string[])];

  await Promise.all(
    outcodes.map(async (outcode) => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(`https://api.postcodes.io/outcodes/${encodeURIComponent(outcode)}`, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
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
    const outcode = normalizeOutcode(item.postcode);
    if (!outcode) return item;
    const coords = outcodeCache.get(outcode);
    return coords ? { ...item, lat: coords.lat, lon: coords.lon } : item;
  });
}

async function loadLocalSubmissions(): Promise<DetectingEvent[]> {
  return getDurableSetting(LOCAL_SUBMISSIONS_KEY, [] as DetectingEvent[]);
}

async function saveLocalSubmission(e: DetectingEvent) {
  const existing = await loadLocalSubmissions();
  await setDurableSetting(LOCAL_SUBMISSIONS_KEY, [...existing, e]);
}

async function loadLocalClubSubmissions(): Promise<ClubListing[]> {
  return getDurableSetting(LOCAL_CLUB_SUBMISSIONS_KEY, [] as ClubListing[]);
}

async function saveLocalClubSubmission(c: ClubListing) {
  const existing = await loadLocalClubSubmissions();
  await setDurableSetting(LOCAL_CLUB_SUBMISSIONS_KEY, [...existing, c]);
}

// ─── EventCard ────────────────────────────────────────────────────────────────

function EventCard({
  event,
  distanceKm,
  score,
  going,
  planned,
  onClick,
  onSubmitUpdate,
}: {
  event: DetectingEvent;
  distanceKm?: number;
  score: number;
  going?: boolean;
  planned?: boolean;
  onClick: () => void;
  onSubmitUpdate: () => void;
}) {
  const dist = distanceKm != null ? ` • ${(distanceKm * 0.621371).toFixed(1)} mi` : "";
  const location = [event.town, event.county].filter(Boolean).join(", ");
  const scoreTag = getScoreLabel(score);
  const qualityTag = getQualityLabel(event);
  const hasPublicLink = hasEventPublicLink(event);
  const isRally = event.type === "rally";

  return (
    <article
      className={`bg-white dark:bg-gray-800 rounded-2xl p-4 hover:shadow-md transition-all group ${
  going || planned
    ? "border-2 border-emerald-400 dark:border-emerald-600 hover:border-emerald-500"
    : "border border-gray-200 dark:border-gray-700 hover:border-emerald-300 dark:hover:border-emerald-700"
}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-black text-sm text-gray-900 dark:text-gray-100 leading-tight group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
          {event.title}
        </h3>
        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
          {event.sourceUrl && (
            <a
              href={event.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 text-gray-400 transition-colors hover:border-emerald-300 hover:text-emerald-500 dark:border-gray-700"
              title="Open website"
              aria-label={`Open website for ${event.title}`}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          )}
          {event.facebookUrl && (
            <a
              href={event.facebookUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 text-gray-400 transition-colors hover:border-blue-300 hover:text-blue-500 dark:border-gray-700"
              title="Facebook"
              aria-label={`Open Facebook page for ${event.title}`}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z" />
              </svg>
            </a>
          )}
        </div>
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
      {isRally && (
        <div className="mt-1.5 text-[10px] text-amber-600 dark:text-amber-400">
          {RALLY_VERIFY_TEXT}
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-2 flex-wrap">
        {going && (
          <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800">
            ✓ Going
          </span>
        )}
        {planned && (
          <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800">
            ✓ Planned
          </span>
        )}
        <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${scoreTag.cls}`}>
          {scoreTag.label}
        </span>
        <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${qualityTag.style}`}>
          {qualityTag.label}
        </span>
        {event.entryFee && (
          <span className="text-[9px] text-gray-400 dark:text-gray-500">{event.entryFee}</span>
        )}
      </div>
      {!hasPublicLink && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-dashed border-amber-200 bg-amber-50/70 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/20">
          <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400">No public link yet</span>
          <button
            type="button"
            onClick={onSubmitUpdate}
            className="shrink-0 text-[9px] font-black uppercase tracking-widest text-amber-800 underline underline-offset-2 dark:text-amber-300"
          >
            Submit update
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={onClick}
        className="mt-3 flex min-h-11 w-full items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-3 text-[10px] font-black uppercase tracking-widest text-emerald-700 transition-colors hover:border-emerald-300 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 dark:border-gray-700 dark:bg-gray-900/60 dark:text-emerald-300 dark:hover:border-emerald-700"
        aria-label={`View details for ${event.title}`}
      >
        <span>{hasPublicLink ? "View details" : "Details needed"}</span>
        <span className="text-gray-400">Plan / going</span>
      </button>
    </article>
  );
}

// ─── ClubCard ─────────────────────────────────────────────────────────────────

function ClubCard({
  club,
  distanceKm,
  onSubmitUpdate,
}: {
  club: ClubListing;
  distanceKm?: number;
  onSubmitUpdate: () => void;
}) {
  const dist = distanceKm != null ? `${(distanceKm * 0.621371).toFixed(1)} mi` : null;
  const location = [club.town, club.county].filter(Boolean).join(", ");
  const meta = [location, dist].filter(Boolean).join(" • ");
  const hasPublicLink = hasClubPublicLink(club);

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-black text-sm leading-tight text-gray-900 dark:text-gray-100">{club.name}</div>
          {meta && <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{meta}</div>}
        </div>
        <span className={`shrink-0 text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${verificationStyle(club.verificationStatus)}`}>
          {verificationLabel(club.verificationStatus)}
        </span>
      </div>
      {club.description && (
        <p className="mt-1.5 overflow-hidden text-xs leading-snug text-gray-600 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] dark:text-gray-300">{club.description}</p>
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
      {hasPublicLink ? (
        <div className="mt-2 flex gap-2">
          {club.facebookUrl && (
            <a
              href={club.facebookUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open Facebook page for ${club.name}`}
              className="inline-flex min-h-9 items-center text-[9px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 px-3 py-1.5 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
            >
              Facebook
            </a>
          )}
          {club.websiteUrl && (
            <a
              href={club.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open website for ${club.name}`}
              className="inline-flex min-h-9 items-center text-[9px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-3 py-1.5 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
            >
              Website
            </a>
          )}
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-dashed border-amber-200 bg-amber-50/70 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/20">
          <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400">No public link yet</span>
          <button
            type="button"
            onClick={onSubmitUpdate}
            className="shrink-0 text-[9px] font-black uppercase tracking-widest text-amber-800 underline underline-offset-2 dark:text-amber-300"
          >
            Submit update
          </button>
        </div>
      )}
    </div>
  );
}

// ─── EventDetailModal ─────────────────────────────────────────────────────────

function EventDetailModal({
  event,
  distanceKm,
  score,
  going,
  planned,
  onClose,
  onPlanSession,
  onToggleGoing,
  onSubmitUpdate,
}: {
  event: DetectingEvent;
  distanceKm?: number;
  score: number;
  going: boolean;
  planned: boolean;
  onClose: () => void;
  onPlanSession: () => void;
  onToggleGoing: () => void;
  onSubmitUpdate: () => void;
}) {
  const dist = distanceKm != null ? ` • ${(distanceKm * 0.621371).toFixed(1)} mi away` : "";
  const location = [event.town, event.county].filter(Boolean).join(", ");
  const scoreTag = getScoreLabel(score);
  const qualityTag = getQualityLabel(event);
  const hasPublicLink = hasEventPublicLink(event);
  const isRally = event.type === "rally";

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm"
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

        {/* Score + quality badges */}
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${scoreTag.cls}`}>
            {scoreTag.label}
          </span>
          <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${qualityTag.style}`}>
            {qualityTag.label}
          </span>
          <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${verificationStyle(event.verificationStatus)}`}>
            {verificationLabel(event.verificationStatus)}
          </span>
        </div>

        {isRally && (
          <div className="mb-4 text-[10px] text-amber-600 dark:text-amber-400">
            {RALLY_VERIFY_TEXT}
          </div>
        )}

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



        <div className="mt-5 flex flex-col gap-2">
          {!hasPublicLink && (
            <div className="rounded-xl border border-dashed border-amber-200 bg-amber-50/70 p-3 dark:border-amber-800 dark:bg-amber-950/20">
              <div className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-400">Contact details needed</div>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                This listing has no public Facebook, website, or booking link yet.
              </p>
              <button
                type="button"
                onClick={onSubmitUpdate}
                className="mt-2 text-[9px] font-black uppercase tracking-widest text-amber-800 underline underline-offset-2 dark:text-amber-300"
              >
                Submit update
              </button>
            </div>
          )}
          {/* Primary actions row */}
          <div className="flex gap-2">
            {event.sourceUrl && (
              <a
                href={event.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest py-3 rounded-xl text-center transition-colors"
              >
                Website
              </a>
            )}
            {event.facebookUrl && (
              <a
                href={event.facebookUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-black uppercase tracking-widest py-3 rounded-xl text-center transition-colors"
              >
                Facebook
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
          </div>

          {/* Plan session */}
          <button
            onClick={onPlanSession}
            className="w-full bg-amber-500 hover:bg-amber-400 text-white text-[10px] font-black uppercase tracking-widest py-3 rounded-xl transition-colors"
          >
            {planned ? "Session planned ✓" : "Plan session"}
          </button>

          {/* I'm going toggle */}
          <button
            onClick={onToggleGoing}
            className={`w-full text-[10px] font-black uppercase tracking-widest py-3 rounded-xl transition-colors border ${
              going
                ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/50"
                : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            }`}
          >
            {going ? "Marked as going ✓" : "I'm going"}
          </button>
          {going && (
            <p className="text-[9px] text-center text-gray-400 dark:text-gray-600 -mt-1">Saved on this device only</p>
          )}

          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-[10px] font-black uppercase tracking-widest py-2"
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
  initialDraft,
  mode = "new",
}: {
  onClose: () => void;
  onSubmitted: () => void;
  initialDraft?: Partial<DraftEvent>;
  mode?: "new" | "update";
}) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [draft, setDraft] = useState<DraftEvent>(() => ({ ...EMPTY_DRAFT, ...initialDraft }));
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [reviewQueued, setReviewQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isUpdate = mode === "update";

  const update = (patch: Partial<DraftEvent>) => setDraft((p) => ({ ...p, ...patch }));

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
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
        postcode: draft.postcode.trim() || undefined,
        organiserName: draft.organiserName.trim() || undefined,
        sourceUrl: draft.sourceUrl.trim() || undefined,
        entryFee: draft.entryFee.trim() || undefined,
        verificationStatus: "unconfirmed",
        createdAt: new Date().toISOString(),
      };

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

      const queued = await submitForReview({
        subject: `FindSpot Event ${isUpdate ? "Update" : "Submission"}: ${newEvent.title}`,
        message: details,
        fromName: newEvent.organiserName || "FindSpot User",
      });

      if (!isUpdate) await saveLocalSubmission(newEvent);
      setReviewQueued(queued);
      setDone(true);
    } catch (e: any) {
      setError(e?.message ?? "Submission failed. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
        <div className="bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md p-8 shadow-2xl text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-4 text-2xl font-black text-emerald-600">✓</div>
          <h2 className="text-xl font-black text-gray-900 dark:text-gray-100">Submitted!</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
            {isUpdate
              ? reviewQueued
                ? "Thanks — your update has been sent for review."
                : "This build is not configured to send central review submissions, so the update was not shared."
              : reviewQueued
                ? "Thanks — your submission has been sent for review. Once approved it will appear in Discover for everyone to see."
                : "Your event has been saved on this device with an Unconfirmed badge. This build is not configured to send central review submissions."}
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
    true,
    !!draft.title.trim() && !!draft.startDate,
    !!(draft.town.trim() || draft.county.trim() || draft.postcode.trim()),
    true,
  ][step - 1];

  const inputClass =
    "w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all";
  const labelClass = "text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 block";

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg shadow-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 pb-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between shrink-0">
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest text-gray-400">Step {step} of 4</div>
            <h2 className="font-black text-gray-900 dark:text-gray-100">{isUpdate ? "Submit Event Update" : "Submit an Event"}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg">✕</button>
        </div>

        <div className="h-1 bg-gray-100 dark:bg-gray-800 shrink-0">
          <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${(step / 4) * 100}%` }} />
        </div>

        <div className="p-5 grid gap-4 overflow-y-auto flex-1">
          {error && (
            <div className="px-4 py-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
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
                Organiser details {isUpdate ? "and source link" : "(optional, but helps with verification)"}
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
                {isUpdate
                  ? "Add the organiser's Facebook page, website, booking page, or any public source we can use to update this listing."
                  : <>Your submission will appear in Discover with an <strong>Unconfirmed</strong> badge. A source link helps us verify and promote it to <strong>Verified</strong> status.</>}
              </div>
            </>
          )}
        </div>

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
              {submitting ? "Submitting…" : isUpdate ? "Submit Update" : "Submit Event"}
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
  initialDraft,
  mode = "new",
}: {
  onClose: () => void;
  onSubmitted: () => void;
  initialDraft?: Partial<DraftClub>;
  mode?: "new" | "update";
}) {
  const [draft, setDraft] = useState<DraftClub>(() => ({ ...EMPTY_DRAFT_CLUB, ...initialDraft }));
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [reviewQueued, setReviewQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isUpdate = mode === "update";

  const update = (patch: Partial<DraftClub>) => setDraft((p) => ({ ...p, ...patch }));
  const canSubmit = !!draft.name.trim() && !!(draft.town.trim() || draft.county.trim() || draft.postcode.trim());

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const newClub: ClubListing = {
        id: uuid(),
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        town: draft.town.trim() || undefined,
        county: draft.county.trim() || undefined,
        postcode: draft.postcode.trim() || undefined,
        facebookUrl: draft.facebookUrl.trim() || undefined,
        websiteUrl: draft.websiteUrl.trim() || undefined,
        digDays: draft.digDays.trim() || undefined,
        contactName: draft.contactName.trim() || undefined,
        verificationStatus: "unconfirmed",
      };

      const details = [
        `Club Name: ${newClub.name}`,
        newClub.town        ? `Town: ${newClub.town}`            : null,
        newClub.county      ? `County: ${newClub.county}`        : null,
        draft.postcode      ? `Postcode Area: ${draft.postcode}` : null,
        newClub.digDays     ? `Dig Days: ${newClub.digDays}`     : null,
        newClub.facebookUrl ? `Facebook: ${newClub.facebookUrl}` : null,
        newClub.websiteUrl  ? `Website: ${newClub.websiteUrl}`   : null,
        newClub.contactName ? `Contact: ${newClub.contactName}`  : null,
        newClub.description ? `About: ${newClub.description}`    : null,
      ].filter(Boolean).join("\n");

      const queued = await submitForReview({
        subject: `FindSpot Club ${isUpdate ? "Update" : "Submission"}: ${newClub.name}`,
        message: details,
        fromName: newClub.contactName || "FindSpot User",
      });

      if (!isUpdate) await saveLocalClubSubmission(newClub);
      setReviewQueued(queued);
      setDone(true);
    } catch (e: any) {
      setError(e?.message ?? "Submission failed. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all";
  const labelClass = "text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 block";

  if (done) {
    return (
      <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
        <div className="bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md p-8 shadow-2xl text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-4 text-2xl font-black text-emerald-600">✓</div>
          <h2 className="text-xl font-black text-gray-900 dark:text-gray-100">{isUpdate ? "Submitted!" : "Club Listed!"}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
            {isUpdate
              ? reviewQueued
                ? "Thanks — your club update has been sent for review."
                : "This build is not configured to send central review submissions, so the update was not shared."
              : reviewQueued
                ? "Your club has been submitted for review. Once approved it will appear in the clubs directory for detectorists near you."
                : "Your club has been saved on this device with an Unconfirmed badge. This build is not configured to send central review submissions."}
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
      className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg shadow-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 pb-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between shrink-0">
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest text-gray-400">Club Directory</div>
            <h2 className="font-black text-gray-900 dark:text-gray-100">{isUpdate ? "Submit Club Update" : "List Your Club"}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg">✕</button>
        </div>

        <div className="p-5 grid gap-4 overflow-y-auto flex-1">
          {error && (
            <div className="px-4 py-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {isUpdate
              ? "Add a public Facebook page, website, or updated details for this club."
              : "Add your club to the directory so other detectorists nearby can find you."}
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
            {isUpdate
              ? "A public Facebook page or website lets us replace the contact-details-needed state with a useful link."
              : <>Your club will appear immediately on your device with an <strong>Unconfirmed</strong> badge. Once we've verified it, it'll show as <strong>Verified</strong> for everyone nearby.</>}
          </div>
        </div>

        <div className="p-5 pt-3 border-t border-gray-100 dark:border-gray-800 shrink-0">
          <button
            onClick={submit}
            disabled={!canSubmit || submitting}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
          >
            {submitting ? "Submitting…" : isUpdate ? "Submit Update" : "List My Club"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SectionHeader ────────────────────────────────────────────────────────────

function SectionHeader({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <h3 className={`text-[10px] font-black uppercase tracking-widest mb-3 ${accent ? "text-emerald-500" : "text-gray-500 dark:text-gray-400"}`}>
      {children}
    </h3>
  );
}

// ─── EventSection ─────────────────────────────────────────────────────────────

function EventSection({
  title,
  entries,
  goingIds,
  plannedKeys,
  onSelect,
  onSubmitUpdate,
}: {
  title: string;
  entries: { event: DetectingEvent; distanceKm?: number; score: number }[];
  goingIds: Set<string>;
  plannedKeys: Set<string>;
  onSelect: (event: DetectingEvent) => void;
  onSubmitUpdate: (event: DetectingEvent) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? entries : entries.slice(0, 4);

  return (
    <div className="mb-6">
      <SectionHeader accent={title === "This Weekend"}>{title}</SectionHeader>
      <div className="grid gap-3">
        {visible.map(({ event, distanceKm, score }) => (
          <EventCard
            key={event.id}
            event={event}
            distanceKm={distanceKm}
            score={score}
            going={goingIds.has(event.id)}
            planned={plannedKeys.has(`${event.title}|${event.startDate}`)}
            onClick={() => onSelect(event)}
            onSubmitUpdate={() => onSubmitUpdate(event)}
          />
        ))}
      </div>
      {entries.length > 4 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 w-full text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 hover:underline"
        >
          {showAll ? "Show less" : `Show ${entries.length - 4} more`}
        </button>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Discover({ projectId }: { projectId: string }) {
  const nav = useNavigate();
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [locationError, setLocationError] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [radius, setRadius] = useDurableSetting<Radius>('fs_discover_radius', 25);
  const [typeFilter, setTypeFilter] = useDurableSetting<EventType | 'all'>('fs_discover_type', 'all');
  const [distanceBand, setDistanceBand] = useState<DistanceBand>("all");
  const [goingIdList, setGoingIdList] = useDurableSetting<string[]>(GOING_KEY, []);
  const goingIds = useMemo(() => new Set(goingIdList), [goingIdList]);
  const [discoverTab, setDiscoverTab] = useDurableSetting<'events' | 'clubs'>('fs_discover_tab', 'events');

  const [remoteEvents, setRemoteEvents] = useState<DetectingEvent[]>([]);
  const [remoteClubs, setRemoteClubs] = useState<ClubListing[]>([]);
  const [localEvents, setLocalEvents] = useState<DetectingEvent[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(false);

  const [selectedEvent, setSelectedEvent] = useState<DetectingEvent | null>(null);
  const [showSubmit, setShowSubmit] = useState(false);
  const [eventUpdateDraft, setEventUpdateDraft] = useState<Partial<DraftEvent> | null>(null);
  const [submissionTick, setSubmissionTick] = useState(0);
  const [showSubmitClub, setShowSubmitClub] = useState(false);
  const [clubUpdateDraft, setClubUpdateDraft] = useState<Partial<DraftClub> | null>(null);
  const [clubSubmissionTick, setClubSubmissionTick] = useState(0);
  const [localClubs, setLocalClubs] = useState<ClubListing[]>([]);
  const [showAllClubs, setShowAllClubs] = useState(false);

  // Track rally permissions created from Discover events (title|date key)
  const plannedKeys = useLiveQuery(async () => {
    const rallies = await pagePersistence.permissions.where("projectId").equals(projectId).filter(p => p.type === "rally").toArray();
    return new Set(rallies.map(r => `${r.name}|${r.validFrom ?? ""}`));
  }, [projectId]) ?? new Set<string>();

  function toggleGoingId(id: string) {
    setGoingIdList((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return [...next];
    });
  }

  function requestLocation() {
    setLocating(true);
    setLocationError(false);
    setLocationEnabled(true);
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

  function disableLocation() {
    setLocationEnabled(false);
    setUserLocation(null);
    setLocationError(false);
  }

  function openEventUpdate(event: DetectingEvent) {
    setSelectedEvent(null);
    setEventUpdateDraft({
      type: event.type,
      title: event.title,
      description: event.description ?? "",
      startDate: event.startDate,
      endDate: event.endDate ?? "",
      startTime: event.startTime ?? "",
      town: event.town ?? "",
      county: event.county ?? "",
      postcode: event.postcode ?? "",
      organiserName: event.organiserName ?? "",
      sourceUrl: event.sourceUrl || event.facebookUrl || "",
      entryFee: event.entryFee ?? "",
    });
    setShowSubmit(true);
  }

  function openClubUpdate(club: ClubListing) {
    setClubUpdateDraft({
      name: club.name,
      description: club.description ?? "",
      town: club.town ?? "",
      county: club.county ?? "",
      postcode: club.postcode ?? "",
      facebookUrl: club.facebookUrl ?? "",
      websiteUrl: club.websiteUrl ?? "",
      digDays: club.digDays ?? "",
      contactName: club.contactName ?? "",
    });
    setShowSubmitClub(true);
  }

  useEffect(() => { requestLocation(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLoadingRemote(true);
    const today = new Date().toISOString().slice(0, 10);
    Promise.all([
      fetchWithCache<DetectingEvent>(EVENTS_URL, EVENTS_CACHE_KEY),
      fetchWithCache<ClubListing>(CLUBS_URL, CLUBS_CACHE_KEY),
    ]).then(([events, clubs]) =>
      Promise.all([resolveCoordinates(events), resolveCoordinates(clubs)])
    ).then(([events, clubs]) => {
      setRemoteEvents(events.filter((e) => (e.endDate ?? e.startDate) >= today));
      setRemoteClubs(clubs);
      setLoadingRemote(false);
    }).catch(() => {
      setLoadingRemote(false);
    });
  }, []);

  useEffect(() => { void loadLocalSubmissions().then(setLocalEvents); }, [submissionTick]);
  useEffect(() => { void loadLocalClubSubmissions().then(setLocalClubs); }, [clubSubmissionTick]);

  const radiusKm = radius * 1.60934;

  // Merge, score, filter, sort events
  const processedEvents = useMemo(() => {
    const all = [...remoteEvents, ...localEvents];
    return all
      .map((event) => {
        const distanceKm =
          userLocation && event.lat != null && event.lon != null
            ? haversineKm(userLocation.lat, userLocation.lon, event.lat, event.lon)
            : undefined;
        return { event, distanceKm, score: scoreEvent(event, distanceKm) };
      })
      .filter(({ event }) => typeFilter === "all" || event.type === typeFilter)
      .filter(({ distanceKm }) => {
        if (!userLocation || distanceBand === "all") return true;
        if (distanceKm === undefined) return false;
        const band = DISTANCE_BANDS.find((b) => b.value === distanceBand);
        if (!band) return true;
        if (band.minKm !== undefined && distanceKm < band.minKm) return false;
        if (band.maxKm !== undefined && distanceKm >= band.maxKm) return false;
        return true;
      })
      .sort((a, b) => b.score - a.score);
  }, [remoteEvents, localEvents, userLocation, typeFilter, distanceBand]);

  // Split into time buckets (already score-sorted within each)
  const weekendEvents = processedEvents.filter((e) => timeBucket(e.event.startDate) === "weekend");
  const soonEvents    = processedEvents.filter((e) => timeBucket(e.event.startDate) === "soon");
  const laterEvents   = processedEvents.filter((e) => timeBucket(e.event.startDate) === "later");

  const processedClubs = useMemo(() => {
    return [...remoteClubs, ...localClubs]
      .map((club) => ({
        club,
        distanceKm:
          userLocation && club.lat != null && club.lon != null
            ? haversineKm(userLocation.lat, userLocation.lon, club.lat, club.lon)
            : undefined,
      }))
      .filter(({ distanceKm }) => !userLocation || (distanceKm !== undefined && distanceKm <= radiusKm))
      .sort((a, b) => {
        if (a.distanceKm !== undefined && b.distanceKm !== undefined) return a.distanceKm - b.distanceKm;
        return a.club.name.localeCompare(b.club.name);
      });
  }, [remoteClubs, localClubs, userLocation, radiusKm]);

  const selectedEventEntry = useMemo(
    () => processedEvents.find((p) => p.event.id === selectedEvent?.id),
    [selectedEvent, processedEvents]
  );

  const chipBase = "px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider border transition-all";
  const chipActive = "bg-emerald-600 border-emerald-600 text-white";
  const chipInactive = "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-emerald-300 dark:hover:border-emerald-700";

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
        <div className="mt-3">
          {!locationEnabled ? (
            <button onClick={requestLocation} className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 rounded-xl px-4 py-2 text-[9px] font-black uppercase tracking-widest hover:bg-amber-100 dark:hover:bg-amber-950/50 transition-colors">
              Location off — tap to enable
            </button>
          ) : locating ? (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400 rounded-xl px-4 py-2 text-[9px] font-black uppercase tracking-widest animate-pulse inline-block">
              Locating…
            </div>
          ) : locationError ? (
            <button onClick={requestLocation} className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-xl px-4 py-2 text-[9px] font-black uppercase tracking-widest hover:bg-red-100 transition-colors">
              Location unavailable — tap to retry
            </button>
          ) : (
            <button onClick={disableLocation} className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 rounded-xl px-4 py-2 text-[9px] font-black uppercase tracking-widest hover:bg-emerald-100 dark:hover:bg-emerald-950/50 transition-colors">
              Location on — tap to disable
            </button>
          )}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-gray-200 bg-gray-100 p-1 dark:border-gray-700 dark:bg-gray-800">
        {[
          { key: "events", label: "Events", count: processedEvents.length },
          { key: "clubs", label: "Clubs", count: processedClubs.length },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              const next = tab.key as "events" | "clubs";
              setDiscoverTab(next);
            }}
            className={`min-h-11 rounded-lg px-3 py-2 text-xs font-black uppercase tracking-widest transition-colors ${
              discoverTab === tab.key
                ? "bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-emerald-300"
                : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            {tab.label}
            <span className="ml-2 rounded-full bg-gray-200 px-1.5 py-0.5 text-[9px] text-gray-500 dark:bg-gray-700 dark:text-gray-300">{tab.count}</span>
          </button>
        ))}
      </div>

      {/* ── CLUBS ────────────────────────────────────────────── */}

      {discoverTab === "clubs" && (
      <>
      <div className="bg-gradient-to-br from-blue-950/10 to-indigo-950/10 dark:from-blue-950/30 dark:to-indigo-950/30 border border-blue-200 dark:border-blue-800/50 rounded-2xl p-5 flex items-center justify-between gap-4 mb-4">
        <div>
          <p className="text-sm font-black text-gray-900 dark:text-gray-100">Local club directory</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">List a club so nearby detectorists can find it</p>
        </div>
        <button onClick={() => { setClubUpdateDraft(null); setShowSubmitClub(true); }} className="shrink-0 bg-blue-600 hover:bg-blue-500 text-white font-black py-2.5 px-5 rounded-xl text-[10px] uppercase tracking-widest transition-colors">
          List a Club
        </button>
      </div>

      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <SectionHeader>Local Clubs</SectionHeader>
          <div className="relative shrink-0 -mt-3">
            <select value={radius} onChange={(e) => { const v = Number(e.target.value) as Radius; setRadius(v); setShowAllClubs(false); }} className={selectClass}>
              {RADIUS_OPTIONS.map((r) => <option key={r} value={r}>{r} miles</option>)}
            </select>
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-[8px]">▼</span>
          </div>
        </div>
        {loadingRemote ? (
          <div className="text-center py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest animate-pulse">Loading…</div>
        ) : processedClubs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5 text-center dark:border-gray-700 dark:bg-gray-800/50">
            <p className="text-sm font-bold text-gray-500 dark:text-gray-400">No clubs found within {radius} miles</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Try a larger radius, or list yours above</p>
          </div>
        ) : (
          <>
            <div className="grid gap-3">
              {(showAllClubs ? processedClubs : processedClubs.slice(0, 4)).map(({ club, distanceKm }) => (
                <ClubCard key={club.id} club={club} distanceKm={distanceKm} onSubmitUpdate={() => openClubUpdate(club)} />
              ))}
            </div>
            {processedClubs.length > 4 && (
              <button onClick={() => setShowAllClubs((v) => !v)} className="mt-3 w-full text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 hover:underline">
                {showAllClubs ? "Show less" : `See all ${processedClubs.length} clubs`}
              </button>
            )}
          </>
        )}
      </section>
      </>
      )}

      {/* ── EVENTS ───────────────────────────────────────────── */}

      {discoverTab === "events" && (
      <>
      <div className="bg-gradient-to-br from-emerald-950/10 to-teal-950/10 dark:from-emerald-950/30 dark:to-teal-950/30 border border-emerald-200 dark:border-emerald-800/50 rounded-2xl p-5 flex items-center justify-between gap-4 mb-4">
        <div>
          <p className="text-sm font-black text-gray-900 dark:text-gray-100">Rallies and club digs</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Submit an event so other detectorists can find it</p>
        </div>
        <button onClick={() => { setEventUpdateDraft(null); setShowSubmit(true); }} className="shrink-0 bg-emerald-600 hover:bg-emerald-500 text-white font-black py-2.5 px-5 rounded-xl text-[10px] uppercase tracking-widest transition-colors">
          Submit Event
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-col gap-2">
        {/* Type filter chips */}
        <div className="flex items-center gap-2 flex-wrap">
          {TYPE_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setTypeFilter(o.value)}
              className={`${chipBase} ${typeFilter === o.value ? chipActive : chipInactive}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        {/* Distance band chips — only when location is available */}
        {userLocation && (
          <div className="flex items-center gap-2 flex-wrap">
            {DISTANCE_BANDS.map((b) => (
              <button
                key={b.value}
                onClick={() => setDistanceBand(b.value)}
                className={`${chipBase} ${distanceBand === b.value ? chipActive : chipInactive}`}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Events sections */}
      {userLocation && !loadingRemote && processedEvents.length > 0 && (
        <p className="text-[9px] text-gray-400 dark:text-gray-600 mb-3">Showing events near you, sorted by relevance</p>
      )}
      {loadingRemote ? (
        <div className="text-center py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest animate-pulse">Loading…</div>
      ) : processedEvents.length === 0 ? (
        <div className="mb-8 rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5 text-center dark:border-gray-700 dark:bg-gray-800/50">
          <p className="text-sm font-bold text-gray-500 dark:text-gray-400">
            {distanceBand !== "all" ? "Nothing in that distance range" : "No upcoming events"}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            {distanceBand !== "all" ? "Try a different distance band, or check All" : "Be the first to add one above"}
          </p>
        </div>
      ) : (
        <>
          {weekendEvents.length > 0 ? (
            <EventSection title="This Weekend" entries={weekendEvents} goingIds={goingIds} plannedKeys={plannedKeys} onSelect={setSelectedEvent} onSubmitUpdate={openEventUpdate} />
          ) : (
            <div className="mb-5 rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-center dark:border-gray-700 dark:bg-gray-800/50">
              <p className="text-xs font-bold text-gray-400 dark:text-gray-500">Nothing nearby this weekend</p>
              <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-0.5">Check what's coming up below</p>
            </div>
          )}
          {soonEvents.length > 0 && (
            <EventSection title="Next 14 Days" entries={soonEvents} goingIds={goingIds} plannedKeys={plannedKeys} onSelect={setSelectedEvent} onSubmitUpdate={openEventUpdate} />
          )}
          {laterEvents.length > 0 && (
            <EventSection title="Coming Up" entries={laterEvents} goingIds={goingIds} plannedKeys={plannedKeys} onSelect={setSelectedEvent} onSubmitUpdate={openEventUpdate} />
          )}
        </>
      )}
      </>
      )}

      <p className="text-[9px] text-gray-400 dark:text-gray-600 text-center mt-2 mb-8 leading-relaxed">
        Events listed for information only. FindSpot is not affiliated with any organiser, club, or rally.
        Always verify details directly with the organiser before attending.
      </p>

      {/* Modals */}
      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          distanceKm={selectedEventEntry?.distanceKm}
          score={selectedEventEntry?.score ?? 0}
          going={goingIds.has(selectedEvent.id)}
          planned={plannedKeys.has(`${selectedEvent.title}|${selectedEvent.startDate}`)}
          onClose={() => setSelectedEvent(null)}
          onToggleGoing={() => toggleGoingId(selectedEvent.id)}
          onSubmitUpdate={() => openEventUpdate(selectedEvent)}
          onPlanSession={() => {
            const e = selectedEvent;
            const params = new URLSearchParams({ type: "rally" });
            if (e.title) params.set("name", e.title);
            if (e.startDate) params.set("validFrom", e.startDate);
            if (e.organiserName) params.set("landownerName", e.organiserName);
            if (e.lat != null) params.set("lat", String(e.lat));
            if (e.lon != null) params.set("lon", String(e.lon));
            const location = [e.town, e.county].filter(Boolean).join(", ");
            const urlNote = e.sourceUrl || e.facebookUrl || "";
            const notes = [location, urlNote].filter(Boolean).join("\n");
            if (notes) params.set("notes", notes);
            setSelectedEvent(null);
            nav(`/permission?${params.toString()}`);
          }}
        />
      )}
      {showSubmit && (
        <SubmitEventModal
          mode={eventUpdateDraft ? "update" : "new"}
          initialDraft={eventUpdateDraft ?? undefined}
          onClose={() => { setShowSubmit(false); setEventUpdateDraft(null); }}
          onSubmitted={() => { setSubmissionTick((t) => t + 1); setEventUpdateDraft(null); }}
        />
      )}
      {showSubmitClub && (
        <SubmitClubModal
          mode={clubUpdateDraft ? "update" : "new"}
          initialDraft={clubUpdateDraft ?? undefined}
          onClose={() => { setShowSubmitClub(false); setClubUpdateDraft(null); }}
          onSubmitted={() => { setClubSubmissionTick((t) => t + 1); setClubUpdateDraft(null); }}
        />
      )}
    </div>
  );
}
