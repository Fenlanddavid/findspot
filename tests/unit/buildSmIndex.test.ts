import { describe, expect, it } from 'vitest';

const sharedGeometry = {
    type: 'Polygon',
    coordinates: [[
        [-3.0005, 55.0005],
        [-2.9995, 55.0005],
        [-2.9995, 55.0015],
        [-3.0005, 55.0015],
        [-3.0005, 55.0005],
    ]],
};

describe('build-sm-index buildIndex', () => {
    it('resolves HES OGL attribution to the supplied build year', async () => {
        const { hesAttribution } = await import('../../scripts/build-sm-index.mjs');

        expect(hesAttribution(2026)).toBe('Contains Historic Environment Scotland and OS data © Historic Environment Scotland and Crown Copyright and [database right] 2026, licensed under the Open Government Licence v3.0');
    });

    it('keeps one feature from each source in the same shard cell', async () => {
        const { buildIndex } = await import('../../scripts/build-sm-index.mjs');

        const result = buildIndex([
            {
                source: 'NHLE',
                features: [{
                    geometry: sharedGeometry,
                    properties: { ListEntry: '1000001', Name: 'English SM' },
                }],
            },
            {
                source: 'Cadw',
                features: [{
                    geometry: sharedGeometry,
                    properties: { SAMNumber: 'GM001', Name: 'Welsh SAM' },
                }],
            },
            {
                source: 'HES',
                features: [{
                    geometry: sharedGeometry,
                    properties: { DES_REF: 'SM1001', DES_TITLE: 'Scottish SM' },
                }],
            },
        ]);

        for (const entries of result.index.values()) {
            expect(entries.map(entry => entry.listEntry).sort()).toEqual(['1000001', 'GM001', 'SM1001']);
        }
        expect(result.skipped).toBe(0);
    });

    it('reports bare numeric HES identifiers without dropping the feature', async () => {
        const { buildIndex } = await import('../../scripts/build-sm-index.mjs');

        const result = buildIndex([
            {
                source: 'NHLE',
                features: [{
                    geometry: sharedGeometry,
                    properties: { ListEntry: '1234', Name: 'English SM' },
                }],
            },
            {
                source: 'HES',
                features: [{
                    geometry: sharedGeometry,
                    properties: { DES_REF: '1234', DES_TITLE: 'Scottish SM' },
                }],
            },
        ]);

        const entries = [...result.index.values()][0];
        expect(entries.filter(entry => entry.listEntry === '1234')).toHaveLength(2);
        expect(result.hesDigitIds).toBe(1);
    });
});
