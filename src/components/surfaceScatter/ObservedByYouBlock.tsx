import React, { useState } from 'react';
import {
    db,
    type SurfaceAbundance,
    type SurfaceMaterial,
    type SurfacePeriod,
} from '../../db';
import {
    completeSurfaceCapture,
    finishSurfaceCapture,
    recentSurfacePeriods,
    recordSurfaceObservation,
    SURFACE_ABUNDANCE_LABELS,
    SURFACE_MATERIAL_LABELS,
    SURFACE_CAPTURE_PERIODS,
    SURFACE_PERIOD_LABELS,
    type EffectiveScatter,
    type ScatterPoint,
} from '../../services/surfaceScatter';
import { addSurfaceObservationPhoto } from '../../services/surfaceScatterMedia';
import Modal from '../Modal';
import { LocationPickerModal } from '../LocationPickerModal';
import {
    contextDraftFrom,
    contextInputFrom,
    SurfaceContextFields,
    type SurfaceContextDraft,
} from './SurfaceObservationDetails';
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
    allowMapLocation?: boolean;
    mapLocationStart?: ScatterPoint | null;
    mapBoundary?: import('../../db').GeoJSONPolygon;
    previousMapLocation?: ScatterPoint | null;
    onMapLocationSelected?: (point: ScatterPoint) => void;
    label?: string;
    onRecorded?: (observationId: string) => void;
};

