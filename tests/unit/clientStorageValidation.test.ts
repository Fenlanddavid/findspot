import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { getDurableSetting, isDurableSettingValue } from '../../src/services/clientStorage';
import { db } from '../../src/db';
import { DEFAULT_RASTER_OVERLAY_OPACITY } from '../../src/services/fieldguide/rasterOverlaySettings';

describe('durable client setting validation', () => {
    it('rejects same-primitive but invalid enum values', () => {
        expect(isDurableSettingValue('findRecordMode', 'quick')).toBe(true);
        expect(isDurableSettingValue('findRecordMode', 'unexpected')).toBe(false);
        expect(isDurableSettingValue('fs_discover_radius', 25)).toBe(true);
        expect(isDurableSettingValue('fs_discover_radius', 30)).toBe(false);
        expect(isDurableSettingValue('fs_fg_default_map_style', 'streets')).toBe(true);
        expect(isDurableSettingValue('fs_fg_default_map_style', 'satellite')).toBe(true);
        expect(isDurableSettingValue('fs_fg_default_map_style', 'terrain')).toBe(false);
        expect(isDurableSettingValue('fs_companion_active_session', 'session-1')).toBe(true);
        expect(isDurableSettingValue('fs_companion_active_session', null)).toBe(false);
        expect(isDurableSettingValue('fs_companion_pending_command', null)).toBe(true);
        expect(isDurableSettingValue('fs_companion_pending_command', {
            action: 'stop', sessionId: 'session-1', requestedAt: 1, finishAfterImport: true,
        })).toBe(true);
        expect(isDurableSettingValue('fs_companion_pending_command', {
            action: 'stop', sessionId: 'session-1', requestedAt: 1,
        })).toBe(false);
    });

    it('validates structured settings before they reach UI consumers', () => {
        expect(isDurableSettingValue('fs_going_events', ['event-1'])).toBe(true);
        expect(isDurableSettingValue('fs_going_events', [7])).toBe(false);
        expect(isDurableSettingValue('fs_fg_overlay_opacity', {
            lidar: 1,
            'lidar-wales': 0.8,
            os1880: 0.5,
            os1930: 0,
        })).toBe(true);
        expect(isDurableSettingValue('fs_fg_overlay_opacity', { lidar: 'opaque' })).toBe(false);
    });

    it('adds Scotland opacity to previously saved overlay preferences', async () => {
        const legacy = { lidar: 0.4, 'lidar-wales': 0.8, relief: 1, os1880: 0.5, os1930: 0 };
        await db.settings.put({ key: 'fs_fg_overlay_opacity', value: legacy });
        try {
            const value = await getDurableSetting('fs_fg_overlay_opacity', DEFAULT_RASTER_OVERLAY_OPACITY);
            expect(value).toEqual({ ...legacy, 'lidar-scotland': 1 });
            expect((await db.settings.get('fs_fg_overlay_opacity'))?.value).toEqual(value);
        } finally {
            await db.settings.delete('fs_fg_overlay_opacity');
        }
    });
});
