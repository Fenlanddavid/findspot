import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  derivePermissionPulse,
  PulseFact,
  PulseSeverity,
} from "../services/permissionPulse";

const SEVERITY_STYLE: Record<
  PulseSeverity,
  { className: string; prefix: string; italic?: boolean }
> = {
  obligation: {
    className: "text-amber-300/90",
    prefix: "▲ ",
  },
  action: {
    className: "text-white/[0.84]",
    prefix: "● ",
  },
  delta: {
    className: "text-white/[0.72]",
    prefix: "• ",
  },
  ambient: {
    className: "text-white/[0.55]",
    prefix: "• ",
    italic: true,
  },
};

function renderSlottedText(fact: PulseFact): string {
  // Build display string from template + slots
  const { templateId, slots } = fact;
  // We inline the resolved text rather than importing PULSE_TEMPLATES
  // to keep the rendering self-contained.
  const TEMPLATES: Record<string, string> = {
    sf_coroner_notified:
      "A reported find here is awaiting coroner process.",
    sf_awaiting_excavation:
      "A significant find location awaits excavation.",
    sf_in_progress:
      "A significant find record here is incomplete.",
    open_signals:
      "{count} un-dug signal{s} await{verb} investigation.",
    last_visit: "Last detected here {gapDays} days ago.",
    crop_change_stubble:
      "Now in stubble — was {prevCrop} on your last visit.",
    crop_change_crop:
      "Crop recorded as {crop}, previously {prevCrop}.",
    last_visit_finds:
      "Your last session produced {count} find{s}{nameClause}.",
    seasonal_pattern:
      "Your visits here have historically fallen between {monthA} and {monthB}.",
  };
  let text = TEMPLATES[templateId] || templateId;
  for (const [key, val] of Object.entries(slots)) {
    text = text.replace(`{${key}}`, String(val));
  }
  return text;
}

export function PermissionPulseCard({
  permissionId,
}: {
  permissionId: string;
}) {
  const nav = useNavigate();
  const [expanded, setExpanded] = useState(false);

  const facts = useLiveQuery(
    () => derivePermissionPulse(permissionId, new Date()),
    [permissionId]
  );

  if (!facts || facts.length === 0) return null;

  // Obligations are never collapsed behind the +n toggle.
  const obligations = facts.filter((f) => f.severity === "obligation");
  const rest = facts.filter((f) => f.severity !== "obligation");
  const visibleSlots = 5 - obligations.length;
  const visibleRest = expanded ? rest : rest.slice(0, Math.max(0, visibleSlots));
  const hiddenCount = rest.length - visibleRest.length;

  const allVisible = [...obligations, ...visibleRest];

  // Header: "SINCE YOUR LAST VISIT" if any session-derived facts exist,
  // else "THIS PERMISSION" (e.g. obligation on a session-less permission).
  const hasSessionFacts = facts.some(
    (f) =>
      f.severity === "delta" || f.severity === "ambient"
  );
  const header = hasSessionFacts ? "SINCE YOUR LAST VISIT" : "THIS PERMISSION";

  function handleTap(fact: PulseFact) {
    if (!fact.link) return;
    if (fact.link.kind === "scroll") {
      document
        .getElementById(fact.link.anchorId)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (fact.link.kind === "route") {
      nav(fact.link.to);
    }
    // sf-resume: unlinked in v1
  }

  return (
    <div className="rounded-2xl bg-gray-900 dark:bg-gray-800/80 px-4 py-3 mb-4">
      <div className="text-3xs font-black uppercase tracking-[0.2em] text-white/40 mb-2">
        {header}
      </div>
      <div className="flex flex-col gap-1">
        {allVisible.map((fact) => {
          const style = SEVERITY_STYLE[fact.severity];
          const isInteractive = !!fact.link && fact.link.kind !== "sf-resume";
          const Tag = isInteractive ? "button" : "div";
          return (
            <Tag
              key={fact.id}
              className={`text-left text-xs font-bold leading-snug ${style.className} ${style.italic ? "italic" : ""} ${isInteractive ? "hover:opacity-80 transition-opacity" : ""}`}
              onClick={isInteractive ? () => handleTap(fact) : undefined}
            >
              {style.prefix}
              {renderSlottedText(fact)}
            </Tag>
          );
        })}
        {hiddenCount > 0 && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="text-left text-xs font-bold text-white/40 hover:text-white/60 transition-colors mt-1"
          >
            + {hiddenCount} more
          </button>
        )}
      </div>
    </div>
  );
}
