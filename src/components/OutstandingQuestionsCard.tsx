import React, { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import { db } from "../db";
import type { Find, OutstandingQuestion, Permission, Track } from "../db";
import { confidenceBand, NOTE_TAG_LABELS } from "../outstandingQuestions/types";
import type { QuestionNote } from "../outstandingQuestions/types";
import {
  ATTENTION_CAP,
  fieldworkProgress,
  hypothesisFor,
  interpretationDirection,
  investigationPriority,
} from "../outstandingQuestions/investigationState";
import { interpretationCopyFor } from "../outstandingQuestions/interpretationCopy";
import {
  buildInvestigationTimeline,
  type InvestigationTimelineEvent,
} from "../outstandingQuestions/investigationTimeline";
import {
  calculateInvestigationSections,
  type InvestigationSectionStat,
} from "../outstandingQuestions/sectionalStats";
import { terminalSupersedingQuestionId } from "../outstandingQuestions/transitionHistory";
import { getPermissionScanTarget } from "../outstandingQuestions/permissionScanTarget";
import { ChevronDownIcon } from "./AppIcons";
import { PermissionPulseCard } from "./PermissionPulseCard";
import { saveQuestionInvestigationNote, setQuestionDismissed } from "../services/investigationMutations";

// ─── Protection banner ─────────────────────────────────────────────────────

function ProtectionBanner({ protection }: { protection: Permission['protectionStatus'] }) {
  // A missing persisted value is deliberately rendered as unknown. Existing
  // permissions pre-date the banner, and silence must never look like safety.
  const state = protection?.state ?? 'unknown';

  if (state === 'present') {
    return (
      <div className="mx-4 mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 dark:border-red-800/60 dark:bg-red-950/30 sm:mx-5">
        <p className="text-xs font-bold text-red-800 dark:text-red-300">Scheduled monument intersects this permission</p>
        <p className="mt-0.5 text-xs text-red-700 dark:text-red-400">
          Protected archaeology — do not detect within the monument or its buffer.
        </p>
      </div>
    );
  }

  if (state === 'unknown') {
    return (
      <div className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 dark:border-amber-800/60 dark:bg-amber-950/30 sm:mx-5">
        <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-400">
          Protection status not yet verified for this permission — scan to check.
        </p>
      </div>
    );
  }

  // state === 'clear'
  const evaluatedLabel = new Date(protection!.evaluatedAt).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
  return (
    <p className="mx-4 mt-3 text-2xs text-gray-400 dark:text-gray-500 sm:mx-5">
      No scheduled monuments detected — last checked {evaluatedLabel}.
    </p>
  );
}

// ─── Empty state copy (exact, fail-safe) ────────────────────────────────────

const EMPTY_SCANNED = "No open investigations from the latest scan. This reflects what FieldGuide can currently see — not a complete picture of the landscape.";

// ─── Status display ─────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  UNRESOLVED:     { bg: "bg-amber-100 dark:bg-amber-500/20",   text: "text-amber-700 dark:text-amber-400",   label: "Open" },
  NEEDS_EVIDENCE: { bg: "bg-blue-100 dark:bg-blue-500/20",     text: "text-blue-700 dark:text-blue-400",     label: "Needs evidence" },
  WEAKENING:      { bg: "bg-orange-100 dark:bg-orange-500/20", text: "text-orange-700 dark:text-orange-400", label: "Weakening" },
  RESOLVED:       { bg: "bg-gray-100 dark:bg-gray-500/20",     text: "text-gray-600 dark:text-gray-400",     label: "Resolved" },
};

const RESOLVED_REASON_LABEL: Record<string, string> = {
  preconditions_cleared: "Conditions no longer hold",
  superseded: "Superseded by a newer investigation",
  cap_evicted: "Deferred — lower priority",
};

const FIELDWORK_LABEL = {
  BLOCKED: 'Ground blocked',
  UNTESTED: 'Untested',
  PARTLY_TESTED: 'Partly tested',
  WELL_TESTED: 'Well tested',
} as const;

