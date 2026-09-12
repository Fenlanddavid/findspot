import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Map, LngLatBounds, type GeoJSONSource } from 'maplibre-gl';
import type { Find } from '../db';
import { loadFindsMapState, saveFindsMapState } from '../services/findsMapState';

export function FindsMap({ projectId, finds, selectedId, onOpen, onGallery }: { projectId: string; finds: Find[]; selectedId: string | null; onOpen: (id: string) => void; onGallery: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const initial = useRef(loadFindsMapState(projectId));
  const fitted = useRef(!!initial.current);
  const [satellite, setSatellite] = useState(initial.current?.satellite ?? false);
  const satelliteRef = useRef(satellite); satelliteRef.current = satellite;
  const [imageryError, setImageryError] = useState(false);
  const [choices, setChoices] = useState<string[]>([]);
  const findsRef = useRef(finds); findsRef.current = finds;
  const remember = useCallback(() => {
    const map = mapRef.current;
    if (map) saveFindsMapState(projectId, { center: [map.getCenter().lng, map.getCenter().lat], zoom: map.getZoom(), satellite: satelliteRef.current });
  }, [projectId]);
  const located = useMemo(() => finds.filter(find => find.lat != null && find.lon != null
    && Number.isFinite(find.lat) && Number.isFinite(find.lon)), [finds]);
  const fitResults = useCallback(() => {
    const map = mapRef.current;
    if (!map || !located.length) return;
    const bounds = new LngLatBounds();
    located.forEach(find => bounds.extend([find.lon!, find.lat!]));
    map.fitBounds(bounds, { padding: 60, maxZoom: 17, duration: 0 });
    fitted.current = true;
  }, [located]);

  useEffect(() => {
    if (!container.current) return;
    let map: Map;
    try {
      map = new Map({
        container: container.current, center: initial.current?.center ?? [-2, 54.5], zoom: initial.current?.zoom ?? 5,
        style: { version: 8, sources: {
          osm: { type: 'raster', tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' },
          satellite: { type: 'raster', tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: 'Esri' },
        }, layers: [
          { id: 'osm', type: 'raster', source: 'osm' },
          { id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: satelliteRef.current ? 'visible' : 'none' } },
        ] },
      });
    } catch { setError(true); return; }
    mapRef.current = map;
    map.on('moveend', remember);
    map.on('error', event => { if ('sourceId' in event && (event.sourceId === 'osm' || event.sourceId === 'satellite')) setImageryError(true); });
    map.on('load', () => {
      map.addSource('finds', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'finds', type: 'circle', source: 'finds', paint: {
        'circle-radius': 9, 'circle-color': ['case', ['get', 'pending'], '#d97706', '#059669'],
        'circle-stroke-width': ['case', ['get', 'selected'], 5, 2], 'circle-stroke-color': ['case', ['get', 'selected'], '#2563eb', '#ffffff'],
      } });
      map.on('click', event => {
        const nearby = findsRef.current.filter(find => {
          if (find.lat == null || find.lon == null) return false;
          const point = map.project([find.lon, find.lat]);
          return Math.hypot(point.x - event.point.x, point.y - event.point.y) <= 24;
        });
        if (nearby.length === 1) { setChoices([]); onOpenRef.current(nearby[0].id); }
        else setChoices(nearby.map(find => find.id));
      });
      map.on('mouseenter', 'finds', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'finds', () => { map.getCanvas().style.cursor = ''; });
      setReady(true);
    });
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container.current);
    return () => { remember(); resize.disconnect(); map.remove(); mapRef.current = null; };
  }, [remember]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource('finds') as GeoJSONSource).setData({ type: 'FeatureCollection', features: located.map(find => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [find.lon!, find.lat!] },
      properties: { id: find.id, pending: !!find.isPending, selected: find.id === selectedId },
    })) });
    if (!fitted.current && located.length) fitResults();
  }, [located, ready, selectedId, fitResults]);

  useEffect(() => {
    if (!ready) return;
    setImageryError(false);
    mapRef.current?.setLayoutProperty('satellite', 'visibility', satellite ? 'visible' : 'none');
    remember();
  }, [ready, satellite, remember]);

  return <section className="mt-5" aria-label="Finds map">
    <p role="status" className="mb-2 text-sm text-gray-600 dark:text-gray-300">{located.length} of {finds.length} records have a location. Amber markers need finishing.</p>
    <div className="mb-2 flex flex-wrap gap-2">
      <button type="button" onClick={fitResults} disabled={!ready || !located.length} className="ui-secondary">Show all results</button>
      <button type="button" onClick={onGallery} className="ui-secondary">{located.length < finds.length ? 'View records without locations in Gallery' : 'Return to Gallery'}</button>
    </div>
    {imageryError && <p role="status" className="ui-message">Map imagery is unavailable. Located records remain selectable; try another basemap or return to Gallery.</p>}
    {error ? <p role="alert">The map could not open. Your records are available in Gallery.</p> : <div className="relative h-[60dvh] min-h-64 overflow-hidden rounded-2xl border border-gray-300 dark:border-gray-700">
      <div ref={container} className="absolute inset-0" />
      <button type="button" aria-pressed={satellite} onClick={() => setSatellite(value => !value)} className="absolute right-3 top-3 min-h-11 rounded-xl bg-white px-4 text-sm font-bold text-gray-900 shadow">{satellite ? 'Street map' : 'Satellite'}</button>
      {choices.some(id => finds.some(find => find.id === id)) && <div role="group" aria-label="Finds at this location" className="absolute inset-x-3 bottom-3 max-h-[65%] overflow-y-auto rounded-xl border border-gray-300 bg-white p-3 text-gray-900 shadow dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
        <div className="flex items-center justify-between gap-2"><p className="font-semibold">Choose a find</p><button className="ui-secondary" onClick={() => setChoices([])}>Close choices</button></div>
        {choices.map(id => finds.find(find => find.id === id)).filter((find): find is Find => !!find).map(find => <button type="button" key={find.id} className="ui-secondary mt-2 w-full text-left" onClick={() => { setChoices([]); onOpen(find.id); }}>{find.objectType} · {find.findCode}<span className="block text-xs">{find.period} · {(find.foundAt || find.createdAt).slice(0, 10)}</span></button>)}
      </div>}
    </div>}
    <details className="mt-3">
      <summary className="min-h-11 cursor-pointer text-sm font-medium">Records on this map</summary>
      <div className="grid gap-2">{located.map(find => <button key={find.id} type="button" aria-pressed={find.id === selectedId} onClick={() => onOpen(find.id)} className="min-h-11 rounded-lg border border-gray-300 p-2 text-left text-sm dark:border-gray-700">{find.objectType || 'Find'} · {find.findCode}</button>)}</div>
    </details>
  </section>;
}
