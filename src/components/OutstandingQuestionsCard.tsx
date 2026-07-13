import React, { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import { db } from "../db";
import type { OutstandingQuestion } from "../db";
import { confidenceBand } from "../outstandingQuestions/types";
import { getPermissionScanTarget } from "../outstandingQuestions/permissionScanTarget";
import { ChevronDownIcon } from "./AppIcons";
import { PermissionPulseCard } from "./PermissionPulseCard";

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
    <span className={`${s.bg} ${s.text} shrink-0 rounded-md px-1.5 py-0.5 text-2xs font-bold`}>
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
    <div className="overflow-hidden rounded-xl border border-sky-100 bg-white/80 shadow-sm transition-shadow hover:shadow-md dark:border-sky-900/50 dark:bg-gray-900/55">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full px-3.5 py-3 text-left transition-colors hover:bg-sky-50/60 dark:hover:bg-sky-950/20"
      >
        <div className="flex items-center gap-2.5">
          <p className="min-w-0 flex-1 text-sm font-bold leading-snug text-gray-900 dark:text-gray-100">{q.title}</p>
          <ChevronDownIcon className={`mt-1 h-4 w-4 shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {expanded && (
        <div className="mx-3.5 space-y-2.5 border-t border-gray-200 pb-3 pt-2.5 dark:border-gray-700/50">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-300">{q.description}</p>
            <StatusBadge status={q.status} />
          </div>
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
          {q.status !== 'RESOLVED' && q.locationActionAllowed !== false && (
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
  const navigate = useNavigate();

  const questions = useLiveQuery(
    () => db.outstandingQuestions.where("permissionId").equals(permissionId).toArray(),
    [permissionId],
  );
  const permission = useLiveQuery(() => db.permissions.get(permissionId), [permissionId]);

  if (!questions || !permission) return null;

  const active = questions
    .filter(q => q.status !== 'RESOLVED')
    .sort((a, b) => b.confidence - a.confidence || a.createdAt - b.createdAt);
  const resolved = questions.filter(q => q.status === 'RESOLVED');
  // Separate deferred from genuinely resolved
  const deferred = resolved.filter(q => q.resolvedReason === 'cap_evicted');
  const genuinelyResolved = resolved.filter(q => q.resolvedReason !== 'cap_evicted');

  const isEmpty = active.length === 0;
  const hasNoHistory = questions.length === 0;
  const hasBoundary = !!permission.boundary?.coordinates?.[0]?.length;
  const center = getPermissionScanTarget(permission);

  const openFieldGuide = () => {
    if (!center) {
      navigate('/fieldguide');
      return;
    }
    const params = new URLSearchParams({
      lat: center.lat.toFixed(6),
      lng: center.lon.toFixed(6),
      scan: "questions",
      permissionId,
    });
    navigate(`/fieldguide?${params.toString()}`);
  };

  const evaluatedLabel = permission.questionsEvaluatedAt
    ? new Date(permission.questionsEvaluatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-sky-200/80 bg-gradient-to-br from-white via-white to-sky-50/80 shadow-[0_16px_45px_-28px_rgba(14,116,144,0.65)] dark:border-sky-800/60 dark:from-gray-900 dark:via-gray-900 dark:to-sky-950/35">
      <div className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full bg-sky-300/15 blur-2xl dark:bg-sky-400/10" />

      <header className="relative flex items-start justify-between gap-3 border-b border-sky-100/80 px-4 py-4 dark:border-sky-900/50 sm:px-5">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-teal-500 to-sky-600 text-white shadow-md shadow-sky-500/20">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M9.25 9a3 3 0 1 1 4.95 2.28c-1.35 1.17-2.2 1.72-2.2 3.22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="12" cy="18" r="1" fill="currentColor" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-2xs font-black uppercase tracking-[0.2em] text-sky-600 dark:text-sky-400">Field intelligence</p>
            <h3 className="text-lg font-black tracking-tight text-gray-900 dark:text-white">Questions &amp; Insights</h3>
            <p className="mt-0.5 text-2xs leading-relaxed text-gray-500 dark:text-gray-400">
              Evidence worth revisiting as your field record develops.
            </p>
          </div>
        </div>
        <div className="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-2xs font-black text-sky-700 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300">
          {active.length} active
        </div>
      </header>

      <PermissionPulseCard permissionId={permissionId} embedded />

      <div className="relative p-4 sm:p-5">
        <div className="mb-2.5 flex items-end justify-between gap-3">
          <div>
            <p className="text-2xs font-black uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Review questions</p>
            {evaluatedLabel && <p className="mt-0.5 text-2xs text-gray-400">Last evaluated {evaluatedLabel}</p>}
          </div>
        </div>

        <div className="grid gap-2.5 md:grid-cols-2">
        {hasNoHistory && (
          <div className="rounded-xl border border-dashed border-sky-200 bg-white/60 p-3 dark:border-sky-800/70 dark:bg-gray-950/20 md:col-span-2">
            <p className="text-sm font-black text-gray-800 dark:text-gray-100">
              {permission.questionsEvaluatedAt ? "No open questions right now" : "Ready for its first review"}
            </p>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              {permission.questionsEvaluatedAt
                ? EMPTY_SCANNED
                : hasBoundary
                  ? "A focused scan checks the permission for landscape signals, quiet areas and routes that may need more evidence."
                  : "Add a mapped permission boundary first. Questions are generated from FieldGuide scans inside that boundary."}
            </p>
          </div>
        )}

        {!hasNoHistory && isEmpty && (
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

      <footer className="relative flex flex-col gap-2.5 border-t border-sky-100/80 bg-white/55 px-4 py-3 dark:border-sky-900/50 dark:bg-gray-950/15 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <p className="text-xs font-bold text-gray-700 dark:text-gray-200">Refresh the evidence</p>
          <p className="mt-0.5 text-2xs text-gray-500 dark:text-gray-400">Reads terrain first, then adds historic landscape context.</p>
        </div>
        {hasBoundary ? (
          <button
            type="button"
            onClick={openFieldGuide}
            className="group inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-500 to-sky-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white shadow-md shadow-sky-600/20 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-sky-600/25"
          >
            Scan this permission
            <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
          </button>
        ) : (
          <p className="text-xs font-bold text-amber-600 dark:text-amber-400">Map a boundary to enable scanning</p>
        )}
      </footer>
    </section>
  );
}
