import React, { useEffect, useLayoutEffect, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Find } from '../../db';
import { ScaledImage } from '../ScaledImage';
import { CoachTip } from '../CoachTips';
import { useFieldGuideMap } from '../../hooks/useFieldGuideMap';
import { useTerrainScan, ScanContext } from '../../hooks/useTerrainScan';
import { useHistoricScan } from '../../hooks/useHistoricScan';
import { useTilePrewarm } from '../../hooks/useTilePrewarm';
import type { WorkflowState } from '../../types/significantFind';
import {
    FieldGuideContext,
    HOTSPOT_TITLES,
} from './FieldGuideContext';
import { FieldGuideMap } from './FieldGuideMap';
import { ScanLogDrawer } from './ScanLogDrawer';

import {
    Cluster, Hotspot,
} from '../../pages/fieldGuideTypes';
import { SCAN_CONFIG } from '../../utils/scanConfig';
import { LogSource, LogLevel, makeLog } from '../../utils/scanLogger';
import type { RuleId } from '../../outstandingQuestions/types';
import { reportNonFatal } from '../../services/diagLog';
import {
    DevAnnotation, AnnotationType, BroadPeriod, LandscapeType, AnnotationConfidence,
    EngineContextAtPoint, ANNOTATION_TYPE_LABELS, LANDSCAPE_TYPE_LABELS,
} from '../../utils/devAnnotation';
import { getDistance } from '../../utils/fieldGuideAnalysis';
import { runGeologyContext } from '../../engines/geologyContext';
import { sweepStaleGeologyCache } from '../../services/geologyContextCache';
import { applyGeologyModifiers } from '../../engines/hotspot/hotspotEngine';
import { getSetting } from '../../services/data';
import { searchLocations } from '../../services/geocode';
import { readFieldGuideScanCache } from '../../services/fieldGuideMutations';
import { runFieldGuideScan } from '../../services/fieldguide/scanOrchestrator';
import { persistPostScanOutcomes } from '../../services/fieldguide/postScanOrchestrator';
import {
    useFieldGuidePageState,
    type RasterOverlayKey,
} from '../../hooks/useFieldGuidePageState';
import { useFieldGuideProjectData } from '../../hooks/useFieldGuideProjectData';
import {
    buildMonumentBufferGeoJSON,
    clampOpacity,
} from '../../services/fieldguide/fieldGuidePageSupport';

const FIELDGUIDE_HELPERS_SEEN_KEY = 'fs_fg_helpers_seen';

// ─── Hotspot display helpers ──────────────────────────────────────────────────

