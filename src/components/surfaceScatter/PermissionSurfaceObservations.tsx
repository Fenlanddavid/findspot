import React, { useCallback, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Permission, type SurfaceMaterial, type SurfacePeriod } from '../../db';
import { getPermissionScanTarget } from '../../outstandingQuestions/permissionScanTarget';
import { captureGPS } from '../../services/gps';
import {
  clusterSurfaceObservations,
  resolveEffectiveScatter,
  summarizeSurfaceObservations,
  SURFACE_MATERIAL_LABELS,
  SURFACE_PERIOD_LABELS,
  type SurfaceScope,
} from '../../services/surfaceScatter';
import { ObservedByYouBlock, RecordSurfaceFindButton } from './ObservedByYouBlock';
import { SurfaceObservationDetailModal } from './SurfaceObservationDetails';
import { SurfaceObservationsMap } from './SurfaceObservationsMap';

/**
 * Permission-scoped surface observations for the Landscape investigations card.
 * This is presentation-only and never enters FieldGuide or an engine result.
 */
export function PermissionSurfaceObservations({ permission }: { permission: Permission }) {
  const [showMap, setShowMap] = useState(false);
  const [showRetired, setShowRetired] = useState(false);
  const [materialFilter, setMaterialFilter] = useState<SurfaceMaterial | 'all'>('all');
  const [fieldFilter, setFieldFilter] = useState<string>('all');
  const [mapSelectedId, setMapSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [previousMapLocation, setPreviousMapLocation] = useState<{ lat: number; lon: number } | null>(null);
  const rows = useLiveQuery(async () => {
    const [observations, sections, fields] = await Promise.all([
      db.surfaceObservations.where('permissionId').equals(permission.id).toArray(),
      db.permissionSections.where('permissionId').equals(permission.id).toArray(),
      db.fields.where('permissionId').equals(permission.id).toArray(),
    ]);
    return { observations, sections, fields };
  }, [permission.id]);

  const scatter = useMemo(() => {
    const observations = rows?.observations ?? [];
    const point = getPermissionScanTarget(permission)
      ?? (observations[0] ? { lat: observations[0].lat, lon: observations[0].lon } : null);
    const scope: SurfaceScope | null = point
      ? { permissionId: permission.id, sectionId: null, point }
      : null;
    return resolveEffectiveScatter({
      observations,
      sections: rows?.sections ?? [],
      scope,
    });
  }, [permission, rows]);
  const activeObservations = useMemo(
    () => (rows?.observations ?? []).filter(row => !row.retiredAt),
    [rows?.observations],
  );
  const retiredObservations = useMemo(
    () => (rows?.observations ?? []).filter(row => !!row.retiredAt),
    [rows?.observations],
  );
  const filteredObservations = useMemo(() => activeObservations.filter(observation =>
    (materialFilter === 'all' || observation.material === materialFilter)
    && (fieldFilter === 'all'
      || (fieldFilter === 'unassigned' ? observation.fieldId === null : observation.fieldId === fieldFilter)),
  ), [activeObservations, fieldFilter, materialFilter]);
  const summary = useMemo(() => summarizeSurfaceObservations(activeObservations), [activeObservations]);
  const clusters = useMemo(() => clusterSurfaceObservations(activeObservations), [activeObservations]);
  const selectedObservation = (rows?.observations ?? []).find(row => row.id === detailId) ?? null;
  const mapSelectedObservation = filteredObservations.find(row => row.id === mapSelectedId) ?? null;
  const selectObservation = useCallback((observationId: string) => setDetailId(observationId), []);
  const selectMapObservation = useCallback((observationId: string) => setMapSelectedId(observationId), []);
  const mapLocationStart = getPermissionScanTarget(permission);

  const recordButton = (
    <RecordSurfaceFindButton
      compact
      projectId={permission.projectId}
      permissionId={permission.id}
      getLocation={captureGPS}
      allowMapLocation
      mapLocationStart={mapLocationStart}
      mapBoundary={permission.boundary}
      previousMapLocation={previousMapLocation}
      onMapLocationSelected={setPreviousMapLocation}
    />
  );
  const recordIconButton = (
    <RecordSurfaceFindButton
      icon
      projectId={permission.projectId}
      permissionId={permission.id}
      getLocation={captureGPS}
      allowMapLocation
      mapLocationStart={mapLocationStart}
      mapBoundary={permission.boundary}
      previousMapLocation={previousMapLocation}
      onMapLocationSelected={setPreviousMapLocation}
    />
  );

  return (
    <div className="relative mx-4 mt-3 sm:mx-5">
      <ObservedByYouBlock
        scatter={scatter}
        recordButton={recordButton}
        recordIconButton={recordIconButton}
        onSelectObservation={selectObservation}
      />
      {summary.observationCount > 0 && (
        <div className="mt-3 rounded-xl border border-sky-200 bg-white/80 p-3 dark:border-sky-800/70 dark:bg-gray-950/25">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-3xs font-black uppercase tracking-[0.18em] text-sky-600 dark:text-sky-400">Surface observations</p>
              <p className="mt-1 text-sm font-black">{summary.observationCount} observations · {summary.distinctOriginVisitCount} recorded visits</p>
              {summary.outsideSavedVisitCount > 0 && <p className="text-2xs font-bold text-gray-500">{summary.outsideSavedVisitCount} observations recorded outside a saved visit</p>}
            </div>
            <button type="button" onClick={() => setShowMap(value => !value)} className="min-h-10 shrink-0 rounded-xl bg-sky-600 px-3 text-xs font-black text-white">{showMap ? 'Hide map' : 'View map'}</button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(Object.entries(summary.materialCounts) as Array<[SurfaceMaterial, number]>).map(([material, count]) => <div key={material} className="rounded-lg bg-gray-50 px-2.5 py-2 text-xs dark:bg-gray-900/60"><span className="font-bold">{SURFACE_MATERIAL_LABELS[material]}</span><span className="float-right font-black">{count}</span></div>)}
          </div>
          {(summary.firstObserved || summary.mostRecentlyObserved) && <p className="mt-2 text-3xs font-bold text-gray-400">First recorded {summary.firstObserved ? new Date(summary.firstObserved).toLocaleDateString('en-GB') : '—'} · Most recent {summary.mostRecentlyObserved ? new Date(summary.mostRecentlyObserved).toLocaleDateString('en-GB') : '—'}</p>}
          {retiredObservations.length > 0 && <button type="button" onClick={() => setShowRetired(value => !value)} className="mt-2 text-3xs font-black text-amber-700 dark:text-amber-300">{showRetired ? 'Hide' : 'View'} {retiredObservations.length} retired observations</button>}
          {showRetired && <div className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200 px-3 dark:divide-gray-700 dark:border-gray-700">{retiredObservations.map(observation => <button type="button" key={observation.id} onClick={() => setDetailId(observation.id)} className="block w-full py-2 text-left text-xs"><span className="font-black">{SURFACE_MATERIAL_LABELS[observation.material]}</span><span className="ml-2 text-gray-400">Retired {observation.retiredAt ? new Date(observation.retiredAt).toLocaleDateString('en-GB') : ''}</span></button>)}</div>}
          {showMap && <div className="mt-3">
            <div className="mb-2 grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-3xs font-black text-gray-500">Material<select value={materialFilter} onChange={event => { setMaterialFilter(event.target.value as SurfaceMaterial | 'all'); setMapSelectedId(null); }} className="min-h-10 rounded-lg border border-gray-300 bg-white px-2 text-xs dark:border-gray-600 dark:bg-gray-900"><option value="all">All materials</option>{(Object.keys(SURFACE_MATERIAL_LABELS) as SurfaceMaterial[]).map(material => <option key={material} value={material}>{SURFACE_MATERIAL_LABELS[material]}</option>)}</select></label>
              <label className="grid gap-1 text-3xs font-black text-gray-500">Field context<select value={fieldFilter} onChange={event => { setFieldFilter(event.target.value); setMapSelectedId(null); }} className="min-h-10 rounded-lg border border-gray-300 bg-white px-2 text-xs dark:border-gray-600 dark:bg-gray-900"><option value="all">All fields</option>{(rows?.fields ?? []).map(field => <option key={field.id} value={field.id}>{field.name}</option>)}<option value="unassigned">No field link</option></select></label>
            </div>
            {filteredObservations.length > 0 ? <SurfaceObservationsMap observations={filteredObservations} selectedId={mapSelectedId} onSelect={selectMapObservation} /> : <div className="grid h-32 place-items-center rounded-xl border border-dashed border-gray-300 text-xs font-bold text-gray-400">No current observations match these filters.</div>}
            {mapSelectedObservation && <button type="button" onClick={() => setDetailId(mapSelectedObservation.id)} className="mt-2 flex min-h-12 w-full items-center justify-between rounded-xl border border-sky-200 bg-sky-50 px-3 text-left dark:border-sky-800 dark:bg-sky-950/20"><span><span className="block text-xs font-black">{SURFACE_MATERIAL_LABELS[mapSelectedObservation.material]} · {mapSelectedObservation.periodImpression === 'unknown' ? 'Period not sure' : SURFACE_PERIOD_LABELS[mapSelectedObservation.periodImpression]}</span><span className="block text-3xs font-bold text-gray-500">{mapSelectedObservation.abundance} · {mapSelectedObservation.gpsAccuracyM == null ? 'GPS accuracy unknown' : `GPS ±${Math.round(mapSelectedObservation.gpsAccuracyM)} m`} · Observed by you</span></span><span className="text-xs font-black text-sky-700 dark:text-sky-300">View details</span></button>}
          </div>}
          {clusters.length > 0 && (
            <div className="mt-3 space-y-2">
              {clusters.map(cluster => (
                <div key={cluster.id} className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                  <p className="text-3xs font-black uppercase tracking-[0.18em] text-gray-500">Surface concentration</p>
                  <p className="mt-1 text-xs font-black">{cluster.observationCount} observations · recorded-position spread approximately {Math.round(cluster.spreadM)} m</p>
                  <p className="mt-1 text-2xs font-bold text-gray-500">{cluster.distinctOriginVisitCount} saved visits{cluster.outsideSavedVisitCount ? ` · ${cluster.outsideSavedVisitCount} outside a saved visit` : ''}</p>
                  <p className="mt-1 text-2xs text-gray-500">{(Object.entries(cluster.materialCounts) as Array<[SurfaceMaterial, number]>).map(([material, count]) => `${SURFACE_MATERIAL_LABELS[material]} ${count}`).join(' · ')}</p>
                  {cluster.materialAssociations.map(association => <p key={association.materials.join(':')} className="mt-2 text-2xs font-bold text-gray-600 dark:text-gray-300">Nearby material association — {SURFACE_MATERIAL_LABELS[association.materials[0]]} and {SURFACE_MATERIAL_LABELS[association.materials[1]]} were recorded approximately {Math.round(association.distanceM)} m apart.</p>)}
                  {cluster.periodPattern === 'consistent' && <p className="mt-2 text-2xs font-bold text-sky-700 dark:text-sky-300">Period consistency — {Object.entries(cluster.periodCounts).filter(([period]) => period !== 'unknown').map(([period, count]) => `${count} nearby observations were recorded with a possible ${SURFACE_PERIOD_LABELS[period as SurfacePeriod]} period impression`).join('')}</p>}
                  {cluster.periodPattern === 'mixed' && <p className="mt-2 text-2xs font-bold text-amber-700 dark:text-amber-300">Mixed period impressions — surface material here has been assigned different period impressions. Treat the recorded scatter as mixed or uncertain.</p>}
                </div>
              ))}
              <p className="text-3xs font-bold text-gray-400">Descriptive grouping only · cluster algorithm v1 · recorded coordinates within 50 m</p>
            </div>
          )}
        </div>
      )}
      {selectedObservation && <SurfaceObservationDetailModal observation={selectedObservation} onClose={() => setDetailId(null)} />}
    </div>
  );
}
