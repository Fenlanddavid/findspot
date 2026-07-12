import React, { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import { db } from "../db";
import type { OutstandingQuestion } from "../db";
import { confidenceBand } from "../outstandingQuestions/types";
import { ChevronDownIcon } from "./AppIcons";

// ─── Empty state copy (exact, fail-safe) ────────────────────────────────────

const EMPTY_SCANNED = "No open questions from the latest scan. This reflects what FieldGuide can currently see — not a complete picture of the landscape.";

// ─── Status display ─────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  UNRESOLVED:     { bg: "bg-amber-100 dark:bg-amber-500/20",   text: "text-amber-700 dark:text-amber-400",   label: "Open" },
  NEEDS_EVIDENCE: { bg: "bg-blue-100 dark:bg-blue-500/20",     text: "text-blue-700 dark:text-blue-400",     label: "Needs evidence" },
  WEAKENING:      { bg: "bg-orange-100 dark:bg-orange-500/20", text: "text-orange-700 dark:text-orange-400", label: "Weakening" },
  RESOLVED:       { bg: "bg-gray-100 dark:bg-gray-500/20",     text: "text-gray-600 dark:text-gray-400",     label: "Resolved" },
};

const RESOLVED_REASON_LABEL: Record<string, string> = {
  preconditions_cleared: "Conditions no longer hold",
  superseded: "Superseded by a newer question",
  cap_evicted: "Deferred — lower priority",
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.UNRESOLVED;
  return (
    <span className={`${s.bg} ${s.text} shrink-0 rounded-md px-2 py-1 text-xs font-bold`}>
      {s.label}
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const band = confidenceBand(confidence);
  const style = band === 'Strong'
    ? 'text-emerald-700 dark:text-emerald-400'
    : band === 'Moderate'
    ? 'text-amber-700 dark:text-amber-400'
    : 'text-gray-500 dark:text-gray-400';
  return (
    <span className={`text-2xs font-bold ${style}`}>{band}</span>
  );
}

// ─── Question row ───────────────────────────────────────────────────────────

function QuestionRow({ q }: { q: OutstandingQuestion }) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();

  const openInFieldGuide = () => {
    const params = new URLSearchParams({
      lat: q.anchor.lat.toFixed(6),
      lng: q.anchor.lon.toFixed(6),
    });
    navigate(`/fieldguide?${params.toString()}`);
  };

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700/70 dark:bg-gray-800/40">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full px-4 py-4 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-800/60"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold leading-snug text-gray-900 dark:text-gray-100">{q.title}</p>
            <div className="mt-2"><StatusBadge status={q.status} /></div>
          </div>
          <ChevronDownIcon className={`mt-1 h-4 w-4 shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
        <p className="mt-3 text-sm leading-relaxed text-gray-600 dark:text-gray-300">{q.description}</p>
      </button>

      {expanded && (
        <div className="mx-4 pb-3 space-y-3 border-t border-gray-200 dark:border-gray-700/50 pt-3">
          {q.supportingEvidence.length > 0 && (
            <div>
              <p className="text-2xs font-black uppercase tracking-widest text-gray-500 mb-1">Supporting evidence</p>
              {q.supportingEvidence.map((e, i) => (
                <p key={i} className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">• {e.label}</p>
              ))}
            </div>
          )}
          {q.contradictingEvidence.length > 0 && (
            <div>
              <p className="text-2xs font-black uppercase tracking-widest text-gray-500 mb-1">Contradicting evidence</p>
              {q.contradictingEvidence.map((e, i) => (
                <p key={i} className="text-xs text-orange-700 dark:text-orange-300/80 leading-relaxed">• {e.label}</p>
              ))}
            </div>
          )}
          <div className="flex items-start justify-between gap-3">
            <ConfidenceBadge confidence={q.confidence} />
            <span className="text-2xs text-right text-gray-500">
              {q.status === 'UNRESOLVED' && 'Supported by the latest scan.'}
              {q.status === 'NEEDS_EVIDENCE' && 'More recorded coverage near this location would help.'}
              {q.status === 'WEAKENING' && 'Not seen in the latest scan; it will close if that repeats.'}
              {q.status === 'RESOLVED' && (q.resolvedReason ? RESOLVED_REASON_LABEL[q.resolvedReason] ?? 'Resolved' : 'Resolved')}
            </span>
          </div>
          {q.status !== 'RESOLVED' && (
            <button
              type="button"
              onClick={openInFieldGuide}
              className="text-xs font-bold text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors"
            >
              View location in FieldGuide
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main card ──────────────────────────────────────────────────────────────

export function OutstandingQuestionsCard({ permissionId }: { permissionId: string }) {
  const [showResolved, setShowResolved] = useState(false);

  const questions = useLiveQuery(
    () => db.outstandingQuestions.where("permissionId").equals(permissionId).toArray(),
    [permissionId],
  );

  if (!questions) return null;
  if (questions.length === 0) return null;

  const active = questions
    .filter(q => q.status !== 'RESOLVED')
    .sort((a, b) => b.confidence - a.confidence || a.createdAt - b.createdAt);
  const resolved = questions.filter(q => q.status === 'RESOLVED');
  // Separate deferred from genuinely resolved
  const deferred = resolved.filter(q => q.resolvedReason === 'cap_evicted');
  const genuinelyResolved = resolved.filter(q => q.resolvedReason !== 'cap_evicted');

  const isEmpty = active.length === 0;

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900/60">
      <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-teal-600 dark:text-teal-400">Outstanding Questions</p>
          {!isEmpty && (
            <p className="text-2xs text-gray-400 mt-0.5">{active.length} active</p>
          )}
        </div>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-2 md:p-5">
        {isEmpty && (
          <p className="text-sm text-gray-500 leading-relaxed italic md:col-span-2">
            {EMPTY_SCANNED}
          </p>
        )}

        {active.map(q => <QuestionRow key={q.id} q={q} />)}

        {(deferred.length > 0 || genuinelyResolved.length > 0) && (
          <button
            onClick={() => setShowResolved(!showResolved)}
            aria-expanded={showResolved}
            className="mt-2 text-xs font-bold text-gray-500 transition-colors hover:text-gray-700 dark:hover:text-gray-300 md:col-span-2"
          >
            {deferred.length > 0 && `Deferred (${deferred.length})`}
            {deferred.length > 0 && genuinelyResolved.length > 0 && ' · '}
            {genuinelyResolved.length > 0 && `Resolved (${genuinelyResolved.length})`}
          </button>
        )}

        {showResolved && [...deferred, ...genuinelyResolved]
          .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0))
          .map(q => <QuestionRow key={q.id} q={q} />)}
      </div>
    </div>
  );
}
