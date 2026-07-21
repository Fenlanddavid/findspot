import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { isDurableSettingValue } from '../../src/services/clientStorage';

describe('durable client setting validation', () => {
    it('rejects same-primitive but invalid enum values', () => {
        expect(isDurableSettingValue('findRecordMode', 'quick')).toBe(true);
        expect(isDurableSettingValue('findRecordMode', 'unexpected')).toBe(false);
        expect(isDurableSettingValue('fs_discover_radius', 25)).toBe(true);
        expect(isDurableSettingValue('fs_discover_radius', 30)).toBe(false);
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
});
