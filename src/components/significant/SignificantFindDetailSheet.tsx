import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { v4 as uuid } from "uuid";
import { db, Find, Media, SignificantFind } from "../../db";
import { fileToBlob } from "../../services/photos";
import { ScaledImage } from "../ScaledImage";
import {
  formatSignificantDate,
  formatSignificantLocation,
  getStatusLabel,
  getStepsForPath,
  JURISDICTION_LABELS,
  PATH_COLORS,
  PATH_LABELS,
  STATUS_COLORS,
} from "./significantFindDisplay";
import { useConfirmDialog } from "../ConfirmModal";

function getPeriodColor(period: string): string {
  const p = (period ?? "").toLowerCase();
  if (p.includes("roman"))                              return "#9333ea";
  if (p.includes("medieval") && !p.includes("post"))   return "#2563eb";
  if (p.includes("post-medieval") || p.includes("post medieval")) return "#0891b2";
  if (p.includes("bronze"))                             return "#ea580c";
  if (p.includes("iron"))                               return "#b45309";
  if (p.includes("modern"))                             return "#6b7280";
  return "#f59e0b";
}

function ScatterMiniMap({ finds }: { finds: Find[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const initKey = finds.map(f => f.id).join(",");

  useEffect(() => {
    const valid = finds.filter(f => f.lat != null && f.lon != null);
    if (!containerRef.current || valid.length === 0) return;
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }

    const lats = valid.map(f => f.lat!);
    const lons = valid.map(f => f.lon!);
    const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            osm: { type: "raster", tiles: ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap" },
          },
          layers: [{ id: "osm-tiles", type: "raster", source: "osm", minzoom: 0, maxzoom: 22 }],
        },
        center: [centerLon, centerLat],
        zoom: 17,
        interactive: false,
      });
    } catch { return; }
    mapRef.current = map;

    map.on("load", () => {
      valid.forEach((f, i) => {
        const color = getPeriodColor(f.period);
        const el = document.createElement("div");
        el.style.cssText = `width:24px;height:24px;border-radius:50%;background:${color};border:2px solid white;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:900;color:white;box-shadow:0 2px 6px rgba(0,0,0,.35);`;
        el.textContent = String(i + 1);
        new maplibregl.Marker({ element: el }).setLngLat([f.lon!, f.lat!]).addTo(map);
      });
      if (valid.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        valid.forEach(f => bounds.extend([f.lon!, f.lat!]));
        map.fitBounds(bounds, { padding: 40, maxZoom: 18, duration: 0 });
      }
    });

    return () => { map.remove(); mapRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initKey]);

  const validCount = finds.filter(f => f.lat != null && f.lon != null).length;
  if (validCount === 0) return null;

  return (
    <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700" style={{ height: 200 }}>
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}

