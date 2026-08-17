import { useEffect, useRef, type RefObject } from 'react';
import type maplibregl from 'maplibre-gl';
import type { Permission } from '../db';
import type { FieldGuideRouteContext } from './useFieldGuideRouteActions';

type Options = {
  route: FieldGuideRouteContext;
  mapRef: RefObject<maplibregl.Map | null>;
  permissions: readonly Permission[];
  isBusy: boolean;
  setSearchParams: (params: URLSearchParams, options: { replace: boolean }) => void;
  setShowFields: (value: false | 'all' | string) => void;
  executeScan: () => Promise<void>;
};

export function useActiveSessionGuideAutoScan({ route, mapRef, permissions, isBusy, setSearchParams, setShowFields, executeScan }: Options): void {
  const startedRef = useRef(false);
  useEffect(() => {
    if (route.scan !== 'active-session' || startedRef.current) return;
    let cancelled = false;
    let attempts = 0;
    let timer: number | undefined;
    const tryStart = () => {
      if (cancelled || startedRef.current) return;
      const map = mapRef.current;
      const permissionReady = !route.permissionId || permissions.some(permission => permission.id === route.permissionId);
      const hasTarget = Number.isFinite(route.lat) && Number.isFinite(route.lng);
      if (map && map.isStyleLoaded() && permissionReady && hasTarget && !isBusy) {
        startedRef.current = true;
        map.stop();
        if (route.boundaryBounds) {
          const { west, south, east, north } = route.boundaryBounds;
          map.fitBounds([[west, south], [east, north]], { padding: 60, duration: 0, maxZoom: 17 });
          setShowFields(route.fieldId ? `field:${route.fieldId}` : route.permissionId ?? false);
        } else {
          map.jumpTo({ center: [route.lng, route.lat], zoom: Math.max(map.getZoom(), 14) });
        }
        const nextParams = new URLSearchParams(window.location.search);
        ['scan', 'permissionId', 'fieldId', 'west', 'south', 'east', 'north'].forEach(key => nextParams.delete(key));
        setSearchParams(nextParams, { replace: true });
        void executeScan();
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
  }, [route.scan, route.permissionId, permissions.length]); // eslint-disable-line react-hooks/exhaustive-deps
}
