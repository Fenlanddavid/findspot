import React, { useState } from "react";
import { useNavigate } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import {
  derivePermissionPulse,
  PULSE_TEMPLATES,
  PulseFact,
  PulseSeverity,
} from "../services/permissionPulse";

const SEVERITY_STYLE: Record<
  PulseSeverity,
  { className: string; prefix: string; italic?: boolean }
> = {
  obligation: {
    className: "text-amber-700 dark:text-amber-300",
    prefix: "▲ ",
  },
  action: {
    className: "text-gray-800 dark:text-gray-100",
    prefix: "● ",
  },
  delta: {
    className: "text-gray-700 dark:text-gray-300",
    prefix: "• ",
  },
  ambient: {
    className: "text-gray-500 dark:text-gray-400",
    prefix: "• ",
    italic: true,
  },
};

function renderSlottedText(fact: PulseFact): string {
  const { templateId, slots } = fact;
  let text = PULSE_TEMPLATES[templateId];
  for (const [key, val] of Object.entries(slots)) {
    text = text.replace(`{${key}}`, String(val));
  }
  return text;
}

export function PermissionPulseCard({
  permissionId,
  embedded = false,
  onOpenInvestigations,
}: {
  permissionId: string;
  embedded?: boolean;
  onOpenInvestigations?: () => void;
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
  const rest = facts.filter((f) => f.severity !== "obligation").sort((a, b) => {
    const order = ['last_visit', 'last_visit_finds', 'last_visit_observations', 'questions_changed', 'open_signals', 'last_visit_note'];
    const rank = (id: string) => order.includes(id) ? order.indexOf(id) : order.length;
    return rank(a.templateId) - rank(b.templateId);
  });
  // Keep the latest visit and open questions visible even when obligations
  // occupy the usual summary slots.
  const essential = new Set(['last_visit', 'questions_changed']);
  const detailSlots = Math.max(0, 5 - obligations.length - rest.filter(f => essential.has(f.templateId)).length);
  let detailsShown = 0;
  const visibleRest = expanded ? rest : rest.filter(f => essential.has(f.templateId) || detailsShown++ < detailSlots);
  const hiddenCount = rest.length - visibleRest.length;

  const allVisible = [...obligations, ...visibleRest];

  // Header: "YOUR RECORDED VISITS" if any session-derived facts exist,
  // else "THIS PERMISSION" (e.g. obligation on a session-less permission).
  const sessionTemplateIds = new Set([
    "coverage_context",
    "last_visit",
    "crop_change_stubble",
    "crop_change_crop",
    "last_visit_finds",
    "seasonal_pattern",
  ]);
  const hasSessionFacts = facts.some((fact) => sessionTemplateIds.has(fact.templateId));
  const header = hasSessionFacts ? "YOUR RECORDED VISITS" : "THIS PERMISSION";
  const nextAction = facts.find(fact => fact.severity === 'obligation' && fact.link)
    ?? facts.find(fact => fact.severity === 'action' && fact.link);

  function handleTap(fact: PulseFact) {
    if (!fact.link) return;
    if (fact.link.kind === "scroll") {
      if (fact.link.anchorId === 'outstanding-questions-section') onOpenInvestigations?.();
      document
        .getElementById(fact.link.anchorId)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (fact.link.kind === "route") {
      nav(fact.link.to);
    }
    // sf-resume: unlinked in v1
  }

  return (
    <div className={embedded
      ? "border-b border-sky-100/80 bg-sky-50/70 px-4 py-3 dark:border-sky-900/50 dark:bg-sky-950/20 sm:px-5"
      : "rounded-lg border border-gray-200 bg-gray-50 px-5 py-4 dark:border-gray-700 dark:bg-gray-800/60"}
    >
      <div className={`mb-1.5 flex items-center gap-1.5 font-black uppercase tracking-widest ${embedded ? "text-2xs text-sky-700 dark:text-sky-300" : "text-xs text-gray-500 dark:text-gray-400"}`}>
        {embedded && (
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" />
          </svg>
        )}
        {header}
      </div>
      <div className={embedded ? "grid gap-1 sm:grid-cols-2 sm:gap-x-5" : "flex flex-col gap-1"}>
        {allVisible.map((fact) => {
          const style = SEVERITY_STYLE[fact.severity];
          const isInteractive = !!fact.link && fact.link.kind !== "sf-resume";
          const Tag = isInteractive ? "button" : "div";
          return (
            <Tag
              key={fact.id}
              className={`text-left text-sm font-medium leading-snug ${style.className} ${style.italic ? "italic" : ""} ${isInteractive ? "min-h-11 py-1 hover:opacity-80 transition-opacity" : ""}`}
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
            className="mt-1 min-h-11 text-left text-xs font-bold text-gray-500 transition-colors hover:text-gray-700 dark:hover:text-gray-300"
          >
            + {hiddenCount} more
          </button>
        )}
      </div>
      {nextAction && <button type="button" onClick={() => handleTap(nextAction)} className="mt-2 min-h-11 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white">
        {nextAction.severity === 'obligation' ? 'Review outstanding obligation' : nextAction.templateId === 'questions_changed' ? 'Review investigations' : 'Review open signals'}
      </button>}
    </div>
  );
}
