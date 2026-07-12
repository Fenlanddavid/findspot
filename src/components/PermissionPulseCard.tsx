import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
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
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-5 py-4 dark:border-gray-700 dark:bg-gray-800/60">
      <div className="mb-2 text-xs font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
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
            className="mt-1 text-left text-xs font-bold text-gray-500 transition-colors hover:text-gray-700 dark:hover:text-gray-300"
          >
            + {hiddenCount} more
          </button>
        )}
      </div>
    </div>
  );
}
