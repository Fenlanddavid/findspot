import React, { useState } from 'react';
import {
    db,
    type SurfaceAbundance,
    type SurfaceMaterial,
    type SurfacePeriod,
} from '../../db';
import {
    recentSurfacePeriods,
    recordSurfaceObservation,
    setSurfaceCapturePeriod,
    SURFACE_ABUNDANCE_LABELS,
    SURFACE_MATERIAL_LABELS,
    SURFACE_CAPTURE_PERIODS,
    SURFACE_PERIOD_LABELS,
    type EffectiveScatter,
    type ScatterPoint,
} from '../../services/surfaceScatter';
import Modal from '../Modal';
import {
    surfaceObservationDetailText,
    surfaceObservationDistanceText,
    surfaceObservationText,
} from './surfaceScatterPresentation';

// Keep this module component-only so Vite preserves state during Fast Refresh.

const CAPTURE_MATERIALS: readonly SurfaceMaterial[] = [
    'pottery', 'ceramic_building_material', 'flint', 'glass', 'slag', 'other',
];
const ABUNDANCES = Object.keys(SURFACE_ABUNDANCE_LABELS) as SurfaceAbundance[];
const ALL_PERIODS = SURFACE_CAPTURE_PERIODS;
export type SurfaceCaptureLocation = ScatterPoint & { accuracyM?: number | null };

type RecordSurfaceFindButtonProps = {
    projectId: string;
    permissionId: string | null;
    sessionId?: string | null;
    getLocation: () => Promise<SurfaceCaptureLocation>;
    compact?: boolean;
    icon?: boolean;
};

