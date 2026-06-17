// ─── Landscape Behaviour Bars ─────────────────────────────────────────────────
// Shows the six primary process scores as labelled thin bars.
// Rendered inside a collapsed expander — not above the fold.

import React from 'react';
import type { PrimaryProcessScore, PrimaryProcessId } from '../../types/landscapeInterpretation';

interface Props {
    processScores: PrimaryProcessScore[];
}

const PROCESS_LABELS: Record<PrimaryProcessId, string> = {
    occupation_potential:   'Occupation',
    movement:               'Movement',
    resource_exploitation:  'Resources',
    water_relationships:    'Water',
    landscape_prominence:   'Prominence',
    boundary_relationships: 'Boundaries',
};

const PROCESS_ORDER: PrimaryProcessId[] = [
    'occupation_potential',
    'movement',
    'resource_exploitation',
    'water_relationships',
    'landscape_prominence',
    'boundary_relationships',
];

export function LandscapeBehaviourBars({ processScores }: Props) {
    return (
        <div className="space-y-2">
            {PROCESS_ORDER.map(id => {
                const score = processScores.find(p => p.processId === id);
                const fill = (score?.finalScore ?? 0) / 100;

                return (
                    <div key={id} className="flex items-center gap-2">
                        <span className="text-[8px] font-black text-white/68 uppercase tracking-widest w-20 shrink-0">
                            {PROCESS_LABELS[id]}
                        </span>
                        <div className="flex-1 h-1.5 rounded-full bg-white/8 overflow-hidden">
                            <div
                                className="h-full rounded-full bg-blue-400/70 transition-all duration-500"
                                style={{ width: `${Math.round(fill * 100)}%` }}
                            />
                        </div>
                    </div>
                );
            })}
            <p className="text-[8px] font-bold text-white/55 leading-snug pt-1">
                Bar fill reflects relative weight of each behavioural signal. Scores are unvalidated provisional weights — treat as indicative only.
            </p>
        </div>
    );
}