const DIRECTION_LABEL = {
  STILL_UNTESTED: 'Still untested',
  SUPPORTING: 'Supporting',
  CONTRARY: 'Contrary',
  MIXED: 'Mixed',
  NO_CHANGE: 'No change',
} as const;

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

function InvestigationAxes({ q, notes }: { q: OutstandingQuestion; notes: QuestionNote[] }) {
  const progress = fieldworkProgress(q, notes);
  const direction = interpretationDirection(q, notes);
  return (
    <div className="flex flex-wrap gap-1.5">
      <StatusBadge status={q.status} />
      <span className="rounded-md bg-sky-100 px-1.5 py-0.5 text-2xs font-bold text-sky-700 dark:bg-sky-500/20 dark:text-sky-300">
        {FIELDWORK_LABEL[progress]}
      </span>
      <span className="rounded-md bg-violet-100 px-1.5 py-0.5 text-2xs font-bold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">
        {DIRECTION_LABEL[direction]}
      </span>
    </div>
  );
}

// ─── Note composer (B3) ─────────────────────────────────────────────────────

const TAG_TYPES = Object.keys(NOTE_TAG_LABELS) as (keyof typeof NOTE_TAG_LABELS)[];

function FindPicker({ permissionId, selected, onToggle }: {
  permissionId: string;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const finds = useLiveQuery(
    () => db.finds.where("permissionId").equals(permissionId)
      .reverse().sortBy("createdAt").then(rows => rows.slice(0, 20)),
    [permissionId],
  );
  if (!finds || finds.length === 0) return <p className="text-2xs text-gray-400 italic">No finds recorded on this permission yet.</p>;
  return (
    <div className="mt-1.5 max-h-36 space-y-1 overflow-y-auto">
      {finds.map(f => (
        <label key={f.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/40 cursor-pointer">
          <input type="checkbox" checked={selected.includes(f.id)} onChange={() => onToggle(f.id)} className="accent-emerald-600" />
          <span className="truncate">{f.objectType}{f.period ? ` — ${f.period}` : ''}</span>
        </label>
      ))}
    </div>
  );
}

function NoteComposer({ questionId, permissionId, onSaved }: {
  questionId: string;
  permissionId: string;
  onSaved: () => void;
}) {
  const [selectedTag, setSelectedTag] = useState<keyof typeof NOTE_TAG_LABELS | null>(null);
  const [freeform, setFreeform] = useState('');
  const [linkedFindIds, setLinkedFindIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const toggleFind = (id: string) => setLinkedFindIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const canSave = selectedTag !== null || freeform.trim().length > 0;

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      const note: QuestionNote = {
        id: crypto.randomUUID(),
        questionId,
        author: 'user',
        type: selectedTag ?? 'freeform',
        createdAt: Date.now(),
      };
      if (freeform.trim()) note.text = freeform.trim().slice(0, 1000);
      if (selectedTag === 'found_something' && linkedFindIds.length > 0) note.linkedFindIds = linkedFindIds;
      await saveQuestionInvestigationNote(note);
      setSelectedTag(null);
      setFreeform('');
      setLinkedFindIds([]);
      onSaved();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50/80 p-2.5 dark:border-gray-700 dark:bg-gray-800/40">
      <p className="text-2xs font-black uppercase tracking-widest text-gray-500">Add a note</p>
      <div className="flex flex-wrap gap-1.5">
        {TAG_TYPES.map(tag => (
          <button
            key={tag}
            type="button"
            onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
            className={`rounded-full border px-2.5 py-1 text-2xs font-bold transition-colors ${
              selectedTag === tag
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-gray-500'
            }`}
          >
            {NOTE_TAG_LABELS[tag]}
          </button>
        ))}
      </div>
      {selectedTag === 'found_something' && (
        <FindPicker permissionId={permissionId} selected={linkedFindIds} onToggle={toggleFind} />
      )}
      <textarea
        value={freeform}
        onChange={e => setFreeform(e.target.value.slice(0, 1000))}
        placeholder="Optional — add context…"
        rows={2}
        maxLength={1000}
        className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 placeholder:text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:placeholder:text-gray-500"
      />
      <div className="flex items-center justify-between">
        <span className="text-2xs text-gray-400">{freeform.length}/1000</span>
        <button
          type="button"
          onClick={save}
          disabled={!canSave || saving}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-2xs font-bold text-white transition-colors hover:bg-emerald-700 disabled:opacity-40 dark:bg-emerald-700 dark:hover:bg-emerald-600"
        >
          Save note
        </button>
      </div>
      {saveError && <p className="text-xs text-red-600 dark:text-red-400">Could not save this note. Try again.</p>}
    </div>
  );
}

// ─── Investigation timeline (E2) ───────────────────────────────────────────

function TimelineEventBody({ event }: { event: InvestigationTimelineEvent }) {
  if (event.kind !== 'note') {
    return <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-300">{event.text}</p>;
  }

  const note = event.note;
  const observationLabel = note.author === 'user' && note.type in NOTE_TAG_LABELS
    ? NOTE_TAG_LABELS[note.type as keyof typeof NOTE_TAG_LABELS]
    : null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`rounded px-1.5 py-0.5 text-2xs font-bold ${
          note.author === 'user'
            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
            : 'bg-gray-100 text-gray-500 dark:bg-gray-700/50 dark:text-gray-400'
        }`}>
          {note.author === 'user' ? 'You' : 'System'}
        </span>
        {observationLabel && <span className="text-2xs font-bold text-gray-600 dark:text-gray-400">{observationLabel}</span>}
      </div>
      {note.text && <p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-300">{note.text}</p>}
      {note.linkedFindIds && note.linkedFindIds.length > 0 && <LinkedFinds findIds={note.linkedFindIds} />}
    </>
  );
}

function InvestigationTimeline({ events }: { events: InvestigationTimelineEvent[] }) {
  return (
    <div>
      <p className="mb-1.5 text-2xs font-black uppercase tracking-widest text-gray-500">Timeline</p>
      <ol className="space-y-1.5">
        {events.map(event => (
          <li key={event.id} className="relative border-l-2 border-sky-100 py-1 pl-3 dark:border-sky-900/60">
            <span className="absolute -left-[5px] top-2 h-2 w-2 rounded-full bg-sky-400 dark:bg-sky-600" />
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1"><TimelineEventBody event={event} /></div>
              <time className="shrink-0 text-2xs text-gray-400">
                {new Date(event.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </time>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SectionalStats({ sections }: { sections: InvestigationSectionStat[] }) {
  if (sections.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-2xs font-black uppercase tracking-widest text-gray-500">Along the corridor</p>
      <div className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white/60 px-2.5 dark:divide-gray-700/50 dark:border-gray-700/50 dark:bg-gray-800/20">
        {sections.map(section => (
          <div key={section.index} className="flex items-center justify-between gap-3 py-1.5 text-xs">
            <span className="text-gray-600 dark:text-gray-300">{section.label}</span>
            <span className="text-right text-gray-500 dark:text-gray-400">
              {section.outsidePermission
                ? 'Outside permission'
                : `${section.coveragePct == null ? 'Coverage unavailable' : `${Math.round(section.coveragePct)}% coverage`} · ${section.findsCount ?? 0} nearby ${section.findsCount === 1 ? 'find' : 'finds'}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LinkedFinds({ findIds }: { findIds: string[] }) {
  const finds = useLiveQuery(
    () => db.finds.where('id').anyOf(findIds).toArray(),
    [findIds],
  );
  if (!finds) return null;
  const findMap = new Map(finds.map(f => [f.id, f]));
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {findIds.map(id => {
        const f = findMap.get(id);
        return (
          <span key={id} className="rounded bg-sky-50 px-1.5 py-0.5 text-2xs text-sky-700 dark:bg-sky-900/30 dark:text-sky-400">
            {f ? `${f.objectType}${f.period ? ` — ${f.period}` : ''}` : '(find removed)'}
          </span>
        );
      })}
    </div>
  );
}

// ─── Question row ───────────────────────────────────────────────────────────

interface QuestionRowProps {
  q: OutstandingQuestion;
  permission: Permission;
  permissionFinds: Find[];
  tracks: Track[];
  successor?: OutstandingQuestion;
  onDismissChange?: () => void;
}

function QuestionRow({ q, permission, permissionFinds, tracks, successor, onDismissChange }: QuestionRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const navigate = useNavigate();

  const notes = useLiveQuery(
    () => db.questionNotes.where('questionId').equals(q.id).toArray(),
    [q.id],
  );
  const renderedNotes = notes ?? [];
  const progress = fieldworkProgress(q, renderedNotes);
  const direction = interpretationDirection(q, renderedNotes);
  const copy = interpretationCopyFor(hypothesisFor(q), progress, direction);
  const timeline = useMemo(
    () => buildInvestigationTimeline(q, renderedNotes, permissionFinds),
    [q, renderedNotes, permissionFinds],
  );
  const sections = useMemo(() => calculateInvestigationSections({
      contextGeometry: q.contextGeometry,
      boundary: permission.boundary,
      bufferM: q.metrics?.bufferM ?? 250,
      tracks,
      finds: permissionFinds,
    }),
    [q.contextGeometry, q.metrics?.bufferM, permission.boundary, tracks, permissionFinds],
  );

  const openInFieldGuide = () => {
    const params = new URLSearchParams({
      lat: q.anchor.lat.toFixed(6),
      lng: q.anchor.lon.toFixed(6),
    });
    navigate(`/fieldguide?${params.toString()}`);
  };

  const dismiss = async () => {
    await setQuestionDismissed(q.id, true);
    onDismissChange?.();
  };

  const reopen = async () => {
    await setQuestionDismissed(q.id, false);
    onDismissChange?.();
  };

  const showSuccessor = () => {
    if (!successor) return;
    document.getElementById(`investigation-${successor.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div id={`investigation-${q.id}`} className="overflow-hidden rounded-xl border border-sky-100 bg-white/80 shadow-sm transition-shadow hover:shadow-md dark:border-sky-900/50 dark:bg-gray-900/55">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full px-3.5 py-3 text-left transition-colors hover:bg-sky-50/60 dark:hover:bg-sky-950/20"
      >
        <div className="flex items-center gap-2.5">
          <p className="min-w-0 flex-1 text-sm font-bold leading-snug text-gray-900 dark:text-gray-100">{copy.short}</p>
          <ChevronDownIcon className={`mt-1 h-4 w-4 shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
        <p className="mt-1 text-xs leading-snug text-gray-500 dark:text-gray-400">{q.title}</p>
        <div className="mt-1.5">
          <InvestigationAxes q={q} notes={renderedNotes} />
        </div>
      </button>

      {expanded && (
        <div className="mx-3.5 space-y-2.5 border-t border-gray-200 pb-3 pt-2.5 dark:border-gray-700/50">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-300">{q.description}</p>
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
            {q.status === 'RESOLVED' && (
              <div className="text-right text-xs text-gray-500">
                <span>{q.resolvedReason ? RESOLVED_REASON_LABEL[q.resolvedReason] ?? 'Resolved' : 'Resolved'}</span>
                {successor && (
                  <button type="button" onClick={showSuccessor} className="ml-1 font-bold text-sky-600 hover:text-sky-700 dark:text-sky-400">
                    View successor
                  </button>
                )}
              </div>
            )}
          </div>

          <SectionalStats sections={sections} />
          <InvestigationTimeline events={timeline} />

          <div className="rounded-lg border border-sky-100 bg-sky-50/60 px-3 py-2.5 dark:border-sky-900/60 dark:bg-sky-950/20">
            <p className="text-2xs font-black uppercase tracking-widest text-sky-600 dark:text-sky-400">Current interpretation</p>
            <p className="mt-1 text-xs leading-relaxed text-gray-700 dark:text-gray-200">{copy.full}</p>
          </div>

          {/* Note composer toggle + composer (B3) */}
          {q.status !== 'RESOLVED' && (
            showComposer ? (
              <NoteComposer questionId={q.id} permissionId={q.permissionId} onSaved={() => setShowComposer(false)} />
            ) : (
              <button
                type="button"
                onClick={() => setShowComposer(true)}
                className="text-xs font-bold text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300 transition-colors"
              >
                + Add note
              </button>
            )
          )}

          <div className="flex items-center gap-3">
            {q.status !== 'RESOLVED' && q.locationActionAllowed !== false && (
              <button
                type="button"
                onClick={openInFieldGuide}
                className="text-xs font-bold text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors"
              >
                View location in FieldGuide
              </button>
            )}
            {/* Dismiss / Reopen (B5) */}
            {q.status !== 'RESOLVED' && (
              q.dismissedByUser ? (
                <button type="button" onClick={reopen} className="ml-auto text-xs font-bold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
                  Reopen
                </button>
              ) : (
                <button type="button" onClick={dismiss} className="ml-auto text-xs font-bold text-gray-400 hover:text-gray-600 dark:hover:text-gray-500 dark:hover:text-gray-300 transition-colors">
                  Hide
                </button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main card ──────────────────────────────────────────────────────────────

export function OutstandingQuestionsCard({ permissionId }: { permissionId: string }) {
  const [showResolved, setShowResolved] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const navigate = useNavigate();

  const questions = useLiveQuery(
    () => db.outstandingQuestions.where("permissionId").equals(permissionId).toArray(),
    [permissionId],
  );
  const permission = useLiveQuery(() => db.permissions.get(permissionId), [permissionId]);
  const fieldContext = useLiveQuery(async () => {
    const sessions = await db.sessions.where('permissionId').equals(permissionId).toArray();
    const sessionIds = sessions.map(session => session.id);
    const tracks = sessionIds.length > 0
      ? await db.tracks.where('sessionId').anyOf(sessionIds).toArray()
      : [];
    const finds = await db.finds.where('permissionId').equals(permissionId).toArray();
    return { tracks, finds };
  }, [permissionId]);

  if (!questions || !permission) return null;

  const tracks = fieldContext?.tracks ?? [];
  const permissionFinds = fieldContext?.finds ?? [];
  const questionById = new Map(questions.map(question => [question.id, question]));
  const row = (q: OutstandingQuestion, onDismissChange?: () => void) => {
    const terminalId = q.supersededByIds?.[0]
      ? terminalSupersedingQuestionId(q.supersededByIds[0], questionById)
      : undefined;
    return (
      <QuestionRow
        key={q.id}
        q={q}
        permission={permission}
        permissionFinds={permissionFinds}
        tracks={tracks}
        successor={terminalId ? questionById.get(terminalId) : undefined}
        onDismissChange={onDismissChange}
      />
    );
  };

  // Resolved trumps hidden for display (AC-B4)
  const resolved = questions.filter(q => q.status === 'RESOLVED');
  const active = questions
    .filter(q => q.status !== 'RESOLVED' && !q.dismissedByUser)
    .sort((a, b) =>
      investigationPriority(b.confidence, b.priorityState?.scansSinceEvidenceChange ?? 0) -
      investigationPriority(a.confidence, a.priorityState?.scansSinceEvidenceChange ?? 0) ||
      a.createdAt - b.createdAt
    );
  const hidden = questions.filter(q => q.status !== 'RESOLVED' && q.dismissedByUser === true);
  // Separate deferred from genuinely resolved
  const deferred = resolved.filter(q => q.resolvedReason === 'cap_evicted');
  const genuinelyResolved = resolved.filter(q => q.resolvedReason !== 'cap_evicted');
  const attentionInvestigations = active.slice(0, ATTENTION_CAP);
  const otherOpenInvestigations = active.slice(ATTENTION_CAP);

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

      <header className="relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 border-b border-sky-100/80 px-4 py-4 dark:border-sky-900/50 sm:px-5">
        <div className="grid h-8 w-8 place-items-center text-teal-600 dark:text-teal-400">
          <svg className="h-6 w-6" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <path d="M5 20.5c3.5-7 6.5 1 10-6.5s5.5-2 8-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="5" cy="20.5" r="2.25" fill="currentColor" />
            <circle cx="15" cy="14" r="2.25" fill="currentColor" />
            <circle cx="23" cy="7" r="2.25" fill="currentColor" />
          </svg>
        </div>
        <h3 className="min-w-0 text-base font-black tracking-tight text-gray-900 dark:text-white sm:text-lg">Landscape investigations</h3>
        <div className="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-2xs font-black text-sky-700 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300">
          {active.length} open
        </div>
        <p className="col-start-2 col-end-4 text-2xs leading-relaxed text-gray-500 dark:text-gray-400">
          Follow how scan evidence changes with recorded fieldwork.
        </p>
      </header>

      {permission.boundary && <ProtectionBanner protection={permission.protectionStatus} />}

      <PermissionPulseCard permissionId={permissionId} embedded />

      <div className="relative p-4 sm:p-5">
        <div className="mb-2.5 flex items-end justify-between gap-3">
          <div>
            <p className="text-2xs font-black uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Review investigations</p>
            {evaluatedLabel && <p className="mt-0.5 text-2xs text-gray-400">Last evaluated {evaluatedLabel}</p>}
          </div>
        </div>

        <div className="grid gap-2.5 md:grid-cols-2">
        {hasNoHistory && (
          <div className="rounded-xl border border-dashed border-sky-200 bg-white/60 p-3 dark:border-sky-800/70 dark:bg-gray-950/20 md:col-span-2">
            <p className="text-sm font-black text-gray-800 dark:text-gray-100">
              {permission.questionsEvaluatedAt ? "No open investigations right now" : "Ready for its first review"}
            </p>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              {permission.questionsEvaluatedAt
                ? EMPTY_SCANNED
                : hasBoundary
                  ? "A focused scan checks the permission for landscape signals, quiet areas and routes that may need more evidence."
                  : "Add a mapped permission boundary first. Investigations are generated from FieldGuide scans inside that boundary."}
            </p>
          </div>
        )}

        {!hasNoHistory && isEmpty && (
          <p className="text-sm text-gray-500 leading-relaxed italic md:col-span-2">
            {EMPTY_SCANNED}
          </p>
        )}

        {attentionInvestigations.map(q => row(q))}

        {otherOpenInvestigations.length > 0 && (
          <details className="mt-2 md:col-span-2">
            <summary className="cursor-pointer text-xs font-bold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
              Other open investigations ({otherOpenInvestigations.length})
            </summary>
            <div className="mt-2 grid gap-2.5 md:grid-cols-2">
              {otherOpenInvestigations.map(q => row(q))}
            </div>
          </details>
        )}

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
          .map(q => row(q))}

        {/* Hidden by user section (B5) */}
        {hidden.length > 0 && (
          <button
            onClick={() => setShowHidden(!showHidden)}
            aria-expanded={showHidden}
            className="mt-2 text-xs font-bold text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300 md:col-span-2"
          >
            Hidden by you ({hidden.length})
          </button>
        )}
        {showHidden && hidden
          .sort((a, b) =>
            investigationPriority(b.confidence, b.priorityState?.scansSinceEvidenceChange ?? 0) -
            investigationPriority(a.confidence, a.priorityState?.scansSinceEvidenceChange ?? 0) ||
            a.createdAt - b.createdAt
          )
          .map(q => row(q, () => {}))}
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
