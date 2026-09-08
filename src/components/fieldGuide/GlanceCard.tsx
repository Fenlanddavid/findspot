// ─── FieldGuide Glance Card ───────────────────────────────────────────────────
// Reasoning-first summary shown before the full ALIE interpretation.
// Safe as a standalone read — the low-interface user may never expand it.
// Honesty constraints enforced here:
//   C1: SM amber banner on overlap OR check failure (never implies clearance)
//   C2: Softened confidence labels via glanceHeadline (never bald "High")
//   C3: Hedged headline + provisional footnote
//   C4: No score-based / red-green colouring

import React, { useState, useMemo } from 'react';
import type { LandscapeInterpretation } from '../../types/landscapeInterpretation';
import { glanceHeadline, glanceReasons } from '../../services/fieldguide/glanceReading';
import { selectSalientEvidence } from '../../services/fieldguide/landscapeInterpretation/evidenceSalience';
import { composeEvidenceClause } from '../../services/fieldguide/landscapeInterpretation/evidenceSlotFormatters';
import { SMUnavailableBanner } from './SMUnavailableBanner';
import type { SMUnavailableReason } from '../../services/historicScanService';

interface Props {
    interpretation: LandscapeInterpretation;
    /** True when the NHLE service was unreachable — cannot confirm clearance. */
    scheduledMonumentCheckFailed: boolean;
    scheduledMonumentUnavailableReason?: SMUnavailableReason | null;
    /** Switch to detail for this session only (no DB write). */
    onReadFull: () => void;
    /** Persist 'detail' preference to db.settings (called when checkbox is ticked). */
    onPersistDetail: () => void;
}

export function GlanceCard({
    interpretation,
    scheduledMonumentCheckFailed,
    scheduledMonumentUnavailableReason,
    onReadFull,
    onPersistDetail,
}: Props) {
    const [dontShowAgain, setDontShowAgain] = useState(false);

    const { title, strengthLabel } = glanceHeadline(interpretation);
    const reasons = glanceReasons(interpretation.evidenceAssessment);

    const { clause, rider } = useMemo(() => {
        if (!interpretation.evidenceAssessment) return { clause: null, rider: null };
        const salient = selectSalientEvidence(interpretation.evidenceAssessment);
        return composeEvidenceClause(salient);
    }, [interpretation.evidenceAssessment]);

    const showSMOverlap = interpretation.scheduledMonumentOverlap;
    const showSMFailed  = scheduledMonumentCheckFailed && !interpretation.scheduledMonumentOverlap;
    const showCaveat    = interpretation.evidenceAssessment.contradictingPercent >= 40;
    const limitedEvidence = reasons.length === 0;

    function handleReadFull() {
        if (dontShowAgain) {
            onPersistDetail();
        } else {
            onReadFull();
        }
    }

    return (
        <div className="border border-blue-500/20 bg-blue-500/5 rounded-xl p-3 space-y-3">
            <p className="text-sm font-black text-blue-200">
                Landscape read
            </p>

            {/* C1: SM overlap banner */}
            {showSMOverlap && (
                <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2">
                    <p className="text-[0.625rem] font-black text-amber-300 uppercase tracking-[0.18em]">
                        Scheduled Monument Nearby
                    </p>
                    <p className="mt-1 text-[0.625rem] font-bold text-amber-100/80 leading-snug">
                        A scheduled monument is recorded in this area. Check the official record and avoid protected ground before detecting.
                    </p>
                </div>
            )}

            {/* C1: SM check failed banner — fail-safe amber when data unavailable */}
            {showSMFailed && (
                <SMUnavailableBanner
                    reason={scheduledMonumentUnavailableReason}
                    fallbackBody="Protected monument data could not be confirmed for this area. Use official records before treating the area as clear."
                    textSize="xs"
                />
            )}

            {/* C2 + C3: Headline + softened signal strength */}
            <div className="space-y-1.5">
                <p className="text-xs font-bold text-white/65">Possible interpretation</p>
                <p className="text-sm font-black text-white leading-snug">{title}</p>
                <span className="inline-block rounded-lg border border-white/20 bg-white/8 px-2 py-1 text-xs font-black text-white/75">
                    {strengthLabel}
                </span>
            </div>

            {/* Evidence clause — specific salient evidence on the glance */}
            {clause && (
                <div><p className="mb-1 text-xs font-bold text-white/65">What was observed</p><p className="text-sm font-bold text-white/75 leading-snug">{clause}</p></div>
            )}
            {rider && (
                <p className="text-2xs font-bold text-amber-300/90 leading-snug">▲ {rider}</p>
            )}

            {/* Why? chips — up to 3 source-distinct + optional caveat */}
            {limitedEvidence ? (
                <p className="text-[0.6875rem] font-bold text-white/58 leading-snug italic">
                    Limited evidence here — scan data is sparse for this area.
                </p>
            ) : (
                <div className="space-y-1.5">
                    <p className="text-xs font-bold text-white/65">Supporting sources and quality</p>
                    <div className="flex flex-wrap gap-1.5">
                        {reasons.map(r => (
                            <span
                                key={r.source}
                                className="text-[0.625rem] font-bold px-2 py-0.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-200 leading-snug"
                            >
                                {r.label}
                            </span>
                        ))}
                        {showCaveat && (
                            <span className="text-[0.625rem] font-bold px-2 py-0.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 leading-snug">
                                Contradicting factors present
                            </span>
                        )}
                    </div>
                </div>
            )}

            <div className="space-y-1">
                <p className="text-xs font-bold text-white/65">Alternatives and limitations</p>
                <p className="text-sm font-medium text-white/65 leading-snug">{showCaveat ? 'Available evidence includes material contradictions; competing interpretations remain possible.' : 'The evidence may have natural, agricultural, industrial, or modern explanations.'}</p>
            </div>

            {/* C3: Hedge footnote */}
            <p className="text-xs font-bold text-white/60 leading-snug">
                Unvalidated heuristic ranking — indicative only, not a calibrated probability or prediction of finds.
            </p>

            {/* Read full + don't show again */}
            <div className="border-t border-white/8 pt-2.5 space-y-2.5">
                <button
                    type="button"
                    onClick={handleReadFull}
                    className="min-h-12 w-full rounded-xl border border-blue-400/35 bg-blue-500/10 px-4 text-sm font-black text-blue-200 transition-colors active:bg-blue-500/20"
                >
                    Review evidence and next action
                </button>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={dontShowAgain}
                        onChange={e => setDontShowAgain(e.target.checked)}
                        className="w-3 h-3 rounded border-white/20 bg-white/5 accent-blue-400"
                    />
                    <span className="text-sm font-bold text-white/65 leading-none">
                        Don't show this summary again
                    </span>
                </label>
            </div>
        </div>
    );
}