function PasRecordUrlField({ sfId, value, onSave, projectId }: {
  sfId: string;
  value: string;
  onSave: (v: string) => void;
  projectId: string;
}) {
  const [local, setLocal] = useState(value);
  const [pdfSaved, setPdfSaved] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => { setLocal(value); }, [value]);

  async function handlePdf(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    setPdfError(null);
    try {
      const blob = await fileToBlob(file);
      await db.media.add({
        id: uuid(),
        projectId,
        findId: sfId,
        type: "photo",
        photoType: "other",
        filename: file.name,
        mime: file.type || "application/pdf",
        blob,
        caption: "PAS Report",
        scalePresent: false,
        createdAt: new Date().toISOString(),
      });
      setPdfSaved(true);
      setTimeout(() => setPdfSaved(false), 3000);
    } catch {
      setPdfError("Could not save the file. Please try again.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-[9px] font-black uppercase tracking-widest text-gray-400">PAS record URL</label>
      <div className="flex gap-2">
        <input
          type="url"
          value={local}
          onChange={e => setLocal(e.target.value)}
          onBlur={() => onSave(local)}
          placeholder="https://finds.org.uk/database/artefacts/record/id/…"
          className="flex-1 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20 placeholder:text-gray-400"
        />
        {local && (
          <a
            href={local}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-xs font-black text-emerald-700 dark:text-emerald-400"
          >
            Open
          </a>
        )}
      </div>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 cursor-pointer transition-colors">
          📎 {pdfSaved ? <span className="text-emerald-600 dark:text-emerald-400 font-semibold">PDF saved ✓</span> : "Attach PAS report PDF"}
          <input type="file" accept="application/pdf,image/*" onChange={handlePdf} className="hidden" />
        </label>
      </div>
      {pdfError && <p className="text-xs text-red-500">{pdfError}</p>}
    </div>
  );
}

function StatusTracker({ path, status, onSet, landownerNotified, onToggleLandowner }: {
  path: SignificantFind["path"];
  status: SignificantFind["status"];
  onSet: (s: SignificantFind["status"]) => void;
  landownerNotified: boolean;
  onToggleLandowner: () => void;
}) {
  const steps = getStepsForPath(path);
  const currentIdx = steps.findIndex(s => s.value === status);
  return (
    <div className="bg-gray-50 dark:bg-gray-800/60 rounded-2xl p-3">
      <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">Update status</p>
      <div className="flex flex-col gap-1.5">
        {steps.map((s, idx) => {
          const isCurrent = status === s.value;
          const isDone = idx < currentIdx;
          return (
            <React.Fragment key={s.value}>
              <button
                type="button"
                onClick={() => onSet(s.value)}
                className={`flex items-center gap-3 w-full text-left px-3 py-2.5 rounded-xl border transition-all ${
                  isCurrent
                    ? "border-amber-400 bg-amber-50 dark:bg-amber-900/20"
                    : isDone
                    ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10"
                    : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-amber-300"
                }`}
              >
                <div className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] ${
                  isCurrent ? "border-amber-500 bg-amber-500 text-white"
                  : isDone ? "border-emerald-500 bg-emerald-500 text-white"
                  : "border-gray-300 dark:border-gray-600"
                }`}>
                  {isDone ? "OK" : isCurrent ? ">" : ""}
                </div>
                <span className={`text-sm font-semibold ${
                  isCurrent ? "text-amber-800 dark:text-amber-300"
                  : isDone ? "text-emerald-700 dark:text-emerald-400"
                  : "text-gray-600 dark:text-gray-400"
                }`}>{s.label}</span>
              </button>
              {idx === 0 && (
                <button
                  type="button"
                  onClick={onToggleLandowner}
                  className={`ml-8 flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-all ${
                    landownerNotified
                      ? "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/20"
                      : "border-gray-200 bg-white hover:border-amber-300 dark:border-gray-700 dark:bg-gray-900"
                  }`}
                >
                  <div className={`shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                    landownerNotified
                      ? "border-emerald-500 bg-emerald-500"
                      : "border-gray-300 dark:border-gray-600"
                  }`}>
                    {landownerNotified && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                  <span className={`text-xs font-semibold ${landownerNotified ? "text-emerald-800 dark:text-emerald-300" : "text-gray-600 dark:text-gray-300"}`}>
                    Landowner contacted
                  </span>
                </button>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function EditableField({ label, value, placeholder, rows = 2, onSave }: {
  label: string;
  value: string;
  placeholder: string;
  rows?: number;
  onSave: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[9px] font-black uppercase tracking-widest text-gray-400">{label}</label>
      <textarea
        value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={() => onSave(local)}
        rows={rows}
        placeholder={placeholder}
        className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20 resize-none placeholder:text-gray-400"
      />
      {local !== value && (
        <button
          type="button"
          onClick={() => onSave(local)}
          className="self-end px-4 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-black uppercase tracking-wide"
        >
          Save
        </button>
      )}
    </div>
  );
}

function EditableLineField({ label, value, placeholder, onSave }: {
  label: string;
  value: string;
  placeholder: string;
  onSave: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[9px] font-black uppercase tracking-widest text-gray-400">{label}</label>
      <input
        type="text"
        value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={() => onSave(local)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20 placeholder:text-gray-400"
      />
    </div>
  );
}

type OutcomeTone = "amber" | "emerald";

type OutcomeOption<T extends string> = {
  value: T;
  label: string;
  hint: string;
};

const TONE_STYLES: Record<OutcomeTone, {
  panel: string;
  eyebrow: string;
  copy: string;
  choiceActive: string;
  choiceInactive: string;
  optionActive: string;
  optionInactive: string;
  infoBox: string;
}> = {
  amber: {
    panel: "rounded-2xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/20",
    eyebrow: "text-[9px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300",
    copy: "mt-1 text-xs leading-relaxed text-amber-800 dark:text-amber-200",
    choiceActive: "border-amber-500 bg-white text-amber-900 shadow-sm dark:bg-amber-900/30 dark:text-amber-100",
    choiceInactive: "border-amber-200 bg-white/70 text-gray-700 hover:border-amber-400 dark:border-amber-800 dark:bg-gray-900/60 dark:text-gray-300",
    optionActive: "border-amber-500 bg-white text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
    optionInactive: "border-amber-200 bg-white/70 text-gray-500 hover:border-amber-400 dark:border-amber-800 dark:bg-gray-900/60",
    infoBox: "border-amber-200 bg-white/70 dark:border-amber-800 dark:bg-gray-900/60",
  },
  emerald: {
    panel: "rounded-2xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/20",
    eyebrow: "text-[9px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300",
    copy: "mt-1 text-xs leading-relaxed text-emerald-800 dark:text-emerald-200",
    choiceActive: "border-emerald-500 bg-white text-emerald-900 shadow-sm dark:bg-emerald-900/30 dark:text-emerald-100",
    choiceInactive: "border-emerald-200 bg-white/70 text-gray-700 hover:border-emerald-400 dark:border-emerald-800 dark:bg-gray-900/60 dark:text-gray-300",
    optionActive: "border-emerald-500 bg-white text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200",
    optionInactive: "border-emerald-200 bg-white/70 text-gray-500 hover:border-emerald-400 dark:border-emerald-800 dark:bg-gray-900/60",
    infoBox: "border-emerald-200 bg-white/70 dark:border-emerald-800 dark:bg-gray-900/60",
  },
};

const TREASURE_OUTCOMES: Array<OutcomeOption<NonNullable<SignificantFind["treasureOutcome"]>>> = [
  { value: "not_treasure_returned", label: "Not Treasure / returned", hint: "Coroner or FLO says it is not Treasure." },
  { value: "disclaimed_returned", label: "Disclaimed / returned", hint: "No Crown or museum acquisition; returned after process." },
  { value: "museum_acquiring", label: "Museum acquiring", hint: "A museum is pursuing acquisition." },
  { value: "donated_reward_waived", label: "Donated / reward waived", hint: "Finder and/or landowner waived reward." },
  { value: "reward_paid", label: "Reward paid", hint: "Valuation and payment are complete." },
  { value: "transferred_to_museum", label: "Transferred to museum", hint: "Object is now with the acquiring museum." },
  { value: "closed", label: "Closed", hint: "No further action expected." },
];

const SCATTER_OUTCOMES: Array<OutcomeOption<NonNullable<SignificantFind["scatterOutcome"]>>> = [
  { value: "pas_recorded", label: "PAS recorded", hint: "The scatter or hoard has a PAS record." },
  { value: "research_complete", label: "Mapped / research complete", hint: "The spread is recorded for context or future research." },
  { value: "not_treasure_returned", label: "Not Treasure / returned", hint: "FLO or coroner says the group is not Treasure." },
  { value: "disclaimed_returned", label: "Disclaimed / returned", hint: "No Crown or museum acquisition; returned after process." },
  { value: "museum_acquiring", label: "Museum acquiring", hint: "A museum is pursuing the scatter or hoard." },
  { value: "donated_reward_waived", label: "Donated / reward waived", hint: "Finder and/or landowner waived reward." },
  { value: "reward_paid", label: "Reward paid", hint: "Valuation and payment are complete." },
  { value: "transferred_to_museum", label: "Transferred to museum", hint: "Finds are now with the acquiring museum." },
  { value: "closed", label: "Closed", hint: "No further follow-up expected." },
];

const NOTABLE_OUTCOMES: Array<OutcomeOption<NonNullable<SignificantFind["notableOutcome"]>>> = [
  { value: "pas_recorded", label: "PAS recorded", hint: "The find has a PAS record." },
  { value: "identified_not_recorded", label: "Identified / not recorded", hint: "FLO identified it but no PAS record is being made." },
  { value: "returned", label: "Returned", hint: "The find is back with the finder or landowner." },
  { value: "museum_interest", label: "Museum interest", hint: "A museum asked to view, acquire, or retain it." },
  { value: "not_treasure_returned", label: "Not Treasure / returned", hint: "FLO or coroner says it is not Treasure." },
  { value: "disclaimed_returned", label: "Disclaimed / returned", hint: "No Crown or museum acquisition; returned after process." },
  { value: "museum_acquiring", label: "Museum acquiring", hint: "A museum is pursuing acquisition." },
  { value: "donated_reward_waived", label: "Donated / reward waived", hint: "Finder and/or landowner waived reward." },
  { value: "reward_paid", label: "Reward paid", hint: "Valuation and payment are complete." },
  { value: "transferred_to_museum", label: "Transferred to museum", hint: "Object is now with the acquiring museum." },
  { value: "closed", label: "Closed", hint: "No further follow-up expected." },
];

const REWARD_STATUSES: Array<{
  value: NonNullable<SignificantFind["rewardStatus"]>;
  label: string;
}> = [
  { value: "not_applicable", label: "N/A" },
  { value: "pending", label: "Pending" },
  { value: "waived", label: "Waived" },
  { value: "paid", label: "Paid" },
];

const CURRENT_LOCATION_OPTIONS: Array<{
  value: NonNullable<SignificantFind["currentLocation"]>;
  label: string;
}> = [
  { value: "with_finder", label: "Finder" },
  { value: "with_flo", label: "FLO / coroner" },
  { value: "at_museum", label: "Museum" },
  { value: "other", label: "Other" },
];

const RETURN_LOCATION_OPTIONS = CURRENT_LOCATION_OPTIONS.filter(
  option => option.value === "with_finder" || option.value === "other"
);

function isTreasureProcessOutcome(value: string | null | undefined): value is NonNullable<SignificantFind["treasureOutcome"]> {
  return TREASURE_OUTCOMES.some(option => option.value === value);
}

function OutcomeChoiceGrid<T extends string>({ options, selected, tone, onSelect }: {
  options: Array<OutcomeOption<T>>;
  selected?: T | null;
  tone: OutcomeTone;
  onSelect: (value: T) => void;
}) {
  const styles = TONE_STYLES[tone];
  return (
    <div className="grid gap-2">
      {options.map(outcome => (
        <button
          key={outcome.value}
          type="button"
          onClick={() => onSelect(outcome.value)}
          className={`rounded-xl border px-3 py-2 text-left transition-all ${
            selected === outcome.value ? styles.choiceActive : styles.choiceInactive
          }`}
        >
          <div className="text-xs font-black">{outcome.label}</div>
          <div className="mt-0.5 text-[10px] leading-snug opacity-70">{outcome.hint}</div>
        </button>
      ))}
    </div>
  );
}

function CurrentLocationPicker({ value, options = CURRENT_LOCATION_OPTIONS, tone, onSave, label = "Current location" }: {
  value?: SignificantFind["currentLocation"];
  options?: typeof CURRENT_LOCATION_OPTIONS;
  tone: OutcomeTone;
  onSave: (value: NonNullable<SignificantFind["currentLocation"]>) => void;
  label?: string;
}) {
  const styles = TONE_STYLES[tone];
  return (
    <div>
      <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-gray-400">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        {options.map(option => (
          <button
            key={option.value}
            type="button"
            onClick={() => onSave(option.value)}
            className={`rounded-xl border py-2 text-xs font-black uppercase tracking-wide transition-all ${
              value === option.value ? styles.optionActive : styles.optionInactive
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function RewardStatusPicker({ value, tone, onSave }: {
  value?: SignificantFind["rewardStatus"];
  tone: OutcomeTone;
  onSave: (value: NonNullable<SignificantFind["rewardStatus"]>) => void;
}) {
  const styles = TONE_STYLES[tone];
  return (
    <div>
      <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-gray-400">Reward</p>
      <div className="grid grid-cols-4 gap-2">
        {REWARD_STATUSES.map(option => (
          <button
            key={option.value}
            type="button"
            onClick={() => onSave(option.value)}
            className={`rounded-xl border py-2 text-[10px] font-black uppercase tracking-wide transition-all ${
              value === option.value ? styles.optionActive : styles.optionInactive
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TreasureProcessClosureFields({ outcome, sf, onSave, tone, referenceLabel = "Treasure case / reference", decisionDateLabel = "Coroner decision date" }: {
  outcome: NonNullable<SignificantFind["treasureOutcome"]>;
  sf: SignificantFind;
  onSave: (patch: Partial<SignificantFind>) => void;
  tone: OutcomeTone;
  referenceLabel?: string;
  decisionDateLabel?: string;
}) {
  const styles = TONE_STYLES[tone];
  const isReturnedOutcome = outcome === "not_treasure_returned" || outcome === "disclaimed_returned";
  const isMuseumOutcome =
    outcome === "museum_acquiring" ||
    outcome === "donated_reward_waived" ||
    outcome === "reward_paid" ||
    outcome === "transferred_to_museum";
  const showReward = outcome === "museum_acquiring" || outcome === "reward_paid" || outcome === "transferred_to_museum";
  const showRewardPayment = outcome === "reward_paid";
  const showRewardWaiver = outcome === "donated_reward_waived";
  const locationOptions = isReturnedOutcome ? RETURN_LOCATION_OPTIONS : CURRENT_LOCATION_OPTIONS;

  return (
    <div className="grid gap-3">
      <EditableLineField label={referenceLabel} value={sf.treasureReference ?? ""} placeholder="e.g. 2026 T123, coroner ref, museum accession..." onSave={v => onSave({ treasureReference: v })} />
      <EditableLineField label={decisionDateLabel} value={sf.coronerDecisionDate ?? ""} placeholder="e.g. 26 May 2026" onSave={v => onSave({ coronerDecisionDate: v })} />
      {isMuseumOutcome && (
        <EditableLineField label="Museum / acquiring institution" value={sf.museumName ?? ""} placeholder="Museum name, if there is interest or transfer" onSave={v => onSave({ museumName: v })} />
      )}

      <CurrentLocationPicker
        value={sf.currentLocation}
        options={locationOptions}
        tone={tone}
        onSave={v => onSave({ currentLocation: v })}
      />

      {showReward && (
        <RewardStatusPicker value={sf.rewardStatus} tone={tone} onSave={v => onSave({ rewardStatus: v })} />
      )}

      {showRewardWaiver && (
        <div className={`rounded-xl border p-3 ${styles.infoBox}`}>
          <p className="text-xs font-semibold leading-relaxed text-gray-700 dark:text-gray-300">
            Reward was waived or donated. Keep a short note of who agreed to waive it and whether the landowner also agreed.
          </p>
        </div>
      )}

      {(showReward || showRewardWaiver) && (
        <EditableLineField
          label={showRewardWaiver ? "Valuation amount" : "Valuation / reward amount"}
          value={sf.valuationAmount ?? ""}
          placeholder={showRewardWaiver ? "Optional: valuation before donation/waiver" : "e.g. £1,200 total, if known"}
          onSave={v => onSave({ valuationAmount: v })}
        />
      )}
      {showRewardPayment && (
        <EditableLineField label="Reward received date" value={sf.rewardReceivedDate ?? ""} placeholder="Date payment was received" onSave={v => onSave({ rewardReceivedDate: v })} />
      )}
      {(showReward || showRewardWaiver) && (
        <EditableField
          label={showRewardWaiver ? "Waiver / donation notes" : "Reward split / agreement notes"}
          value={sf.rewardSplitNotes ?? ""}
          placeholder={showRewardWaiver ? "Who waived the reward, and what was agreed with the landowner?" : "e.g. 50/50 finder and landowner, club agreement terms..."}
          rows={2}
          onSave={v => onSave({ rewardSplitNotes: v })}
        />
      )}
      <EditableField
        label={isReturnedOutcome ? "Return / closure notes" : "Final notes"}
        value={sf.finalDispositionNotes ?? ""}
        placeholder={isReturnedOutcome ? "Who received it back, when, and any landowner agreement notes..." : "What happened in the end: donated, transferred, reward paid, awaiting paperwork..."}
        rows={3}
        onSave={v => onSave({ finalDispositionNotes: v })}
      />
    </div>
  );
}

function TreasureOutcomePanel({ sf, onSave }: {
  sf: SignificantFind;
  onSave: (patch: Partial<SignificantFind>) => void;
}) {
  const outcome = sf.treasureOutcome;
  const styles = TONE_STYLES.amber;

  return (
    <div className={styles.panel}>
      <div className="mb-3">
        <p className={styles.eyebrow}>Treasure outcome</p>
        <p className={styles.copy}>
          Use this once the coroner, museum, valuation, or return process has a clear result.
        </p>
      </div>

      <OutcomeChoiceGrid
        options={TREASURE_OUTCOMES}
        selected={outcome}
        tone="amber"
        onSelect={value => onSave({ treasureOutcome: value })}
      />

      {outcome && (
        <div className="mt-3">
          <TreasureProcessClosureFields outcome={outcome} sf={sf} onSave={onSave} tone="amber" />
        </div>
      )}
    </div>
  );
}

function ScatterOutcomePanel({ sf, onSave }: {
  sf: SignificantFind;
  onSave: (patch: Partial<SignificantFind>) => void;
}) {
  const outcome = sf.scatterOutcome;
  const styles = TONE_STYLES.amber;

  return (
    <div className={styles.panel}>
      <div className="mb-3">
        <p className={styles.eyebrow}>Scattered hoard outcome</p>
        <p className={styles.copy}>
          Use this once the FLO, PAS, Treasure, museum, or research follow-up has a clear result.
        </p>
      </div>

      <OutcomeChoiceGrid
        options={SCATTER_OUTCOMES}
        selected={outcome}
        tone="amber"
        onSelect={value => onSave({ scatterOutcome: value })}
      />

      {outcome && (
        <div className="mt-3">
          {isTreasureProcessOutcome(outcome) && outcome !== "closed" ? (
            <TreasureProcessClosureFields
              outcome={outcome}
              sf={sf}
              onSave={onSave}
              tone="amber"
              referenceLabel="Treasure / hoard reference"
              decisionDateLabel="Coroner or outcome date"
            />
          ) : (
            <div className="grid gap-3">
              <EditableLineField label="Outcome date" value={sf.outcomeDate ?? ""} placeholder="e.g. 26 May 2026" onSave={v => onSave({ outcomeDate: v })} />
              {outcome === "pas_recorded" && (
                <>
                  <EditableLineField label="PAS record number" value={sf.pasRecordNumber ?? ""} placeholder="Assigned by your FLO after recording" onSave={v => onSave({ pasRecordNumber: v })} />
                  <PasRecordUrlField sfId={sf.id} value={sf.pasRecordUrl ?? ""} onSave={v => onSave({ pasRecordUrl: v })} projectId={sf.projectId} />
                </>
              )}
              <EditableField
                label={outcome === "research_complete" ? "Mapping / research notes" : "Closure notes"}
                value={sf.finalDispositionNotes ?? ""}
                placeholder={outcome === "research_complete" ? "What was mapped, what remains in situ, and any context worth keeping..." : "Who confirmed closure and what, if anything, should happen next..."}
                rows={3}
                onSave={v => onSave({ finalDispositionNotes: v })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NotableOutcomePanel({ sf, onSave }: {
  sf: SignificantFind;
  onSave: (patch: Partial<SignificantFind>) => void;
}) {
  const outcome = sf.notableOutcome;
  const styles = TONE_STYLES.emerald;

  return (
    <div className={styles.panel}>
      <div className="mb-3">
        <p className={styles.eyebrow}>Notable find outcome</p>
        <p className={styles.copy}>
          Use this once the FLO, PAS, Treasure, museum, or return follow-up has a clear result.
        </p>
      </div>

      <OutcomeChoiceGrid
        options={NOTABLE_OUTCOMES}
        selected={outcome}
        tone="emerald"
        onSelect={value => onSave({ notableOutcome: value })}
      />

      {outcome && (
        <div className="mt-3">
          {isTreasureProcessOutcome(outcome) && outcome !== "closed" ? (
            <TreasureProcessClosureFields
              outcome={outcome}
              sf={sf}
              onSave={onSave}
              tone="emerald"
              referenceLabel="Treasure / notable find reference"
              decisionDateLabel="Coroner or outcome date"
            />
          ) : (
            <div className="grid gap-3">
              <EditableLineField label="Outcome date" value={sf.outcomeDate ?? ""} placeholder="e.g. 26 May 2026" onSave={v => onSave({ outcomeDate: v })} />
              {outcome === "pas_recorded" && (
                <>
                  <EditableLineField label="PAS record number" value={sf.pasRecordNumber ?? ""} placeholder="Assigned by your FLO after recording" onSave={v => onSave({ pasRecordNumber: v })} />
                  <PasRecordUrlField sfId={sf.id} value={sf.pasRecordUrl ?? ""} onSave={v => onSave({ pasRecordUrl: v })} projectId={sf.projectId} />
                </>
              )}
              {(outcome === "identified_not_recorded" || outcome === "museum_interest") && (
                <EditableField label="FLO's preliminary identification" value={sf.preliminaryId ?? ""} placeholder="What did your FLO say it might be?" rows={2} onSave={v => onSave({ preliminaryId: v })} />
              )}
              {outcome === "museum_interest" && (
                <EditableLineField label="Museum / institution" value={sf.museumName ?? ""} placeholder="Museum name, if known" onSave={v => onSave({ museumName: v })} />
              )}
              {(outcome === "returned" || outcome === "museum_interest") && (
                <CurrentLocationPicker
                  value={sf.currentLocation}
                  options={outcome === "returned" ? RETURN_LOCATION_OPTIONS : CURRENT_LOCATION_OPTIONS}
                  tone="emerald"
                  onSave={v => onSave({ currentLocation: v })}
                />
              )}
              <EditableField
                label={outcome === "returned" ? "Return / closure notes" : "Closure notes"}
                value={sf.finalDispositionNotes ?? ""}
                placeholder={outcome === "returned" ? "Who received it back, when, and any landowner agreement notes..." : "Who confirmed closure and what, if anything, should happen next..."}
                rows={3}
                onSave={v => onSave({ finalDispositionNotes: v })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SignificantFindDetailSheet({ sfId, onClose }: { sfId: string; onClose: () => void }) {
  const sf = useLiveQuery<SignificantFind | undefined>(() => db.significantFinds.get(sfId), [sfId]);
  const photoOwnerIds = useMemo(
    () => Array.from(new Set([sfId, sf?.linkedFindId].filter((id): id is string => !!id))),
    [sfId, sf?.linkedFindId]
  );
  const photos = useLiveQuery<Media[]>(
    () => photoOwnerIds.length ? db.media.where("findId").anyOf(photoOwnerIds).toArray() : Promise.resolve([] as Media[]),
    [photoOwnerIds.join("|")]
  ) ?? [];
  const scatterFinds = useLiveQuery<Find[]>(
    () => sf?.scatterId ? db.finds.where("scatterId").equals(sf.scatterId).toArray() : Promise.resolve([] as Find[]),
    [sf?.scatterId]
  ) ?? [];
  const linkedFind = useLiveQuery<Find | undefined>(
    () => sf?.linkedFindId ? db.finds.get(sf.linkedFindId) : Promise.resolve(undefined),
    [sf?.linkedFindId]
  );

  const { confirm: confirmAction, dialog: confirmDialog } = useConfirmDialog();
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => { if (photoUrl) URL.revokeObjectURL(photoUrl); };
  }, [photoUrl]);

  async function setStatus(status: SignificantFind["status"]) {
    await db.significantFinds.update(sfId, { status, updatedAt: new Date().toISOString() });
  }

  async function save(patch: Partial<SignificantFind>) {
    await db.significantFinds.update(sfId, { ...patch, updatedAt: new Date().toISOString() });
  }

  async function doDelete() {
    if (!(await confirmAction({
      title: "Delete Record?",
      message: "This will permanently delete this significant find record and all its photos. This cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    }))) return;
    const record = await db.significantFinds.get(sfId);
    const linkedFindIds = [
      ...(record?.scatterFindIds ?? []),
      ...(record?.linkedFindId ? [record.linkedFindId] : []),
    ];
    await db.transaction("rw", [db.significantFinds, db.finds, db.media], async () => {
      await db.media.where("findId").equals(sfId).delete();
      if (linkedFindIds.length) {
        await db.media.where("findId").anyOf(linkedFindIds).delete();
        await db.finds.bulkDelete(linkedFindIds);
      }
      await db.significantFinds.delete(sfId);
    });
    onClose();
  }

  function openPhoto(media: Media) {
    setPhotoUrl(URL.createObjectURL(media.blob));
  }

  if (!sf) {
    return (
      <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
        <div className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl p-8 text-center animate-pulse">
          <div className="h-4 w-1/2 mx-auto rounded bg-gray-200 dark:bg-gray-700" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
        <div className="relative w-full max-w-lg max-h-[92dvh] overflow-y-auto bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="sticky top-0 bg-white dark:bg-gray-900 flex items-start justify-between px-5 pt-5 pb-3 border-b border-gray-100 dark:border-gray-800 z-10">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-black text-gray-900 dark:text-gray-100 leading-tight">
                {sf.findDescription || linkedFind?.objectType || PATH_LABELS[sf.path]}
              </h2>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                <span className={`rounded-lg px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${PATH_COLORS[sf.path]}`}>
                  {PATH_LABELS[sf.path]}
                </span>
                <span className={`rounded-lg px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${STATUS_COLORS[sf.status]}`}>
                  {getStatusLabel(sf.path, sf.status)}
                </span>
              </div>
            </div>
            <button onClick={onClose} className="ml-3 mt-0.5 shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700">x</button>
          </div>

          <div className="flex flex-col gap-4 px-5 py-4">
            {photos.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {photos.map(media => (
                  <button
                    key={media.id}
                    type="button"
                    onClick={() => openPhoto(media)}
                    className="shrink-0 w-24 h-24 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800"
                  >
                    <ScaledImage media={media} className="w-full h-full" imgClassName="object-cover w-full h-full" />
                  </button>
                ))}
              </div>
            )}

            <StatusTracker
              path={sf.path}
              status={sf.status}
              onSet={setStatus}
              landownerNotified={!!sf.landownerNotified}
              onToggleLandowner={() => save({ landownerNotified: !sf.landownerNotified })}
            />

            {sf.path === "stop_secure" && sf.status === "pas_recorded" && (
              <TreasureOutcomePanel sf={sf} onSave={save} />
            )}
            {sf.path === "map_scatter" && sf.status === "pas_recorded" && (
              <ScatterOutcomePanel sf={sf} onSave={save} />
            )}
            {sf.path === "notable_find" && sf.status === "pas_recorded" && (
              <NotableOutcomePanel sf={sf} onSave={save} />
            )}

            <div className="flex gap-2">
              <div className="flex-1 bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Location</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {formatSignificantLocation(sf)}
                </p>
                {sf.w3w && <p className="text-xs text-gray-500 mt-0.5">///{sf.w3w}</p>}
              </div>
              <div className="flex-1 bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Recorded</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{formatSignificantDate(sf.createdAt)}</p>
                {sf.gpsAccuracyM != null && <p className="text-xs text-gray-500 mt-0.5">+/-{sf.gpsAccuracyM.toFixed(1)}m</p>}
              </div>
            </div>

            {sf.path === "stop_secure" && (
              <>
                <EditableField
                  label="Excavation findings"
                  value={sf.excavationFindings ?? ""}
                  placeholder="Record what was found once professionally excavated, e.g. 47 Roman sestertii, 2 gold aurei, iron sword fragment..."
                  rows={3}
                  onSave={v => save({ excavationFindings: v })}
                />
                {(sf.initialObservations || sf.preExcavationNotes || sf.soilObservations || sf.secureCoverNotes) && (
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 flex flex-col gap-1.5">
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Pre-excavation observations</p>
                    {sf.initialObservations && <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{sf.initialObservations}</p>}
                    {sf.preExcavationNotes && <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{sf.preExcavationNotes}</p>}
                    {sf.soilObservations && <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed italic">{sf.soilObservations}</p>}
                    {sf.secureCoverNotes && <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">Secured with: {sf.secureCoverNotes}</p>}
                  </div>
                )}
                {(sf.depthCm != null || sf.periodEstimate) && (
                  <div className="flex gap-2">
                    {sf.depthCm != null && (
                      <div className="flex-1 bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Depth</p>
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{sf.depthCm}cm</p>
                      </div>
                    )}
                    {sf.periodEstimate && (
                      <div className="flex-1 bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Period estimate</p>
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{sf.periodEstimate}</p>
                      </div>
                    )}
                  </div>
                )}
                {sf.firstPersonAccount && (
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Account of discovery</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{sf.firstPersonAccount}</p>
                  </div>
                )}
                <div className="flex flex-col gap-3">
                  <EditableLineField label="Date FLO contacted" value={sf.floContactDate ?? ""} placeholder="e.g. 26 May 2026" onSave={v => save({ floContactDate: v })} />
                  <EditableLineField label="PAS record number" value={sf.pasRecordNumber ?? ""} placeholder="Assigned by your FLO after recording" onSave={v => save({ pasRecordNumber: v })} />
                  <PasRecordUrlField sfId={sfId} value={sf.pasRecordUrl ?? ""} onSave={v => save({ pasRecordUrl: v })} projectId={sf.projectId} />
                </div>
              </>
            )}

            {sf.path === "map_scatter" && (
              <>
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400 mb-1">Scatter summary</p>
                  <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{scatterFinds.length} find{scatterFinds.length !== 1 ? "s" : ""} recorded</p>
                  {sf.jurisdiction !== "unknown" && (
                    <p className="text-xs text-gray-500 mt-0.5">{JURISDICTION_LABELS[sf.jurisdiction]}</p>
                  )}
                </div>

                <ScatterMiniMap finds={scatterFinds} />

                {scatterFinds.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Finds recorded</p>
                    {scatterFinds.map((f, i) => (
                      <div key={f.id} className="flex items-center gap-3 bg-gray-50 dark:bg-gray-900 rounded-xl px-3 py-2">
                        <span className="w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-black flex items-center justify-center shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{f.objectType}</p>
                          <p className="text-xs text-gray-500">{f.period}{f.depthCm ? ` - ${f.depthCm}cm` : ""}{f.osGridRef ? ` - ${f.osGridRef}` : ""}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">Were all finds recovered?</p>
                  <div className="flex gap-2">
                    {(["yes", "partial", "no"] as const).map(opt => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => save({ allFindsRecovered: opt })}
                        className={`flex-1 py-2 rounded-xl text-xs font-black uppercase tracking-wide border transition-all ${
                          sf.allFindsRecovered === opt
                            ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
                            : "border-gray-200 dark:border-gray-700 text-gray-500 hover:border-amber-300"
                        }`}
                      >
                        {opt === "yes" ? "Yes, all" : opt === "partial" ? "Partial" : "No / unsure"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 flex flex-col gap-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Co-recorder / assisting detectorist</p>
                  <EditableLineField label="Name" value={sf.coRecorderName ?? ""} placeholder="Full name or club nickname" onSave={v => save({ coRecorderName: v })} />
                  <EditableLineField label="Contact (phone or email)" value={sf.coRecorderContact ?? ""} placeholder="So the FLO can reach them if needed" onSave={v => save({ coRecorderContact: v })} />
                  <p className="text-[10px] text-gray-400 leading-relaxed">If another detectorist helped map or recover finds, their details support the FLO's record and any future enquiries.</p>
                </div>

                {sf.firstPersonAccount && (
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Notes on the area</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{sf.firstPersonAccount}</p>
                  </div>
                )}

                <div className="flex flex-col gap-3">
                  <EditableLineField label="Date FLO contacted" value={sf.floContactDate ?? ""} placeholder="e.g. 26 May 2026" onSave={v => save({ floContactDate: v })} />
                  {sf.status !== "pas_recorded" && (
                    <>
                      <EditableLineField label="PAS record number" value={sf.pasRecordNumber ?? ""} placeholder="Assigned by your FLO after recording" onSave={v => save({ pasRecordNumber: v })} />
                      <PasRecordUrlField sfId={sfId} value={sf.pasRecordUrl ?? ""} onSave={v => save({ pasRecordUrl: v })} projectId={sf.projectId} />
                    </>
                  )}
                </div>
              </>
            )}

            {sf.path === "notable_find" && (
              <>
                {linkedFind && (linkedFind.objectType || linkedFind.period || linkedFind.material) && (
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-2">Object details</p>
                    <div className="flex flex-col gap-1">
                      {linkedFind.objectType && <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{linkedFind.objectType}</p>}
                      <div className="flex gap-2 flex-wrap">
                        {linkedFind.period && <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-lg">{linkedFind.period}</span>}
                        {linkedFind.material && <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-lg">{linkedFind.material}</span>}
                      </div>
                    </div>
                  </div>
                )}

                {(sf.depthCm != null || sf.orientationNotes || sf.soilObservations || sf.preExcavationNotes) && (
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 flex flex-col gap-1.5">
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Context recorded</p>
                    {sf.depthCm != null && <p className="text-sm text-gray-700 dark:text-gray-300">Depth: {sf.depthCm}cm</p>}
                    {sf.orientationNotes && <p className="text-sm text-gray-700 dark:text-gray-300">Orientation: {sf.orientationNotes}</p>}
                    {sf.soilObservations && <p className="text-sm text-gray-700 dark:text-gray-300">Soil: {sf.soilObservations}</p>}
                    {sf.preExcavationNotes && <p className="text-sm text-gray-700 dark:text-gray-300">Associated material: {sf.preExcavationNotes}</p>}
                  </div>
                )}

                {sf.firstPersonAccount && (
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Description</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{sf.firstPersonAccount}</p>
                  </div>
                )}

                {sf.status !== "pas_recorded" && (
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">Where is the find now?</p>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { value: "with_finder", label: "With me" },
                        { value: "with_flo", label: "With FLO" },
                        { value: "at_museum", label: "At museum" },
                        { value: "other", label: "Other" },
                      ] as const).map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => save({ currentLocation: opt.value })}
                          className={`py-2.5 rounded-xl text-xs font-black uppercase tracking-wide border transition-all ${
                            sf.currentLocation === opt.value
                              ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                              : "border-gray-200 dark:border-gray-700 text-gray-500 hover:border-emerald-300"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-3">
                  <EditableLineField label="Date FLO contacted" value={sf.floContactDate ?? ""} placeholder="e.g. 26 May 2026" onSave={v => save({ floContactDate: v })} />
                  {sf.status !== "pas_recorded" && (
                    <>
                      <EditableField label="FLO's preliminary identification" value={sf.preliminaryId ?? ""} placeholder="What did your FLO say it might be?" rows={2} onSave={v => save({ preliminaryId: v })} />
                      <EditableLineField label="PAS record number" value={sf.pasRecordNumber ?? ""} placeholder="Assigned by your FLO after recording" onSave={v => save({ pasRecordNumber: v })} />
                      <PasRecordUrlField sfId={sfId} value={sf.pasRecordUrl ?? ""} onSave={v => save({ pasRecordUrl: v })} projectId={sf.projectId} />
                    </>
                  )}
                </div>
              </>
            )}

            <button
              onClick={onClose}
              className="w-full bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-black uppercase tracking-widest py-3.5 rounded-2xl text-sm"
            >
              Done
            </button>

            <button
              type="button"
              onClick={doDelete}
              className="w-full py-3 text-xs font-black uppercase tracking-widest text-red-400 hover:text-red-600 transition-colors"
            >
              Delete record
            </button>
            {confirmDialog}
          </div>
        </div>
      </div>

      {photoUrl && (
        <div
          className="fixed inset-0 z-[130] bg-black flex items-center justify-center"
          onClick={() => { URL.revokeObjectURL(photoUrl); setPhotoUrl(null); }}
        >
          <img src={photoUrl} alt="Find photo" className="max-w-full max-h-full object-contain" />
          <button className="absolute top-5 right-5 w-10 h-10 rounded-full bg-white/20 text-white flex items-center justify-center text-lg">x</button>
        </div>
      )}
    </>
  );
}
