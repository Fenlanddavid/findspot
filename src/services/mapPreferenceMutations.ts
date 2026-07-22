import { db } from '../db';

export type MapStylePreference = 'streets' | 'satellite';
export type FieldGuideViewMode = 'glance' | 'detail';

export async function saveLocationMapPreferences(
  mapStyle: MapStylePreference,
  showLidar: boolean,
): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    await db.settings.put({ key: 'mapStyle', value: mapStyle });
    await db.settings.put({ key: 'showLidar', value: showLidar });
  });
}

export async function saveFindMapStyle(mapStyle: MapStylePreference): Promise<void> {
  await db.settings.put({ key: 'searchMapStyle', value: mapStyle });
}

export async function saveFieldGuideViewMode(viewMode: FieldGuideViewMode): Promise<void> {
  await db.settings.put({ key: 'fieldGuideViewMode', value: viewMode });
}