// Potential tier: externally-visible label replacing raw numeric score.
// Keeps the internal 0–96 range intact; only the presentation changes.
function getPotentialTier(score: number): string {
    if (score > 80) return 'High Potential';
    if (score > 60) return 'Strong Potential';
    if (score > 35) return 'Moderate Potential';
    return 'Low Potential';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FieldGuideWorkspace({ projectId, onSignificantFind }: { projectId: string; onSignificantFind?: (initialContext?: Partial<WorkflowState>) => void }) {
    const navigate = useNavigate();
    const pageState = useFieldGuidePageState();
    const {
        engineState, dispatch,
        selectedId, setSelectedId, selectedHotspotId, setSelectedHotspotId,
        showSuggestion, setShowSuggestion, scanStatus, setScanStatus,
        systemLog, setSystemLog, zoomWarning, setZoomWarning,
        isSatellite, setIsSatellite, scanCount, setScanCount,
        searchQuery, setSearchQuery, isSearchOpen, setIsSearchOpen,
        isIntelOpen, setIsIntelOpen, intelDetailsOpen, setIntelDetailsOpen,
        intelLayersOpen, setIntelLayersOpen, targetPeriod, isLocating, setIsLocating,
        selectedMonument, setSelectedMonument, historicMode, setHistoricMode,
        historicScanCompleted, setHistoricScanCompleted,
        historicLayerToggles, setHistoricLayerToggles,
        historicLayerOpacity, setHistoricLayerOpacity,
        activeOpacityLayer, setActiveOpacityLayer,
        historicLayerVisibility, setHistoricLayerVisibility,
        showFields, setShowFields, showFieldsPicker, setShowFieldsPicker,
        showLayerPicker, setShowLayerPicker, helperActive, setHelperActive,
        helperTipIndex, setHelperTipIndex, fieldPickerStep, setFieldPickerStep,
        mapClickLabel, setMapClickLabel,
        expandedInterpretationId, setExpandedInterpretationId,
        expandedTargetId, setExpandedTargetId, sheetExpanded, setSheetExpanded,
        devMode, setDevMode, annotationMode, setAnnotationMode,
        devAnnotations, setDevAnnotations, pendingAnnotation, setPendingAnnotation,
        annotationForm, setAnnotationForm, focusMode, setFocusMode,
        mobileSheetMode, setMobileSheetMode, selectedTraceId, setSelectedTraceId,
        showSavedPoints, setShowSavedPoints, savingPoint, setSavingPoint,
        savedPointLabel, setSavedPointLabel, pendingDeleteId, setPendingDeleteId,
        sourceAvailability, setSourceAvailability, scanFromCache, setScanFromCache,
        scanNoSignal, setScanNoSignal,
        scheduledMonumentCheckFailed, setScheduledMonumentCheckFailed,
        scheduledMonumentUnavailableReason, setScheduledMonumentUnavailableReason,
        pasFinds, setPasFinds, selectedPASFind, setSelectedPASFind,
        selectedUserFind, setSelectedUserFind, placeSignals, setPlaceSignals,
        rawClusters, setRawClusters, geologyContext, setGeologyContext,
        geologyContextLoading, setGeologyContextLoading,
        pasDensityCell, setPasDensityCell, userGpsPos, setUserGpsPos,
        sfBannerDismissed, setSfBannerDismissed,
        traceCardRefs, sheetDragStartY, savedPointJustClickedRef,
        terrainScanCenterRef, terrainScanBoundsRef, terrainAnalysisBoundsRef,
        terrainHistoricRoutesAvailableRef, questionTerrainAvailabilityRef,
        questionScanAutoStartedRef, nhleDataRef, aimDataRef, modernWaysRef,
        geologyEnabledRef, geologyRequestSeqRef, geologyAppliedRef,
        userLocationMarkerRef, logContainerRef, sheetScrollRef,
        potentialScore, scanConfidence, setPotentialScore, setScanConfidence,
        calculatePotentialScore,
    } = pageState;
    const {
        analyzing, hotspotVersion, terrainClusters, scanPhase,
        detectedFeatures, hotspots, hasScanned,
        heritageCount, monumentPoints, historicRoutes,
    } = engineState;
    const projectData = useFieldGuideProjectData({
        projectId,
        onSignificantFind,
        state: pageState,
    });
    const {
        permissions, realPermissions, fields, projectFinds, savedPoints,
        selectedUserFindMedia, showConcentrationBanner, hotspotFindContext,
        sortedHotspots, landscapeIntelligenceMap, landscapeSummary,
        sourceUsability, targetFindContext, displayTargets, traceTargets,
        primaryTargetId,
    } = projectData;

    const clearMapItemSelections = useCallback((keep?: 'target' | 'hotspot' | 'userFind' | 'pasFind' | 'monument' | 'trace') => {
        if (keep !== 'target') setSelectedId(null);
        if (keep !== 'hotspot') setSelectedHotspotId(null);
        if (keep !== 'userFind') setSelectedUserFind(null);
        if (keep !== 'pasFind') setSelectedPASFind(null);
        if (keep !== 'monument') setSelectedMonument(undefined);
        if (keep !== 'trace') setSelectedTraceId(null);
    }, []);

    const handleRasterOverlayPress = useCallback((key: RasterOverlayKey) => {
        const enabled = historicLayerToggles[key];
        const otherOldMapKey: RasterOverlayKey | null = key === 'os1880' ? 'os1930' : key === 'os1930' ? 'os1880' : null;
        if (enabled) {
            setHistoricLayerToggles(prev => ({ ...prev, [key]: false }));
            if (activeOpacityLayer === key) setActiveOpacityLayer(null);
            setShowLayerPicker(false);
            return;
        }
        setHistoricLayerToggles(prev => ({
            ...prev,
            [key]: true,
            ...(otherOldMapKey ? { [otherOldMapKey]: false } : {}),
        }));
        setHistoricLayerOpacity(prev => ({ ...prev, [key]: 1 }));
        setActiveOpacityLayer(key);
        setShowLayerPicker(false);
    }, [activeOpacityLayer, historicLayerToggles]);

    const updateRasterOverlayOpacity = useCallback((key: RasterOverlayKey, value: number) => {
        setHistoricLayerOpacity(prev => ({ ...prev, [key]: clampOpacity(value, prev[key]) }));
    }, []);

    const persistSheetExpanded = useCallback((expanded: boolean) => {
        setSheetExpanded(expanded);
    }, [setSheetExpanded]);

    const handleSheetTouchStart = useCallback((e: React.TouchEvent) => {
        sheetDragStartY.current = e.touches[0].clientY;
    }, []);

    const handleSheetTouchEnd = useCallback((e: React.TouchEvent) => {
        if (sheetDragStartY.current === null) return;
        const delta = sheetDragStartY.current - e.changedTouches[0].clientY;
        sheetDragStartY.current = null;
        if (Math.abs(delta) < 20) return;
        persistSheetExpanded(delta > 0);
    }, [persistSheetExpanded]);

    const [searchParams, setSearchParams] = useSearchParams();
    const initLat = parseFloat(searchParams.get('lat') ?? '');
    const initLng = parseFloat(searchParams.get('lng') ?? '');
    const initPinLabel = searchParams.get('pin') === 'signal' ? 'Un-dug signal' : undefined;
    const openSavedPointsParam = searchParams.get('savedPoints') === '1';
    const questionScanRequested = searchParams.get('scan') === 'questions';
    const questionPermissionId = questionScanRequested ? searchParams.get('permissionId') ?? undefined : undefined;

    // Clear one-shot URL actions after the map/sheet uses them.
    useEffect(() => {
        const nextParams = new URLSearchParams(searchParams);
        let changed = false;

        if (!isNaN(initLat) && !isNaN(initLng)) {
            nextParams.delete('lat');
            nextParams.delete('lng');
            nextParams.delete('pin');
            changed = true;
        }

        if (openSavedPointsParam) {
            setShowSavedPoints(true);
            persistSheetExpanded(true);
            nextParams.delete('savedPoints');
            changed = true;
        }

        if (changed) setSearchParams(nextParams, { replace: true });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Load geology enabled setting and run initial DB maintenance
    useEffect(() => {
        getSetting('fs_geology_enabled', true).then(v => {
            geologyEnabledRef.current = v !== false;
        }).catch(() => {
            geologyEnabledRef.current = false;
        });
        sweepStaleGeologyCache();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Logging ─────────────────────────────────────────────────────────────

    const addLog = useCallback((msg: string, source?: LogSource, level?: LogLevel) => {
        setSystemLog(prev => [...prev, makeLog(msg, source, level)]);
    }, []);

    useLayoutEffect(() => {
        if (logContainerRef.current) logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }, [systemLog]);

    useEffect(() => {
        if (activeOpacityLayer && !historicLayerToggles[activeOpacityLayer]) setActiveOpacityLayer(null);
    }, [activeOpacityLayer, historicLayerToggles]);

    // ─── Scan hooks ───────────────────────────────────────────────────────────

    const { runTerrainScan, cancelTerrain, isTerrainScanning } = useTerrainScan({
        onLog:          addLog,
        onStatusChange: setScanStatus,
    });

    const { runHistoricScan, cancelHistoric, isHistoricScanning } = useHistoricScan({
        onLog:          addLog,
        onStatusChange: setScanStatus,
    });

    // ─── Map ─────────────────────────────────────────────────────────────────

    const { mapContainerRef, mapRef, clearMapSources } = useFieldGuideMap({
        hotspots, selectedHotspotId, detectedFeatures: displayTargets, selectedTargetId: selectedId, traceTargets, selectedTraceId, primaryTargetId, pasFinds, historicRoutes,
        fieldBoundaries: [
            ...fields.filter(f => f.boundary).map(f => ({ id: f.id, name: f.name, permissionId: f.permissionId, boundary: f.boundary })),
            // Fall back to the permission's own boundary when no fields have been drawn
            ...permissions.filter(p => p.boundary && !fields.some(f => f.permissionId === p.id)).map(p => ({ id: p.id, name: p.name, permissionId: p.id, boundary: p.boundary! })),
        ],
        isSatellite, historicMode, showFields, historicLayerVisibility, historicLayerToggles, historicLayerOpacity,
        userFinds: projectFinds,
        savedPoints, showSavedPoints,
        initLat, initLng, initPinLabel,
        devMode, annotationMode, devAnnotations,
        callbacks: {
            onFeatureClick:  (id)  => {
                clearMapItemSelections('target');
                setMobileSheetMode('targets');
                setSelectedId(id);
                persistSheetExpanded(true);
            },
            onHotspotClick:  (id)  => {
                clearMapItemSelections('hotspot');
                setMobileSheetMode('hotspots');
                setShowSuggestion(false);
                setSelectedHotspotId(id);
                persistSheetExpanded(true);
                const h = hotspots.find(h => h.id === id);
                if (h) mapRef.current?.fitBounds(h.bounds as maplibregl.LngLatBoundsLike, { padding: 40 });
            },
            onTraceTargetClick: (id) => {
                clearMapItemSelections('trace');
                setMobileSheetMode('targets');
                setSelectedTraceId(id);
                persistSheetExpanded(true);
                // Scroll card into view after state settles
                requestAnimationFrame(() => {
                    traceCardRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                });
            },
            onDeselect:      ()    => { if (savedPointJustClickedRef.current) return; setShowSuggestion(false); clearMapItemSelections(); setShowFieldsPicker(false); setFieldPickerStep('top'); persistSheetExpanded(false); },
            onDragStart:     ()    => { setShowSuggestion(false); setShowFieldsPicker(false); setFieldPickerStep('top'); persistSheetExpanded(false); },
            onZoomChange:    (z)   => setZoomWarning(z > SCAN_CONFIG.ZOOM_WARNING),
            onSetClickLabel: (l)   => setMapClickLabel(l),
            onPASFindLog:    (msg) => addLog(msg, 'historic'),
            onPASFindSelect: (f)   => { clearMapItemSelections('pasFind'); setSelectedPASFind(f); persistSheetExpanded(true); },
            onCrossingsLog:  (msg) => addLog(msg, 'historic'),
            onMonumentClick: (name) => { clearMapItemSelections('monument'); setSelectedMonument(name === null ? undefined : (name || null)); if (name !== null) persistSheetExpanded(true); },
            onUserFindClick:    (id)       => { clearMapItemSelections('userFind'); setSelectedUserFind(projectFinds.find(f => f.id === id) ?? null); persistSheetExpanded(true); },
            onSavedPointClick:  ()         => { savedPointJustClickedRef.current = true; setTimeout(() => { savedPointJustClickedRef.current = false; }, 150); setShowSavedPoints(true); persistSheetExpanded(true); },
            onAnnotationDrop:   (lat, lon) => {
                setPendingAnnotation({ lat, lon });
                setAnnotationForm({ annotationType: 'missed_hotspot', broadPeriod: 'Unknown', landscapeType: 'unknown', confidence: 'low', reviewerNote: '' });
            },
        },
    });

    useTilePrewarm(mapRef);

    const buildSuggestedLabel = (): string => {
        if (selectedHotspotId) {
            const h = hotspots.find(h => h.id === selectedHotspotId);
            if (h) return `${HOTSPOT_TITLES[h.classification]} · Hotspot ${h.number}`;
        }
        if (historicMode && historicRoutes.length > 0) {
            const named = historicRoutes.find(r => r.name && r.name.toLowerCase() !== 'null');
            return `Historic · ${named?.name ?? 'Route area'}`;
        }
        if (historicLayerToggles.lidar && hasScanned && sortedHotspots.length > 0) {
            return `LiDAR · ${getPotentialTier(sortedHotspots[0].score)}`;
        }
        if (hasScanned && sortedHotspots.length > 0) {
            return `${getPotentialTier(sortedHotspots[0].score)} area`;
        }
        return 'Saved point';
    };

    const focusTarget = useCallback((f: Cluster) => {
        clearMapItemSelections('target');
        setSelectedId(f.id);
        setMobileSheetMode('targets');
        persistSheetExpanded(true);
        mapRef.current?.flyTo({ center: f.center, zoom: 17 });
    }, [clearMapItemSelections, mapRef, persistSheetExpanded]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const timer = window.setTimeout(() => map.resize(), 320);
        map.resize();
        return () => window.clearTimeout(timer);
    }, [focusMode, sheetExpanded]); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Clear / Reset ────────────────────────────────────────────────────────

    const clearScan = useCallback(() => {
        cancelTerrain();
        cancelHistoric();
        dispatch({ type: 'CLEAR_SCAN' });
        setSelectedId(null);
        setSelectedHotspotId(null);
        setMobileSheetMode('hotspots');
        setShowSuggestion(false);
        setShowFieldsPicker(false);
        setFieldPickerStep('top');
        setScanStatus('');
        setSystemLog([makeLog('SYSTEM CLEARED. Ready for new scan.')]);
        setPasFinds([]);
        setPlaceSignals([]);
        setPotentialScore(null);
        setScanConfidence(null);
        setHistoricMode(false);
        setHistoricScanCompleted(false);
        setHistoricLayerToggles({ lidar: false, 'lidar-wales': false, os1930: false, os1880: false });
        setActiveOpacityLayer(null);
        setHistoricLayerVisibility(prev => ({ routes: true, corridors: true, crossings: true, monuments: true, aim: true, context: true, pasDensity: false, userFinds: prev.userFinds }));
        setMapClickLabel(null);
        setSelectedMonument(undefined);
        setSelectedUserFind(null);
        terrainScanCenterRef.current = null;
        terrainScanBoundsRef.current = null;
        terrainAnalysisBoundsRef.current = null;
        terrainHistoricRoutesAvailableRef.current = false;
        questionTerrainAvailabilityRef.current = {};
        nhleDataRef.current = null;
        aimDataRef.current = null;
        setSourceAvailability(null);
        setScanFromCache(false);
        setScanNoSignal(false);
        setScheduledMonumentCheckFailed(false);
        setScheduledMonumentUnavailableReason(null);
        setRawClusters([]);
        setSelectedTraceId(null);
        setAnnotationMode(false);
        setDevAnnotations([]);
        setPendingAnnotation(null);
        geologyRequestSeqRef.current++;
        setGeologyContext(null);
        setGeologyContextLoading(false);
        setPasDensityCell(null);
        clearMapSources();
    }, [cancelTerrain, cancelHistoric, clearMapSources, setPotentialScore, setScanConfidence]);

    // ─── Map source helpers ───────────────────────────────────────────────────

    const warnForVisibleMonument = (attempt = 0) => {
        const map = mapRef.current;
        if (!map || !map.getLayer('monuments-fill')) return;

        const canvas = map.getCanvas();
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        if (width <= 0 || height <= 0) return;

        const features = map.queryRenderedFeatures(
            [[0, 0], [width, height]],
            { layers: ['monuments-fill'] },
        );

        if (!features.length) {
            if (attempt < 5) window.setTimeout(() => warnForVisibleMonument(attempt + 1), 180);
            return;
        }

        const name = features[0].properties?.Name as string | undefined;
        clearMapItemSelections('monument');
        setSelectedMonument(name || null);
        persistSheetExpanded(true);
    };

    const applyNhleToMap = (data: { features: unknown[] }) => {
        // NHLEResponse only declares `features`; error fallbacks also omit `type`.
        // Always normalise to a valid FeatureCollection before calling setData,
        // otherwise MapLibre throws "Input data is not a valid GeoJSON object".
        const fc = { type: 'FeatureCollection' as const, features: data.features ?? [] };
        const update = (attempt = 0) => {
            const map = mapRef.current;
            if (!map) return;
            const src = map.getSource('monuments') as maplibregl.GeoJSONSource | undefined;
            const bufferSrc = map.getSource('monument-buffers') as maplibregl.GeoJSONSource | undefined;
            if (src && bufferSrc) {
                src.setData(fc as GeoJSON.FeatureCollection);
                bufferSrc.setData(buildMonumentBufferGeoJSON(data));
                window.setTimeout(() => warnForVisibleMonument(), 180);
                return;
            }
            if (attempt < 20) window.setTimeout(() => update(attempt + 1), 100);
        };

        update();
    };

    const applyAimToMap = (data: { features: unknown[] }) => {
        const fc = { type: 'FeatureCollection' as const, features: data.features ?? [] };
        const update = (attempt = 0) => {
            const map = mapRef.current;
            if (!map) return;
            const src = map.getSource('aim-monuments') as maplibregl.GeoJSONSource | undefined;
            if (src) {
                src.setData(fc as GeoJSON.FeatureCollection);
                return;
            }
            if (attempt < 20) window.setTimeout(() => update(attempt + 1), 100);
        };

        update();
    };

    // ─── Historic phase (shared by auto-trigger and standalone) ──────────────

    const runHistoricPhase = useCallback(async (
        context: ScanContext,
        requestedQuestionPermissionId?: string,
        questionRuleIds?: readonly RuleId[],
    ): Promise<boolean> => {
        const result = await runHistoricScan({
            mapRef,
            ...context,
            permissions,
            fields,
            targetPeriod,
        });

        if (!result) return false;

        // If fresh NHLE/AIM data was fetched (standalone mode), push to map and update refs
        // so the ALIE worker receives the actual feature data (not empty arrays).
        if (result.nhleData) { applyNhleToMap(result.nhleData); nhleDataRef.current = result.nhleData; }
        if (result.aimData)  { applyAimToMap(result.aimData);   aimDataRef.current  = result.aimData; }
        if (result.nhleData) {
            setScheduledMonumentCheckFailed(result.nhleData.available === false);
            setScheduledMonumentUnavailableReason(result.nhleData.unavailableReason ?? null);
        }

        setPasFinds(result.pasFinds);
        setPlaceSignals(result.placeSignals);
        setPasDensityCell(result.pasCell ?? null);
        calculatePotentialScore(result.pasFinds, result.monumentPoints, result.placeSignals, result.center.lat, result.center.lng);

        dispatch({ type: 'SET_HERITAGE_COUNT', count: result.heritageCount, monumentPoints: result.monumentPoints, routes: result.routes });

        if (!result.drifted && result.enhancedHotspots.length > 0) {
            setSelectedHotspotId(null);   // dismiss the terrain-phase selection; user chooses from enhanced list
            setShowSuggestion(false);
            dispatch({ type: 'HISTORIC_ENHANCE', hotspots: result.enhancedHotspots });
        }

        const questionsUpdated = await persistPostScanOutcomes({
            result,
            context,
            requestedPermissionId: requestedQuestionPermissionId,
            questionRuleIds,
            projectFinds,
            permissions,
        });
        setHistoricScanCompleted(true);
        return questionsUpdated;
    }, [runHistoricScan, permissions, fields, targetPeriod, calculatePotentialScore, projectFinds]); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Geology context phase (non-blocking) ────────────────────────────────

    const runGeologyContextPhase = useCallback(async (center: { lat: number; lng: number }) => {
        if (geologyEnabledRef.current !== true) {
            if (geologyEnabledRef.current === false) {
                addLog('Geology context disabled in settings.', 'system');
            }
            return;
        }
        const requestSeq = ++geologyRequestSeqRef.current;
        setGeologyContextLoading(true);
        setGeologyContext(null);
        try {
            const ctx = await runGeologyContext(
                { lat: center.lat, lon: center.lng },
                {
                    onAudit: (entry) => {
                        if (entry.action === 'timeout') {
                            addLog('BGS geology lookup timed out. Scan unaffected.', 'system', 'warn');
                        } else if (entry.action === 'cors_fail') {
                            addLog('BGS geology unavailable via proxy. Scan unaffected.', 'system', 'warn');
                        }
                    },
                },
            );
            if (geologyRequestSeqRef.current === requestSeq) {
                setGeologyContext(ctx);
            }
        } catch (error) {
            reportNonFatal('field-guide', 'Geology context load failed', error);
        } finally {
            if (geologyRequestSeqRef.current === requestSeq) {
                setGeologyContextLoading(false);
            }
        }
    }, [addLog]); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Apply geology modifiers to hotspots (Phase 2) ───────────────────────
    // Fires when geology context becomes available AND historic enhancement is done.
    // Guards against re-application using the tileKey of the last applied context.
    // GEOLOGY_RULE: applyGeologyModifiers enforces the primary-signal gate internally.

    useEffect(() => {
        if (!geologyContext) {
            geologyAppliedRef.current = null;
            return;
        }
        // Wait until historic enhancement is complete — geology is the last stage.
        if (hotspotVersion !== 'enhanced') return;
        // Guard against re-application for the same tile in the same scan session.
        if (geologyAppliedRef.current === geologyContext.tileKey) return;
        if (!hotspots.length) return;

        geologyAppliedRef.current = geologyContext.tileKey;
        const { hotspots: enhanced, appliedCount, netScore } = applyGeologyModifiers(hotspots, geologyContext);
        if (appliedCount > 0) {
            addLog(`Geology modifiers applied (${geologyContext.landscapeClass}, net ${netScore > 0 ? '+' : ''}${netScore}) to ${appliedCount} hotspot${appliedCount !== 1 ? 's' : ''}.`, 'system');
            dispatch({ type: 'GEOLOGY_ENHANCE', hotspots: enhanced });
        }
    }, [geologyContext, hotspots, hotspotVersion]); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Main combined scan ───────────────────────────────────────────────────

    const executeScan = async (requestedQuestionPermissionId?: string) => {
        const run = await runFieldGuideScan({
            map: mapRef.current,
            isBusy: analyzing || isTerrainScanning || isHistoricScanning,
            permissions,
            requestedPermissionId: requestedQuestionPermissionId,
            runTerrainScan: () => runTerrainScan({ mapRef, permissions, fields, targetPeriod }),
            runHistoricPhase,
            onScanStart: () => {
                setScanCount(prev => prev + 1);
                clearScan();
                dispatch({ type: 'SCAN_START' });
                setHistoricScanCompleted(false);
                addLog('> SCAN: Reading terrain, targets and historic landscape context.', 'terrain');
            },
            onTerrainResult: result => {
                applyNhleToMap(result.nhleData);
                applyAimToMap(result.aimData);
                nhleDataRef.current   = result.nhleData;
                aimDataRef.current    = result.aimData;
                modernWaysRef.current = result.modernWays ?? [];

                setSourceAvailability(result.sourceAvailability ?? null);
                setScanFromCache(result.fromCache);
                setScanNoSignal(result.noSignal ?? false);
                setScheduledMonumentCheckFailed(result.nhleData.available === false);
                setScheduledMonumentUnavailableReason(result.nhleData.unavailableReason ?? null);
                setRawClusters(result.rawClusters ?? []);

                dispatch({
                    type: 'SCAN_SUCCESS',
                    features:       result.detectedFeatures,
                    hotspots:       result.hotspots,
                    monumentPoints: result.monumentPoints,
                    routes:         result.routes,
                    heritageCount:  result.heritageCount,
                });

                if (!hasScanned && result.hotspots.length > 0) {
                    setShowSuggestion(true);
                    setSelectedHotspotId(result.hotspots[0].id);
                }
                if (result.hotspots.length === 0) setMobileSheetMode('targets');

                terrainScanCenterRef.current = result.scanStartCenter;
                terrainScanBoundsRef.current = result.scanStartBounds;
                terrainAnalysisBoundsRef.current = result.analysisBounds;
                terrainHistoricRoutesAvailableRef.current = result.historicRoutesAvailable;
                questionTerrainAvailabilityRef.current = result.questionTerrainAvailability;
                runGeologyContextPhase(result.scanStartCenter);

                setHistoricMode(true);
                setIntelDetailsOpen(false);
                setIntelLayersOpen(false);
            },
            onHistoricStart: () => {
                addLog('> Terrain result ready — historic landscape context continues in the background.', 'terrain');
            },
            onScanFailure: () => dispatch({ type: 'SCAN_FAIL' }),
            onScanComplete: () => {
                clearMapItemSelections();
                setSelectedHotspotId(null);
                persistSheetExpanded(true);
            },
            onNavigateToPermission: permissionId => {
                navigate(`/permission/${permissionId}`, { replace: true });
            },
        });
        if (run.status === 'historic_started') void run.completion;
    };

    // Permission-page Questions CTA: wait for the map and permission data, then
    // run the same combined terrain + historic scan as the primary Scan action.
    useEffect(() => {
        if (!questionScanRequested || questionScanAutoStartedRef.current) return;
        let cancelled = false;
        let attempts = 0;
        let timer: number | undefined;

        const tryStart = () => {
            if (cancelled || questionScanAutoStartedRef.current) return;
            if (mapRef.current && permissions.length > 0 && !analyzing && !isTerrainScanning && !isHistoricScanning) {
                questionScanAutoStartedRef.current = true;
                const nextParams = new URLSearchParams(window.location.search);
                nextParams.delete('scan');
                nextParams.delete('permissionId');
                setSearchParams(nextParams, { replace: true });
                void executeScan(questionPermissionId);
                return;
            }
            attempts += 1;
            if (attempts < 40) timer = window.setTimeout(tryStart, 250);
        };

        timer = window.setTimeout(tryStart, 300);
        return () => {
            cancelled = true;
            if (timer !== undefined) window.clearTimeout(timer);
        };
    }, [questionScanRequested, questionPermissionId, permissions.length]); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Standalone historic scan (context drawer / historic layers button) ───

    const loadStandaloneHistoric = useCallback(async () => {
        if (!mapRef.current || isHistoricScanning) return;
        setHistoricScanCompleted(false);
        // clearScan() (called before entering historicMode) resets geologyContext,
        // so re-trigger geology for the current map centre.
        const center = mapRef.current.getCenter();
        runGeologyContextPhase({ lat: center.lat, lng: center.lng });
        // Standalone: re-fetch NHLE/AIM if not already available.
        // Pass existing aimData ref rather than null so that a seconds-old amber
        // result (e.g. from a scan where meta was offline) is reused instead of
        // triggering a fresh 2 s timeout. Bbox affinity is guaranteed: clearScan()
        // nulls aimDataRef, so a ref from a previous scan area cannot survive into
        // a new standalone load. nhleData: null forces a fresh SM fetch (legal gate
        // must stay current).
        await runHistoricPhase({
            terrainClusters,
            monumentPoints,
            routes:     historicRoutes,
            nhleData:   null,
            aimData:    aimDataRef.current,
            scanCenter: terrainScanCenterRef.current,
            analysisBounds: terrainAnalysisBoundsRef.current,
            questionTerrainAvailability: questionTerrainAvailabilityRef.current,
            historicRoutesAvailable: terrainHistoricRoutesAvailableRef.current,
        });
        setIntelDetailsOpen(false);
    }, [isHistoricScanning, terrainClusters, monumentPoints, historicRoutes, runHistoricPhase, runGeologyContextPhase]);

    // ─── Auto-trigger effects ─────────────────────────────────────────────────

    useEffect(() => {
        if (isIntelOpen && !historicScanComplete && !isHistoricScanning && pasFinds.length === 0 && placeSignals.length === 0) loadStandaloneHistoric();
    }, [isIntelOpen]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (historicMode && !historicScanComplete && !isHistoricScanning && pasFinds.length === 0 && placeSignals.length === 0) loadStandaloneHistoric();
    }, [historicMode]); // eslint-disable-line react-hooks/exhaustive-deps


    // ─── Scroll on feature select ─────────────────────────────────────────────

    useEffect(() => {
        if (selectedId) {
            const el = document.getElementById(`card-${selectedId}`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
        }
    }, [selectedId]);

    // Reset sheet scroll to top whenever a card opens in the panel
    useEffect(() => {
        if (selectedId || selectedUserFind || selectedPASFind || selectedMonument !== undefined) {
            sheetScrollRef.current?.scrollTo({ top: 0 });
        }
    }, [selectedId, selectedUserFind, selectedPASFind, selectedMonument]);


    // ─── GPS / search ─────────────────────────────────────────────────────────

    const findMe = () => {
        if (isLocating) return;
        setIsLocating(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setIsLocating(false);
                const { longitude, latitude } = pos.coords;
                setUserGpsPos([longitude, latitude]);
                const map = mapRef.current;
                if (!map) return;
                map.flyTo({ center: [longitude, latitude], zoom: 16 });

                // Build or reposition the "you are here" target marker
                if (!userLocationMarkerRef.current) {
                    const el = document.createElement('div');
                    el.style.cssText = [
                        'width:28px', 'height:28px', 'position:relative',
                        'display:flex', 'align-items:center', 'justify-content:center',
                    ].join(';');
                    // Outer red circle
                    el.innerHTML = `
                        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
                            <circle cx="14" cy="14" r="12" fill="rgba(220,38,38,0.2)" stroke="#dc2626" stroke-width="2"/>
                            <line x1="14" y1="2"  x2="14" y2="8"  stroke="#dc2626" stroke-width="2" stroke-linecap="round"/>
                            <line x1="14" y1="20" x2="14" y2="26" stroke="#dc2626" stroke-width="2" stroke-linecap="round"/>
                            <line x1="2"  y1="14" x2="8"  y2="14" stroke="#dc2626" stroke-width="2" stroke-linecap="round"/>
                            <line x1="20" y1="14" x2="26" y2="14" stroke="#dc2626" stroke-width="2" stroke-linecap="round"/>
                            <circle cx="14" cy="14" r="2.5" fill="#dc2626"/>
                        </svg>`;
                    userLocationMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
                        .setLngLat([longitude, latitude])
                        .addTo(map);
                } else {
                    userLocationMarkerRef.current.setLngLat([longitude, latitude]);
                }
            },
            (err) => { setIsLocating(false); console.error('GPS Error:', err); },
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 },
        );
    };

    const searchLocation = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!searchQuery) return;
        if (searchQuery.trim().toLowerCase() === 'dev mode') {
            const next = !devMode;
            setDevMode(next);
            setSearchQuery('');
            setIsSearchOpen(false);
            return;
        }
        try {
            const data = await searchLocations(searchQuery);
            if (data[0]) { mapRef.current?.flyTo({ center: [parseFloat(data[0].lon), parseFloat(data[0].lat)], zoom: 16 }); setIsSearchOpen(false); }
        } catch { addLog('> Search failed.', 'system', 'warn'); }
    };

    // ─── Dev annotation engine context capture ────────────────────────────────
    const captureEngineContext = useCallback((lat: number, lon: number): EngineContextAtPoint => {
        const clusterDists = detectedFeatures.map(c => getDistance(c.center, [lon, lat]));
        const clustersWithin50m  = clusterDists.filter(d => d <=  50).length;
        const clustersWithin100m = clusterDists.filter(d => d <= 100).length;
        const clustersWithin250m = clusterDists.filter(d => d <= 250).length;

        let nearestHotspotId: string | null = null;
        let nearestHotspotDist: number | null = null;
        for (const h of sortedHotspots) {
            const d = getDistance([lon, lat], h.center);
            if (nearestHotspotDist === null || d < nearestHotspotDist) {
                nearestHotspotId = h.id;
                nearestHotspotDist = Math.round(d);
            }
        }

        let nearestTargetId: string | null = null;
        let nearestTargetDist: number | null = null;
        for (const t of displayTargets) {
            const d = getDistance([lon, lat], t.center);
            if (nearestTargetDist === null || d < nearestTargetDist) {
                nearestTargetId = t.id;
                nearestTargetDist = Math.round(d);
            }
        }

        const suppressionReasons: string[] = [];
        detectedFeatures.forEach((c, i) => {
            if (clusterDists[i] > 250) return;
            if (c.isRouteArtefactRisk && c.routeArtefactReason) suppressionReasons.push(c.routeArtefactReason);
            if (c.disturbanceReason) suppressionReasons.push(c.disturbanceReason);
        });

        return {
            clustersWithin50m,
            clustersWithin100m,
            clustersWithin250m,
            nearestHotspotId,
            nearestHotspotDist,
            nearestTargetId,
            nearestTargetDist,
            sourceAvailability: sourceAvailability ?? null,
            hadSuppressionNearby: suppressionReasons.length > 0,
            suppressionReasons: [...new Set(suppressionReasons)],
            belowHotspotThreshold: clustersWithin250m > 0 && sortedHotspots.length === 0,
        };
    }, [detectedFeatures, sortedHotspots, displayTargets, sourceAvailability]);

    const handleAnnotationConfirm = useCallback(() => {
        if (!pendingAnnotation) return;
        const annotation: DevAnnotation = {
            id: `ann-${Date.now()}`,
            lat: pendingAnnotation.lat,
            lon: pendingAnnotation.lon,
            timestamp: Date.now(),
            engineVersion: 'FG-2026.05.20b',
            ...annotationForm,
            engineContext: captureEngineContext(pendingAnnotation.lat, pendingAnnotation.lon),
        };
        setDevAnnotations(prev => [...prev, annotation]);
        setPendingAnnotation(null);
    }, [pendingAnnotation, annotationForm, captureEngineContext]);

    // ─── Engine Lab export ────────────────────────────────────────────────────
    const handleLabExport = useCallback(async () => {
        const map = mapRef.current;
        if (!map) return;

        const zoom     = SCAN_CONFIG.TERRAIN_ZOOM;
        const center   = map.getCenter();
        const bounds   = map.getBounds();
        const n        = Math.pow(2, zoom);
        const cX       = (center.lng + 180) / 360 * n;
        const cY       = (1 - Math.log(Math.tan(center.lat * Math.PI / 180) + 1 / Math.cos(center.lat * Math.PI / 180)) / Math.PI) / 2 * n;
        const tileKey  = `${zoom}-${Math.floor(cX) - 1}-${Math.floor(cY) - 1}`;

        const cached = await readFieldGuideScanCache(tileKey);

        const payload = {
            exportVersion:    '1',
            engineVersion:    'FG-2026.05.20b',
            exportedAt:       Date.now(),
            scanId:           tileKey,
            center:           { lat: center.lat, lng: center.lng },
            bounds:           { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() },
            scanStartCenter:   terrainScanCenterRef.current,
            scanStartBounds:   terrainScanBoundsRef.current,
            sourceAvailability,
            rawClusters:      cached?.rawClusters ?? [],
            nhleData:         nhleDataRef.current    ?? { features: [] },
            aimData:          aimDataRef.current     ?? { features: [] },
            modernWays:       modernWaysRef.current  ?? [],
            routes:           historicRoutes,
            pasFinds,
            placeSignals,
            monumentPoints,
            referenceTargets: displayTargets,
            traceTargets,
            devAnnotations,
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = Object.assign(document.createElement('a'), {
            href: url, download: `fieldguide-lab-${tileKey}-${Date.now()}.json`,
        });
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    }, [sourceAvailability, historicRoutes, pasFinds, placeSignals, monumentPoints, displayTargets, traceTargets, devAnnotations]);

    // ─── Derived convenience aliases ──────────────────────────────────────────

    // loadingPAS used in JSX — maps to historic scan in-progress flag
    const loadingPAS = isHistoricScanning;
    const terrainScanComplete = hasScanned && !analyzing && !isTerrainScanning;
    const historicScanComplete = historicMode && historicScanCompleted && !loadingPAS;
    const selectedTarget = selectedId ? detectedFeatures.find(f => f.id === selectedId) ?? null : null;
    const activeOverlayOpacityLayer = activeOpacityLayer && historicLayerToggles[activeOpacityLayer] ? activeOpacityLayer : null;
    const rasterOverlayButtonClass = (key: RasterOverlayKey, selectedClass: string) => {
        const enabled = historicLayerToggles[key];
        const selected = activeOverlayOpacityLayer === key;
        if (selected) return `w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all mb-0.5 border ${selectedClass}`;
        if (enabled) return 'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all mb-0.5 bg-white/[0.08] border border-white/15 text-white/85';
        return 'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all mb-0.5 text-white/50 hover:text-white hover:bg-white/5 border border-transparent';
    };

    const helperTips: CoachTip[] = [
        {
            title: 'Map layers',
            body: 'Toggle satellite, LiDAR, old OS maps and your finds.',
            accent: 'text-emerald-300',
            border: 'border-emerald-400/35',
            button: 'Layers',
            action: () => setShowLayerPicker(true),
            position: 'top-[76px] right-3 w-[min(15.5rem,calc(100vw-1.5rem))] sm:right-[68px] sm:max-w-[240px]',
        },
        {
            title: 'Scan panel',
            body: 'Use Terrain or Historic to scan. Tap the panel handle to expand results and switch between Hotspots and Targets.',
            accent: 'text-blue-300',
            border: 'border-blue-400/35',
            button: 'Expand panel',
            action: () => persistSheetExpanded(true),
            position: 'bottom-[152px] left-3 w-[min(18rem,calc(100vw-1.5rem))] sm:left-6 sm:max-w-[280px]',
        },
        {
            title: 'Targets and hotspots',
            body: 'After a scan, tap target pins or hotspot areas on the map to open their detail cards.',
            accent: 'text-amber-300',
            border: 'border-amber-400/35',
            button: 'Got it',
            position: 'top-[34%] left-3 w-[min(18rem,calc(100vw-1.5rem))] sm:left-6 sm:max-w-[280px]',
        },
    ];

    // ─── Context value ────────────────────────────────────────────────────────

    const contextValue = {
        projectId, onSignificantFind,
        mapRef, mapContainerRef,
        logContainerRef, sheetScrollRef, sheetDragStartY, traceCardRefs,
        savedPointJustClickedRef, terrainScanCenterRef, terrainScanBoundsRef,
        nhleDataRef, aimDataRef, modernWaysRef, userLocationMarkerRef,
        analyzing, scanPhase, hotspotVersion, terrainClusters, detectedFeatures,
        hotspots, hasScanned, heritageCount, monumentPoints, historicRoutes,
        sortedHotspots, displayTargets, traceTargets, primaryTargetId,
        sourceUsability, hotspotFindContext, targetFindContext, showConcentrationBanner,
        selectedId, setSelectedId, selectedHotspotId, setSelectedHotspotId,
        showSuggestion, setShowSuggestion, scanStatus, systemLog, zoomWarning,
        isSatellite, setIsSatellite, scanCount, searchQuery, setSearchQuery,
        isSearchOpen, setIsSearchOpen, isIntelOpen, setIsIntelOpen,
        intelDetailsOpen, setIntelDetailsOpen, intelLayersOpen, setIntelLayersOpen,
        targetPeriod, isLocating, selectedMonument, setSelectedMonument,
        historicMode, setHistoricMode, historicScanCompleted, setHistoricScanCompleted,
        historicLayerToggles, setHistoricLayerToggles, historicLayerOpacity,
        activeOpacityLayer, setActiveOpacityLayer, historicLayerVisibility, setHistoricLayerVisibility,
        showFields, setShowFields, showFieldsPicker, setShowFieldsPicker,
        showLayerPicker, setShowLayerPicker, helperActive, setHelperActive,
        helperTipIndex, setHelperTipIndex, fieldPickerStep, setFieldPickerStep,
        mapClickLabel, expandedInterpretationId, setExpandedInterpretationId,
        expandedTargetId, setExpandedTargetId, sheetExpanded,
        devMode, setDevMode, annotationMode, setAnnotationMode,
        devAnnotations, setDevAnnotations, pendingAnnotation, setPendingAnnotation,
        annotationForm, setAnnotationForm, focusMode, setFocusMode,
        mobileSheetMode, setMobileSheetMode, selectedTraceId, setSelectedTraceId,
        showSavedPoints, setShowSavedPoints, savingPoint, setSavingPoint,
        savedPointLabel, setSavedPointLabel, pendingDeleteId, setPendingDeleteId,
        sourceAvailability, scanFromCache, scanNoSignal, scheduledMonumentCheckFailed,
        scheduledMonumentUnavailableReason,
        pasFinds, selectedPASFind, setSelectedPASFind, selectedUserFind, setSelectedUserFind, placeSignals,
        permissions, realPermissions, fields, projectFinds, savedPoints,
        potentialScore, scanConfidence, selectedUserFindMedia,
        sfBannerDismissed, setSfBannerDismissed,
        isTerrainScanning, isHistoricScanning, loadingPAS,
        terrainScanComplete, historicScanComplete, selectedTarget,
        activeOverlayOpacityLayer, rasterOverlayButtonClass,
        handleRasterOverlayPress, updateRasterOverlayOpacity,
        helperTips,
        persistSheetExpanded, handleSheetTouchStart, handleSheetTouchEnd,
        clearMapItemSelections, focusTarget, clearScan,
        executeScan: () => { void executeScan(); },
        findMe, searchLocation, loadStandaloneHistoric,
        handleLabExport, handleAnnotationConfirm, buildSuggestedLabel,
        rawClusters, userGpsPos, setUserGpsPos,
        geologyContext, geologyContextLoading,
        pasDensityCell,
        landscapeIntelligenceMap, landscapeSummary,
    };

    // ─── Render ───────────────────────────────────────────────────────────────

    return (
        <FieldGuideContext.Provider value={contextValue}>
        <div className={focusMode ? 'fixed inset-0 z-[200] flex flex-col bg-slate-950 overflow-hidden' : 'flex flex-col h-[calc(100vh-140px)] landscape:h-[calc(100vh-100px)] sm:h-[calc(100vh-220px)] bg-slate-950 rounded-3xl overflow-hidden border border-slate-800 shadow-2xl relative'}>
            <header className={`bg-slate-900/80 border-b border-white/5 shrink-0 z-50 backdrop-blur-md${focusMode ? ' hidden' : ''}`}>
                {/* Bottom Row: Primary FieldGuide Actions */}
                <div className="hidden justify-between items-center gap-3 px-3 sm:px-4 py-2 bg-black/20 relative">
                    <div className="flex gap-2 items-center min-w-0 relative">
                        <button
                            onClick={() => {
                                if (analyzing) return;
                                if (!historicMode) { clearScan(); setHistoricMode(true); }
                                else { setIsIntelOpen(false); setIntelDetailsOpen(false); setIntelLayersOpen(false); setHistoricMode(false); setHistoricLayerToggles({ lidar: false, 'lidar-wales': false, os1930: false, os1880: false }); setActiveOpacityLayer(null); }
                            }}
                            disabled={analyzing}
                            className={`px-3 sm:px-4 py-2 rounded-lg text-[10px] font-black tracking-widest uppercase border transition-all shadow-lg whitespace-nowrap ${analyzing ? 'bg-slate-700 text-slate-400 border-slate-600 opacity-60 cursor-not-allowed' : historicMode ? 'bg-blue-500/20 text-blue-200 border-blue-400/40' : 'bg-blue-500 text-white border-blue-300/50 shadow-[0_0_15px_rgba(59,130,246,0.3)] hover:bg-blue-400'} ${loadingPAS && historicMode ? 'animate-pulse opacity-80' : ''}`}
                        >
                            {(loadingPAS && historicMode) ? 'Reading...' : historicMode ? 'Clear' : 'Landscape'}
                        </button>
                    </div>

                    <div className="flex gap-2 items-center shrink-0 relative">
                        <button onClick={findMe} disabled={isLocating} className="bg-slate-800 text-white px-3 sm:px-4 py-2 rounded-lg text-[10px] font-black tracking-widest uppercase hover:bg-slate-700 transition-colors disabled:opacity-50 whitespace-nowrap">
                            {isLocating ? '...' : 'GPS'}
                        </button>
                        <button
                            onClick={detectedFeatures.length > 0 ? clearScan : () => void executeScan()}
                            disabled={analyzing || isTerrainScanning}
                            title={detectedFeatures.length > 0 ? 'Clear scan results' : 'Scan area locked to Z16 for precision'}
                            className={`px-3 sm:px-4 py-2 rounded-lg text-[10px] font-black tracking-widest uppercase transition-all whitespace-nowrap disabled:opacity-50 disabled:animate-pulse ${detectedFeatures.length > 0 ? 'bg-slate-600 text-white hover:bg-slate-500' : 'bg-emerald-500 text-white hover:bg-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)]'}`}
                        >
                            {analyzing || isTerrainScanning ? '...' : detectedFeatures.length > 0 ? 'Clear' : 'Scan Terrain'}
                        </button>
                    </div>
                </div>
            </header>

            <div className="flex flex-1 overflow-hidden relative">
                <FieldGuideMap />
                <ScanLogDrawer />
            </div>

            {/* Dev Annotation Modal — shown when a pin has been dropped in annotation mode */}
            {devMode && pendingAnnotation && (
                <div className="absolute bottom-6 left-6 z-[300] w-72 bg-slate-900 border border-orange-500/40 rounded-2xl shadow-2xl shadow-orange-900/20 overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-200">
                    <div className="px-4 py-3 border-b border-orange-500/15 bg-orange-500/5 flex items-center gap-2">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>
                        <span className="text-[9px] font-black text-orange-400 uppercase tracking-[0.2em]">Dev Annotation</span>
                        <span className="ml-auto text-[7px] font-mono text-white/25">{pendingAnnotation.lat.toFixed(4)}, {pendingAnnotation.lon.toFixed(4)}</span>
                    </div>
                    <div className="px-4 py-3 space-y-2.5">
                        {/* Annotation type */}
                        <div>
                            <p className="text-[7px] font-black text-white/30 uppercase tracking-widest mb-1">Type</p>
                            <select
                                value={annotationForm.annotationType}
                                onChange={e => setAnnotationForm(f => ({ ...f, annotationType: e.target.value as AnnotationType }))}
                                className="w-full bg-slate-800 border border-white/10 rounded-lg px-2.5 py-1.5 text-[9px] text-white/80 font-mono focus:outline-none focus:border-orange-500/50"
                            >
                                {(Object.entries(ANNOTATION_TYPE_LABELS) as [AnnotationType, string][]).map(([v, l]) => (
                                    <option key={v} value={v}>{l}</option>
                                ))}
                            </select>
                        </div>
                        {/* Row: period + landscape */}
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <p className="text-[7px] font-black text-white/30 uppercase tracking-widest mb-1">Period</p>
                                <select
                                    value={annotationForm.broadPeriod}
                                    onChange={e => setAnnotationForm(f => ({ ...f, broadPeriod: e.target.value as BroadPeriod }))}
                                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-2 py-1.5 text-[9px] text-white/80 font-mono focus:outline-none focus:border-orange-500/50"
                                >
                                    {(['Prehistoric','Roman','Early Medieval','Medieval','Post-Medieval','Multi-period','Unknown'] as BroadPeriod[]).map(v => (
                                        <option key={v} value={v}>{v}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <p className="text-[7px] font-black text-white/30 uppercase tracking-widest mb-1">Confidence</p>
                                <select
                                    value={annotationForm.confidence}
                                    onChange={e => setAnnotationForm(f => ({ ...f, confidence: e.target.value as AnnotationConfidence }))}
                                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-2 py-1.5 text-[9px] text-white/80 font-mono focus:outline-none focus:border-orange-500/50"
                                >
                                    {(['low','medium','high'] as AnnotationConfidence[]).map(v => (
                                        <option key={v} value={v}>{v}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        {/* Landscape type */}
                        <div>
                            <p className="text-[7px] font-black text-white/30 uppercase tracking-widest mb-1">Landscape</p>
                            <select
                                value={annotationForm.landscapeType}
                                onChange={e => setAnnotationForm(f => ({ ...f, landscapeType: e.target.value as LandscapeType }))}
                                className="w-full bg-slate-800 border border-white/10 rounded-lg px-2.5 py-1.5 text-[9px] text-white/80 font-mono focus:outline-none focus:border-orange-500/50"
                            >
                                {(Object.entries(LANDSCAPE_TYPE_LABELS) as [LandscapeType, string][]).map(([v, l]) => (
                                    <option key={v} value={v}>{l}</option>
                                ))}
                            </select>
                        </div>
                        {/* Note */}
                        <div>
                            <p className="text-[7px] font-black text-white/30 uppercase tracking-widest mb-1">Note (optional)</p>
                            <input
                                type="text"
                                value={annotationForm.reviewerNote}
                                onChange={e => setAnnotationForm(f => ({ ...f, reviewerNote: e.target.value }))}
                                placeholder="e.g. Roman activity likely, no hotspot"
                                className="w-full bg-slate-800 border border-white/10 rounded-lg px-2.5 py-1.5 text-[9px] text-white/80 font-mono placeholder:text-white/20 focus:outline-none focus:border-orange-500/50"
                            />
                        </div>
                        {/* Actions */}
                        <div className="flex gap-2 pt-0.5">
                            <button
                                onClick={() => setPendingAnnotation(null)}
                                className="flex-1 px-3 py-2 rounded-lg border border-white/10 text-white/40 text-[9px] font-black uppercase tracking-widest hover:bg-white/5 transition-colors active:scale-[0.98]"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAnnotationConfirm}
                                className="flex-1 px-3 py-2 rounded-lg border border-orange-500/40 bg-orange-500/15 text-orange-300 text-[9px] font-black uppercase tracking-widest hover:bg-orange-500/25 transition-colors active:scale-[0.98]"
                            >
                                Save Pin
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Your Find Card — desktop only; mobile shows inside panel */}
            {selectedUserFind && (() => {
                const PERIOD_CHIP: Record<string, string> = {
                    'Prehistoric': 'bg-gray-700/60 text-gray-300', 'Bronze Age': 'bg-orange-900/50 text-orange-300',
                    'Iron Age': 'bg-red-900/50 text-red-300', 'Celtic': 'bg-teal-900/50 text-teal-300',
                    'Roman': 'bg-purple-900/50 text-purple-300', 'Anglo-Saxon': 'bg-amber-900/50 text-amber-300',
                    'Early Medieval': 'bg-emerald-900/50 text-emerald-300', 'Medieval': 'bg-blue-900/50 text-blue-300',
                    'Post-medieval': 'bg-indigo-900/50 text-indigo-300', 'Modern': 'bg-green-900/50 text-green-300',
                    'Unknown': 'bg-white/5 text-white/40',
                };
                const chipClass = PERIOD_CHIP[selectedUserFind.period] ?? PERIOD_CHIP['Unknown'];
                const foundDate = selectedUserFind.foundAt ?? selectedUserFind.createdAt;
                const dateLabel = foundDate ? new Date(foundDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
                return (
                <div className="hidden">
                    <div className="absolute inset-0 z-[199]" onClick={() => setSelectedUserFind(null)} />
                    <div className="absolute bottom-6 left-auto right-6 w-96 z-[200] animate-in slide-in-from-bottom-4 fade-in duration-200">
                        <div className="p-5 rounded-3xl border-2 border-emerald-500/40 bg-slate-900 shadow-2xl shadow-emerald-900/20">
                            <p className="text-[9px] font-black text-white uppercase tracking-[0.2em] text-center mb-3">Your Find</p>

                            {/* Top row: photo + main details */}
                            <div className="flex items-start gap-3 mb-4">
                                {/* Photo / placeholder */}
                                <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 border border-white/10">
                                    {selectedUserFindMedia
                                        ? <ScaledImage media={selectedUserFindMedia} className="w-full h-full" imgClassName="object-cover" showScale={false} />
                                        : <div className="w-full h-full border border-dashed border-white/15 rounded-xl grid place-items-center text-[9px] font-black text-white/20 uppercase tracking-wider">No Photo</div>
                                    }
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between">
                                        <h3 className="text-base font-black text-white tracking-tight leading-tight mb-1 pr-2">
                                            {selectedUserFind.objectType || 'Unknown Object'}
                                        </h3>
                                        <button onClick={() => setSelectedUserFind(null)} className="bg-black/20 hover:bg-black/40 text-white rounded-full p-2 transition-colors border border-white/10 flex-shrink-0 -mt-0.5">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                        </button>
                                    </div>
                                    {/* Period chip + material */}
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${chipClass}`}>{selectedUserFind.period}</span>
                                        {selectedUserFind.material && <span className="text-[10px] text-white/40">{selectedUserFind.material}</span>}
                                    </div>
                                </div>
                            </div>

                            {/* Meta chips row */}
                            <div className="flex items-center gap-2 flex-wrap mb-3">
                                {dateLabel && (
                                    <span className="flex items-center gap-1 text-[10px] text-white/40">
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                                        {dateLabel}
                                    </span>
                                )}
                                {selectedUserFind.depthCm != null && (
                                    <span className="flex items-center gap-1 text-[10px] text-white/40">
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="2" x2="12" y2="22"/><polyline points="6 16 12 22 18 16"/></svg>
                                        {selectedUserFind.depthCm} cm
                                    </span>
                                )}
                                {selectedUserFind.weightG != null && (
                                    <span className="text-[10px] text-white/40">{selectedUserFind.weightG} g</span>
                                )}
                            </div>

                            {/* Notes snippet */}
                            {selectedUserFind.notes?.trim() && (
                                <p className="text-2xs text-white/40 italic leading-snug line-clamp-2 mb-3">{selectedUserFind.notes.trim()}</p>
                            )}

                            {/* Footer: find code */}
                            <div className="border-t border-white/8 pt-3">
                                <span className="text-[10px] text-white/25 font-mono">{selectedUserFind.findCode}</span>
                            </div>
                        </div>
                    </div>
                </div>
                );
            })()}

            {/* Heritage Feature Card — desktop only; mobile shows inside panel */}
            {selectedPASFind && (
                <div className="hidden">
                    <div className="absolute inset-0 z-[199]" onClick={() => setSelectedPASFind(null)} />
                    <div className="absolute bottom-6 left-auto right-6 w-96 z-[200] animate-in slide-in-from-bottom-4 fade-in duration-200">
                        <div className="p-5 rounded-3xl border-2 border-emerald-500/40 bg-slate-900 shadow-2xl shadow-emerald-900/20">
                            <p className="text-[9px] font-black text-white uppercase tracking-[0.2em] text-center mb-3">Heritage Feature</p>
                            <div className="flex justify-between items-start mb-4">
                                <div className="flex-1 min-w-0 pr-3">
                                    <h3 className="text-base font-black text-white tracking-tight leading-tight mb-1">{selectedPASFind.objectType}</h3>
                                    <p className="text-2xs font-black text-emerald-400">{selectedPASFind.broadperiod}</p>
                                </div>
                                <button onClick={() => setSelectedPASFind(null)} className="bg-black/20 hover:bg-black/40 text-white rounded-full p-2 transition-colors border border-white/10 flex-shrink-0">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                </button>
                            </div>
                            <div className="border-t border-white/8 pt-3 space-y-3">
                                <p className="text-2xs font-bold text-white/70 leading-snug">Standing heritage feature recorded in the OpenStreetMap community dataset.</p>
                                <a
                                    href={`https://www.openstreetmap.org/${selectedPASFind.osmType || 'node'}/${selectedPASFind.internalId}`}
                                    target="_blank" rel="noreferrer"
                                    className="flex items-center justify-center gap-2 w-full py-3 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-[0.98]"
                                >
                                    View on OpenStreetMap
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
        </FieldGuideContext.Provider>
    );
}
