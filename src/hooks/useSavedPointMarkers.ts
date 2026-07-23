import { useEffect, type MutableRefObject, type RefObject } from 'react';
import maplibregl from 'maplibre-gl';
import type { SavedPoint } from '../db';
import { reportNonFatal } from '../services/diagLog';
import { removeSavedPoint } from '../services/fieldGuideMutations';
import type { FieldGuideMapCallbacks } from '../services/fieldguide/mapInteractions';
import { deletePack } from '../services/offlinePack';

type Options = {
    mapRef: RefObject<maplibregl.Map | null>;
    savedPoints: SavedPoint[];
    showSavedPoints: boolean;
    savedPointMarkersRef: MutableRefObject<maplibregl.Marker[]>;
    callbacksRef: MutableRefObject<FieldGuideMapCallbacks>;
};

export function useSavedPointMarkers({
    mapRef,
    savedPoints,
    showSavedPoints,
    savedPointMarkersRef,
    callbacksRef,
}: Options): void {
    useEffect(() => {
        savedPointMarkersRef.current.forEach(marker => marker.remove());
        savedPointMarkersRef.current = [];
        const map = mapRef.current;
        if (!map || !showSavedPoints || savedPoints.length === 0) return;

        const doAdd = () => {
            savedPointMarkersRef.current.forEach(marker => marker.remove());
            savedPointMarkersRef.current = [];
            for (const savedPoint of savedPoints) {
                const markerElement = document.createElement('div');
                markerElement.style.cursor = 'pointer';
                markerElement.style.lineHeight = '0';
                markerElement.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="#10b981" stroke="#34d399" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;

                const diff = Date.now() - new Date(savedPoint.createdAt).getTime();
                const days = Math.floor(diff / 86400000);
                const date = days === 0
                    ? 'Today'
                    : days === 1
                        ? 'Yesterday'
                        : days < 7
                            ? `${days} days ago`
                            : new Date(savedPoint.createdAt).toLocaleDateString('en-GB', {
                                day: 'numeric',
                                month: 'short',
                            });

                const popupElement = document.createElement('div');
                popupElement.style.cssText = 'background:#0f172a;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:10px 12px;min-width:160px;box-shadow:0 8px 24px rgba(0,0,0,0.4);';

                const labelElement = document.createElement('p');
                labelElement.style.cssText = 'font-size:13px;font-weight:900;color:#fff;margin:0 0 2px;line-height:1.2;';
                labelElement.textContent = savedPoint.label;
                popupElement.appendChild(labelElement);

                const dateElement = document.createElement('p');
                dateElement.style.cssText = 'font-size:9px;color:rgba(255,255,255,0.4);margin:0;';
                dateElement.textContent = date;
                popupElement.appendChild(dateElement);

                if (savedPoint.scanSnapshot) {
                    const snapshotElement = document.createElement('p');
                    snapshotElement.style.cssText = 'font-size:9px;color:rgba(52,211,153,0.7);margin:2px 0 0;';
                    snapshotElement.textContent = `${savedPoint.scanSnapshot.hotspotCount} hotspot${savedPoint.scanSnapshot.hotspotCount !== 1 ? 's' : ''} · ${savedPoint.scanSnapshot.topHotspotTitle}`;
                    popupElement.appendChild(snapshotElement);
                }

                const buttonRow = document.createElement('div');
                buttonRow.style.cssText = 'display:flex;gap:6px;margin-top:8px;';

                const flyButton = document.createElement('button');
                flyButton.style.cssText = 'flex:1;padding:5px 8px;border-radius:8px;background:#059669;color:#fff;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:0.1em;border:none;cursor:pointer;';
                flyButton.textContent = 'Fly here';
                flyButton.addEventListener('click', () => {
                    map.flyTo({ center: [savedPoint.lon, savedPoint.lat], zoom: savedPoint.zoom });
                });

                let deleteConfirmPending = false;
                let deleteConfirmTimer: ReturnType<typeof setTimeout> | null = null;
                const deleteButton = document.createElement('button');
                deleteButton.style.cssText = 'padding:5px 8px;border-radius:8px;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.35);font-size:9px;border:1px solid rgba(255,255,255,0.1);cursor:pointer;';
                deleteButton.title = 'Delete';
                deleteButton.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
                deleteButton.addEventListener('click', async () => {
                    if (deleteConfirmPending) {
                        if (deleteConfirmTimer) clearTimeout(deleteConfirmTimer);
                        await deletePack({
                            ownerType: 'savedPoint',
                            ownerId: savedPoint.id,
                        }).catch(error => {
                            reportNonFatal('field-guide-map', 'Saved-point offline pack cleanup failed', error);
                        });
                        await removeSavedPoint(savedPoint.id);
                        return;
                    }
                    deleteConfirmPending = true;
                    deleteButton.style.background = 'rgba(239,68,68,0.15)';
                    deleteButton.style.color = '#f87171';
                    deleteButton.style.borderColor = 'rgba(239,68,68,0.4)';
                    deleteButton.title = 'Tap again to confirm';
                    deleteConfirmTimer = setTimeout(() => {
                        deleteConfirmPending = false;
                        deleteButton.style.background = 'rgba(255,255,255,0.06)';
                        deleteButton.style.color = 'rgba(255,255,255,0.35)';
                        deleteButton.style.borderColor = 'rgba(255,255,255,0.1)';
                        deleteButton.title = 'Delete';
                    }, 3000);
                });

                buttonRow.append(flyButton, deleteButton);
                popupElement.appendChild(buttonRow);

                const popup = new maplibregl.Popup({
                    closeButton: true,
                    closeOnClick: false,
                    offset: 12,
                }).setDOMContent(popupElement);
                const marker = new maplibregl.Marker({
                    element: markerElement,
                    anchor: 'center',
                })
                    .setLngLat([savedPoint.lon, savedPoint.lat])
                    .setPopup(popup)
                    .addTo(map);

                markerElement.addEventListener('click', () => {
                    map.flyTo({
                        center: [savedPoint.lon, savedPoint.lat],
                        zoom: savedPoint.zoom,
                    });
                    callbacksRef.current.onSavedPointClick();
                });
                savedPointMarkersRef.current.push(marker);
            }
        };

        doAdd();
    }, [savedPoints, showSavedPoints]); // eslint-disable-line react-hooks/exhaustive-deps
}
