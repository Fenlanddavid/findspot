import React from "react";
import type { RallyPersona } from "../utils/rallyPersona";

const CHIP_CONFIG: Record<
  RallyPersona,
  { label: string; bg: string; text: string } | null
> = {
  personal: {
    label: "MY DIG RECORD",
    bg: "bg-emerald-100 dark:bg-emerald-900/40",
    text: "text-emerald-700 dark:text-emerald-400",
  },
  organiser: {
    label: "ORGANISER EVENT",
    bg: "bg-amber-100 dark:bg-amber-900/40",
    text: "text-amber-700 dark:text-amber-400",
  },
  member: {
    label: "CLUB DAY - MEMBER",
    bg: "bg-teal-100 dark:bg-teal-900/40",
    text: "text-teal-700 dark:text-teal-400",
  },
  kept_record: {
    label: "MY DIG RECORD",
    bg: "bg-emerald-100 dark:bg-emerald-900/40",
    text: "text-emerald-700 dark:text-emerald-400",
  },
  not_rally: null,
};

export function RallyPersonaChip({
  persona,
}: {
  persona: RallyPersona;
}) {
  const cfg = CHIP_CONFIG[persona];
  if (!cfg) return null;
  return (
    <span
      className={`inline-block text-2xs font-black uppercase tracking-widest px-2 py-0.5 rounded ${cfg.bg} ${cfg.text}`}
    >
      {cfg.label}
    </span>
  );
}