export function RecordSurfaceFindButton({
    projectId,
    permissionId,
    sessionId = null,
    getLocation,
    compact = false,
    icon = false,
    allowMapLocation = false,
    mapLocationStart = null,
    mapBoundary,
    previousMapLocation = null,
    onMapLocationSelected,
    label,
    onRecorded,
}: RecordSurfaceFindButtonProps) {
    const [open, setOpen] = useState(false);
    const [material, setMaterial] = useState<SurfaceMaterial | null>(null);
    const [abundance, setAbundance] = useState<SurfaceAbundance | null>(null);
    const [selectedPeriod, setSelectedPeriod] = useState<SurfacePeriod | null>(null);
    const [saving, setSaving] = useState(false);
    const [savedObservationId, setSavedObservationId] = useState<string | null>(null);
    const [showDetails, setShowDetails] = useState(false);
    const [context, setContext] = useState<SurfaceContextDraft>(() => contextDraftFrom());
    const [materialConfidence, setMaterialConfidence] = useState<'fairly_sure' | 'confident'>('fairly_sure');
    const [periodSuggestions, setPeriodSuggestions] = useState<Array<Exclude<SurfacePeriod, 'unknown'>>>([]);
    const [showAllPeriods, setShowAllPeriods] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [locationMode, setLocationMode] = useState<'gps' | 'map'>('gps');
    const [mapLocation, setMapLocation] = useState<ScatterPoint | null>(null);
    const [showLocationPicker, setShowLocationPicker] = useState(false);

    const resetAndClose = () => {
        setOpen(false);
        setMaterial(null);
        setAbundance(null);
        setSelectedPeriod(null);
        setSavedObservationId(null);
        setShowAllPeriods(false);
        setShowDetails(false);
        setContext(contextDraftFrom());
        setMaterialConfidence('fairly_sure');
        setLocationMode('gps');
        setMapLocation(null);
        setShowLocationPicker(false);
    };
    const close = () => {
        if (saving) return;
        if (savedObservationId) void finishSurfaceCapture(savedObservationId);
        resetAndClose();
    };

    const begin = () => {
        setMaterial(null);
        setAbundance(null);
        setSelectedPeriod(null);
        setSavedObservationId(null);
        setShowAllPeriods(false);
        setShowDetails(false);
        setContext(contextDraftFrom());
        setMaterialConfidence('fairly_sure');
        setLocationMode('gps');
        setMapLocation(null);
        setShowLocationPicker(false);
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

    const saveCapture = async () => {
        if (!material || !abundance || !selectedPeriod || saving) return;
        setSaving(true);
        setMessage(null);
        try {
            if (!permissionId) throw new Error('Move into a mapped permission before recording a surface find.');
            const location = locationMode === 'map' ? mapLocation : await getLocation();
            if (!location) throw new Error('Choose the surface find location on the map before saving.');
            const observation = await recordSurfaceObservation({
                projectId,
                permissionId,
                sessionId,
                material,
                abundance,
                periodImpression: selectedPeriod,
                point: { lat: location.lat, lon: location.lon },
                gpsAccuracyM: locationMode === 'gps'
                    ? (location as SurfaceCaptureLocation).accuracyM ?? null
                    : null,
            });

            // The required material, abundance and period are durable together.
            setSavedObservationId(observation.id);
            onRecorded?.(observation.id);
        } catch (cause) {
            setMessage(cause instanceof Error ? cause.message : 'Could not record this surface find.');
        } finally {
            setSaving(false);
        }
    };

    const saveDetails = async () => {
        if (!savedObservationId || saving) return;
        setSaving(true);
        setMessage(null);
        try {
            await completeSurfaceCapture(savedObservationId, {
                ...contextInputFrom(context),
                materialConfidence,
            });
            resetAndClose();
        } catch (cause) {
            setMessage(cause instanceof Error ? cause.message : 'The observation is saved, but details could not be added.');
        } finally {
            setSaving(false);
        }
    };

    const finishCapture = async () => {
        if (!savedObservationId || saving) return;
        setSaving(true);
        setMessage(null);
        try {
            await finishSurfaceCapture(savedObservationId);
            resetAndClose();
        } catch (cause) {
            setMessage(cause instanceof Error ? cause.message : 'The observation is saved, but capture could not be completed.');
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
                ) : (label ?? 'Record surface find')}
            </button>
            {message && !open && (
                <p role="status" className="mt-1 text-2xs font-bold text-amber-500">{message}</p>
            )}
            {open && !showLocationPicker && (
                <Modal title="Record surface find" onClose={close}>
                    <div
                        data-testid="surface-capture-sheet"
                        className="mx-auto w-full max-w-xl space-y-4"
                    >
                        <div className={`rounded-xl border px-3 py-2.5 ${savedObservationId ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30' : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/60'}`}>
                            <p className={`text-xs font-black ${savedObservationId ? 'text-emerald-800 dark:text-emerald-300' : 'text-gray-700 dark:text-gray-200'}`}>
                                {savedObservationId ? 'Saved to this device' : 'Record what you found'}
                            </p>
                            <p className="mt-0.5 text-2xs font-bold text-gray-500 dark:text-gray-400">
                                {savedObservationId ? 'Continue detecting now, or add optional context.' : 'Choose material, abundance and period, then save.'}
                            </p>
                        </div>

                        {!savedObservationId && <div>
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
                        </div>}

                        {!savedObservationId && <div>
                            <p className="mb-2 text-3xs font-black uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">2 · Abundance</p>
                            <div className="grid grid-cols-4 gap-2">
                                {ABUNDANCES.map(value => (
                                    <button
                                        key={value}
                                        type="button"
                                        disabled={!material || !!savedObservationId || saving}
                                        onClick={() => setAbundance(value)}
                                        className={`min-h-12 rounded-xl border px-1.5 py-2 text-2xs font-black disabled:opacity-40 ${abundance === value ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/35 dark:text-emerald-300' : 'border-gray-200 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200'}`}
                                    >
                                        {SURFACE_ABUNDANCE_LABELS[value]}
                                    </button>
                                ))}
                            </div>
                        </div>}

                        {!savedObservationId && <div>
                            <p className="mb-1 text-3xs font-black uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">3 · Period / age</p>
                            <p className="mb-2 text-2xs font-bold text-gray-500 dark:text-gray-400">Your best impression is useful. Choose Not sure if it cannot be identified.</p>
                            <div className="flex flex-wrap gap-2">
                                {(showAllPeriods ? ALL_PERIODS : periodSuggestions).map(period => (
                                    <button
                                        key={period}
                                        type="button"
                                        disabled={!abundance || saving}
                                        onClick={() => setSelectedPeriod(period)}
                                        className={`min-h-11 rounded-xl border px-3 py-2 text-xs font-black disabled:opacity-40 ${selectedPeriod === period ? 'border-emerald-500 bg-emerald-600 text-white' : 'border-gray-300 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200'}`}
                                    >
                                        {SURFACE_PERIOD_LABELS[period]}
                                    </button>
                                ))}
                                {!showAllPeriods && (
                                    <button type="button" disabled={!abundance || saving} onClick={() => setShowAllPeriods(true)} className="min-h-11 rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs font-black text-gray-500 disabled:opacity-40 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300">
                                        More…
                                    </button>
                                )}
                                <button
                                    type="button"
                                    disabled={!abundance || saving}
                                    onClick={() => setSelectedPeriod('unknown')}
                                    className={`min-h-11 rounded-xl border px-3 py-2 text-xs font-black disabled:opacity-40 ${selectedPeriod === 'unknown' ? 'border-emerald-500 bg-emerald-600 text-white' : 'border-gray-300 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200'}`}
                                >
                                    Not sure
                                </button>
                            </div>
                        </div>}

                        {!savedObservationId && (
                            allowMapLocation && <div>
                                <p className="mb-2 text-3xs font-black uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">4 · Location</p>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        disabled={saving}
                                        onClick={() => { setLocationMode('gps'); setMapLocation(null); }}
                                        className={`min-h-12 rounded-xl border px-3 py-2 text-xs font-black ${locationMode === 'gps' ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/35 dark:text-emerald-300' : 'border-gray-300 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200'}`}
                                    >
                                        Use my current location
                                    </button>
                                    <button
                                        type="button"
                                        disabled={saving}
                                        onClick={() => { setLocationMode('map'); setShowLocationPicker(true); }}
                                        className={`min-h-12 rounded-xl border px-3 py-2 text-xs font-black ${locationMode === 'map' ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/35 dark:text-emerald-300' : 'border-gray-300 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200'}`}
                                    >
                                        {mapLocation ? 'Change map location' : 'Choose on map'}
                                    </button>
                                </div>
                                <p className="mt-1.5 text-2xs font-bold text-gray-500 dark:text-gray-400">
                                    {locationMode === 'map' && mapLocation
                                        ? `Map point selected · ${mapLocation.lat.toFixed(5)}, ${mapLocation.lon.toFixed(5)}`
                                        : locationMode === 'map'
                                            ? 'Choose a point before saving.'
                                            : 'GPS will be requested only when you press Save.'}
                                </p>
                            </div>
                        )}

                        {!savedObservationId && (
                            <button
                                type="button"
                                disabled={!material || !abundance || !selectedPeriod || saving || (locationMode === 'map' && !mapLocation)}
                                onClick={() => void saveCapture()}
                                className="min-h-12 w-full rounded-xl bg-emerald-600 px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                {saving ? 'Saving location…' : 'Save surface find'}
                            </button>
                        )}

                        {savedObservationId && !showDetails && <div className="grid gap-2">
                            <button type="button" disabled={saving} onClick={() => void finishCapture()} className="min-h-12 w-full rounded-xl bg-emerald-600 text-xs font-black text-white">Done</button>
                            <button type="button" onClick={() => setShowDetails(true)} className="min-h-12 w-full rounded-xl border border-gray-300 bg-white text-xs font-black dark:border-gray-600 dark:bg-gray-900">Add more details</button>
                            <label className="min-h-12 w-full cursor-pointer rounded-xl border border-gray-300 bg-white px-3 py-3 text-center text-xs font-black dark:border-gray-600 dark:bg-gray-900">Add photo<input type="file" accept="image/*" capture="environment" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) void addSurfaceObservationPhoto(savedObservationId, file).then(() => setMessage('Photo saved locally.')).catch(cause => setMessage(cause instanceof Error ? cause.message : 'Could not add photo.')); event.currentTarget.value = ''; }} /></label>
                        </div>}

                        {savedObservationId && showDetails && <div className="space-y-4">
                          <SurfaceContextFields value={context} onChange={setContext} />
                          <label className="grid gap-1 text-xs font-black text-gray-600 dark:text-gray-300">Identification confidence
                            <select value={materialConfidence} onChange={event => setMaterialConfidence(event.target.value as 'fairly_sure' | 'confident')} className="min-h-12 rounded-xl border border-gray-300 bg-white px-3 dark:border-gray-600 dark:bg-gray-900"><option value="fairly_sure">Fairly sure</option><option value="confident">Confident</option></select>
                          </label>
                        <div className="flex gap-2"><button type="button" disabled={saving} onClick={() => void saveDetails()} className="min-h-12 flex-1 rounded-xl bg-emerald-600 text-xs font-black text-white">Save details</button><button type="button" onClick={() => setShowDetails(false)} className="min-h-12 rounded-xl border px-4 text-xs font-black">Back</button></div>
                        </div>}

                        {message && <p role="alert" className="text-2xs font-bold text-amber-700 dark:text-amber-300">{message}</p>}
                    </div>
                </Modal>
            )}
            {open && showLocationPicker && (
                <LocationPickerModal
                    title="Choose surface-find location"
                    initialLat={(mapLocation ?? previousMapLocation ?? mapLocationStart)?.lat}
                    initialLon={(mapLocation ?? previousMapLocation ?? mapLocationStart)?.lon}
                    boundary={mapBoundary}
                    onClose={() => {
                        setShowLocationPicker(false);
                        if (!mapLocation) setLocationMode('gps');
                    }}
                    onSelect={(lat, lon) => {
                        const point = { lat, lon };
                        setMapLocation(point);
                        onMapLocationSelected?.(point);
                        setLocationMode('map');
                        setShowLocationPicker(false);
                    }}
                />
            )}
        </>
    );
}

export function ObservedByYouBlock({
    scatter,
    recordButton,
    recordIconButton,
    onSelectObservation,
}: {
    scatter: EffectiveScatter;
    recordButton: React.ReactNode;
    recordIconButton: React.ReactNode;
    onSelectObservation?: (observationId: string) => void;
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
                                <button type="button" onClick={() => onSelectObservation?.(observation.source.id)} key={observation.source.id} className="block w-full py-2 text-left first:pt-0">
                                    <p className="truncate whitespace-nowrap text-2xs font-bold leading-snug text-gray-800 dark:text-gray-200">{surfaceObservationText(observation)}</p>
                                    {detail && <p className="mt-0.5 text-3xs font-bold text-gray-500 dark:text-gray-400">{detail}</p>}
                                    {distance && <p className="mt-0.5 text-3xs font-bold text-gray-400 dark:text-gray-500">{distance}</p>}
                                </button>
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