export function RecordSurfaceFindButton({
    projectId,
    permissionId,
    sessionId = null,
    getLocation,
    compact = false,
    icon = false,
}: RecordSurfaceFindButtonProps) {
    const [open, setOpen] = useState(false);
    const [material, setMaterial] = useState<SurfaceMaterial | null>(null);
    const [abundance, setAbundance] = useState<SurfaceAbundance | null>(null);
    const [selectedPeriod, setSelectedPeriod] = useState<Exclude<SurfacePeriod, 'unknown'> | null>(null);
    const [saving, setSaving] = useState(false);
    const [savedObservationId, setSavedObservationId] = useState<string | null>(null);
    const [periodSuggestions, setPeriodSuggestions] = useState<Array<Exclude<SurfacePeriod, 'unknown'>>>([]);
    const [showAllPeriods, setShowAllPeriods] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const resetAndClose = () => {
        setOpen(false);
        setMaterial(null);
        setAbundance(null);
        setSelectedPeriod(null);
        setSavedObservationId(null);
        setShowAllPeriods(false);
    };
    const close = () => {
        if (saving) return;
        resetAndClose();
    };

    const begin = () => {
        setMaterial(null);
        setAbundance(null);
        setSelectedPeriod(null);
        setSavedObservationId(null);
        setShowAllPeriods(false);
        setMessage(null);
        if (permissionId) {
            setPeriodSuggestions(recentSurfacePeriods([], permissionId));
            void db.surfaceObservations.where('permissionId').equals(permissionId).toArray()
                .then(rows => setPeriodSuggestions(recentSurfacePeriods(rows, permissionId)))
                .catch(() => undefined);
        } else {
            setPeriodSuggestions(recentSurfacePeriods([], ''));
        }
        setOpen(true);
    };

    const chooseAbundance = async (abundance: SurfaceAbundance) => {
        if (!material || saving) return;
        setAbundance(abundance);
        setSaving(true);
        setMessage(null);
        try {
            if (!permissionId) throw new Error('Move into a mapped permission before recording a surface find.');
            const location = await getLocation();
            const observation = await recordSurfaceObservation({
                projectId,
                permissionId,
                sessionId,
                material,
                abundance,
                point: { lat: location.lat, lon: location.lon },
                gpsAccuracyM: location.accuracyM ?? null,
            });

            // The durable write is complete before the optional enrichment UI.
            setSavedObservationId(observation.id);
            if (selectedPeriod) {
                await setSurfaceCapturePeriod(observation.id, selectedPeriod);
                resetAndClose();
            }
        } catch (cause) {
            setMessage(cause instanceof Error ? cause.message : 'Could not record this surface find.');
        } finally {
            setSaving(false);
        }
    };

    const choosePeriod = async (period: Exclude<SurfacePeriod, 'unknown'>) => {
        if (saving) return;
        setSelectedPeriod(period);
        if (!savedObservationId) return;
        setSaving(true);
        try {
            await setSurfaceCapturePeriod(savedObservationId, period);
            resetAndClose();
        } catch (cause) {
            setMessage(cause instanceof Error ? cause.message : 'The find is saved, but its period could not be added.');
        } finally {
            setSaving(false);
        }
    };

    const buttonClass = icon
        ? 'grid min-h-12 min-w-12 place-items-center rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800'
        : compact
            ? 'min-h-12 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs font-black text-gray-700 shadow-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200'
            : 'min-h-12 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-xs font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800';

    return (
        <>
            <button
                type="button"
                onClick={begin}
                aria-label={icon ? 'Record another surface find' : undefined}
                className={buttonClass}
            >
                {icon ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                        <path d="M12 5v14M5 12h14" />
                    </svg>
                ) : 'Record surface find'}
            </button>
            {message && !open && (
                <p role="status" className="mt-1 text-2xs font-bold text-amber-500">{message}</p>
            )}
            {open && (
                <Modal title="Record surface find" onClose={close}>
                    <div
                        data-testid="surface-capture-sheet"
                        className="mx-auto w-full max-w-xl space-y-4"
                    >
                        <div className={`rounded-xl border px-3 py-2.5 ${savedObservationId ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30' : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/60'}`}>
                            <p className={`text-xs font-black ${savedObservationId ? 'text-emerald-800 dark:text-emerald-300' : 'text-gray-700 dark:text-gray-200'}`}>
                                {savedObservationId ? 'Saved to this device' : 'Choose material and abundance to save'}
                            </p>
                            <p className="mt-0.5 text-2xs font-bold text-gray-500 dark:text-gray-400">
                                Period is optional and can be selected before or after saving.
                            </p>
                        </div>

                        <div>
                            <p className="mb-2 text-3xs font-black uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">1 · Material</p>
                            <div className="grid grid-cols-3 gap-2">
                                {CAPTURE_MATERIALS.map(value => (
                                    <button
                                        key={value}
                                        type="button"
                                        disabled={!!savedObservationId || saving}
                                        onClick={() => setMaterial(value)}
                                        className={`min-h-12 rounded-xl border px-2 py-2 text-xs font-black leading-tight disabled:opacity-55 ${material === value ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/35 dark:text-emerald-300' : 'border-gray-200 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200'}`}
                                    >
                                        {value === 'ceramic_building_material' ? 'CBM' : SURFACE_MATERIAL_LABELS[value]}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <p className="mb-2 text-3xs font-black uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">2 · Abundance</p>
                            <div className="grid grid-cols-4 gap-2">
                                {ABUNDANCES.map(value => (
                                    <button
                                        key={value}
                                        type="button"
                                        disabled={!material || !!savedObservationId || saving}
                                        onClick={() => void chooseAbundance(value)}
                                        className={`min-h-12 rounded-xl border px-1.5 py-2 text-2xs font-black disabled:opacity-40 ${abundance === value ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/35 dark:text-emerald-300' : 'border-gray-200 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200'}`}
                                    >
                                        {SURFACE_ABUNDANCE_LABELS[value]}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/60">
                            <div className="mb-2">
                                <p className="text-3xs font-black uppercase tracking-[0.18em] text-gray-600 dark:text-gray-300">Period / age (optional)</p>
                                <p className="mt-0.5 text-2xs font-bold text-gray-500 dark:text-gray-400">Your impression; confidence can be adjusted in review.</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {(showAllPeriods ? ALL_PERIODS : periodSuggestions).map(period => (
                                    <button
                                        key={period}
                                        type="button"
                                        disabled={saving}
                                        onClick={() => void choosePeriod(period)}
                                        className={`min-h-12 rounded-xl border px-3 py-2 text-xs font-black disabled:opacity-45 ${selectedPeriod === period ? 'border-emerald-500 bg-emerald-600 text-white' : 'border-gray-300 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200'}`}
                                    >
                                        {SURFACE_PERIOD_LABELS[period]}
                                    </button>
                                ))}
                                {!showAllPeriods && (
                                    <button type="button" onClick={() => setShowAllPeriods(true)} className="min-h-12 rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs font-black text-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300">
                                        More…
                                    </button>
                                )}
                            </div>
                        </div>

                        {savedObservationId && (
                            <button type="button" onClick={close} className="min-h-12 w-full rounded-xl border border-gray-300 bg-white text-xs font-black text-gray-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300">
                                Done without period
                            </button>
                        )}
                        {message && <p role="alert" className="text-2xs font-bold text-amber-700 dark:text-amber-300">{message}</p>}
                    </div>
                </Modal>
            )}
        </>
    );
}

export function ObservedByYouBlock({
    scatter,
    recordButton,
    recordIconButton,
}: {
    scatter: EffectiveScatter;
    recordButton: React.ReactNode;
    recordIconButton: React.ReactNode;
}) {
    const [open, setOpen] = useState(false);
    if (scatter.count === 0) return <div>{recordButton}</div>;

    return (
        <div className="rounded-xl border border-sky-200 bg-white/75 dark:border-sky-800/70 dark:bg-gray-950/25">
            <div className="flex min-h-12 items-center gap-2 px-3 py-1.5">
                <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpen(value => !value)}
                    className="flex min-h-12 flex-1 items-center justify-between gap-3 text-left"
                >
                    <span className="text-xs font-black text-gray-800 dark:text-gray-100">Your observations ({scatter.count})</span>
                    <span className="text-base font-black text-gray-400" aria-hidden="true">{open ? '⌃' : '⌄'}</span>
                </button>
                {!open && recordIconButton}
            </div>
            {open && (
                <div className="border-t border-sky-100 px-3 pb-3 pt-2.5 dark:border-sky-900/60">
                    <p className="text-3xs font-black uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Observed by you</p>
                    <div className="mt-2 divide-y divide-gray-100 dark:divide-gray-800">
                        {scatter.observations.map(observation => {
                            const detail = surfaceObservationDetailText(observation);
                            const distance = surfaceObservationDistanceText(observation);
                            return (
                                <div key={observation.source.id} className="py-2 first:pt-0">
                                    <p className="truncate whitespace-nowrap text-2xs font-bold leading-snug text-gray-800 dark:text-gray-200">{surfaceObservationText(observation)}</p>
                                    {detail && <p className="mt-0.5 text-3xs font-bold text-gray-500 dark:text-gray-400">{detail}</p>}
                                    {distance && <p className="mt-0.5 text-3xs font-bold text-gray-400 dark:text-gray-500">{distance}</p>}
                                </div>
                            );
                        })}
                    </div>
                    {scatter.combination && (
                        <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50/70 px-2.5 py-2 dark:border-sky-800/60 dark:bg-sky-950/25">
                            <p className="text-2xs font-black text-gray-800 dark:text-gray-100">{scatter.combination.title}</p>
                            <p className="mt-1 text-3xs font-bold leading-snug text-gray-500 dark:text-gray-400">{scatter.combination.explanation}</p>
                        </div>
                    )}
                    <div className="mt-3">{recordButton}</div>
                    <p className="mt-2 text-3xs font-bold leading-snug text-gray-400 dark:text-gray-500">
                        Your observations are separate from the landscape model and do not alter scores, confidence, targets or ordering.
                    </p>
                </div>
            )}
        </div>
    );
}
