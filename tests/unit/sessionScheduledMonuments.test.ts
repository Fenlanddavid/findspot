import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { resolveSMCoverage, type NHLEResponse } from '../../src/services/historicScanService';
import {
  resolveScheduledMonumentMapCoverage,
  scheduledMonumentPopupText,
  type ScheduledMonumentMapCoverage,
} from '../../src/services/session/sessionScheduledMonuments';
import {
  scheduledMonumentCoverageForm,
  scheduledMonumentCoverageShortText,
  scheduledMonumentCoverageText,
} from '../../src/components/session/ScheduledMonumentCoverageLine';

const ENGLAND: [number, number, number, number] = [-0.132, 51.503, -0.122, 51.513];
const WALES: [number, number, number, number] = [-3.185, 51.477, -3.175, 51.487];
const SCOTLAND: [number, number, number, number] = [-3.191, 55.944, -3.181, 55.954];
const NORTHERN_IRELAND: [number, number, number, number] = [-5.935, 54.592, -5.925, 54.602];
const BORDER: [number, number, number, number] = [-2.795, 55.417, -2.785, 55.427];
const OUTSIDE_UK: [number, number, number, number] = [1.848, 50.947, 1.858, 50.957];

const DATASET = {
  builtAt: '2026-08-29T00:00:00.000Z',
  coverage: ['england', 'wales'],
  sources: ['NHLE', 'Cadw'],
};

const READY_COVERED: ScheduledMonumentMapCoverage = {
  status: 'ready',
  classification: 'covered',
  unavailableReason: null,
  coveredNations: ['england', 'wales'],
  missingNations: [],
  renderedFeatureCount: 0,
  dataset: DATASET,
};

describe('scheduled-monument map coverage', () => {
  it('maps bboxes to covered, partial, and every unavailable reason', () => {
    expect(resolveSMCoverage(ENGLAND, ['england', 'wales'])).toMatchObject({
      classification: 'covered', unavailableReason: null,
    });
    expect(resolveSMCoverage(SCOTLAND, ['england', 'wales'])).toMatchObject({
      classification: 'uncovered', unavailableReason: 'coverage_scotland',
    });
    expect(resolveSMCoverage(NORTHERN_IRELAND, ['england', 'wales', 'scotland'])).toMatchObject({
      classification: 'uncovered', unavailableReason: 'coverage_ni',
    });
    expect(resolveSMCoverage(BORDER, ['england', 'wales'])).toMatchObject({
      classification: 'partial', unavailableReason: 'coverage_border',
    });
    expect(resolveSMCoverage(WALES, ['england'])).toMatchObject({
      classification: 'partial', unavailableReason: 'coverage_incomplete',
    });
    expect(resolveSMCoverage(OUTSIDE_UK, ['england', 'wales', 'scotland'])).toMatchObject({
      classification: 'uncovered', unavailableReason: 'coverage_outside_uk',
    });
  });

  it('classifies fetch errors and cache misses as explicit unavailable states', () => {
    const error = resolveScheduledMonumentMapCoverage(ENGLAND, {
      features: [], available: false, error: 'parse failed',
    });
    const notCached = resolveScheduledMonumentMapCoverage(ENGLAND, {
      features: [], available: false, cacheComplete: false, error: 'cache miss',
    });

    expect(error).toMatchObject({ status: 'error', classification: 'uncovered' });
    expect(notCached).toMatchObject({ status: 'not_cached', classification: 'uncovered' });
    expect(scheduledMonumentCoverageText(error)).toContain('Scheduled Monument Check Unavailable');
    expect(scheduledMonumentCoverageText(notCached)).toContain('Data not downloaded for this area');
  });

  it('states source, data date, covered jurisdiction, and reviewed partial-coverage title', () => {
    const response: NHLEResponse = {
      features: [],
      available: false,
      cacheComplete: true,
      dataset: DATASET,
      unavailableReason: 'coverage_border',
    };
    const text = scheduledMonumentCoverageText(resolveScheduledMonumentMapCoverage(BORDER, response));

    expect(text).toContain('NHLE, Cadw');
    expect(text).toContain('data 29 Aug 2026');
    expect(text).toContain('England and Wales coverage');
    expect(text).toContain('Near the Scotland Border');
    expect(text).not.toMatch(/\b(?:clear|safe|outside)\b/i);
  });

  it('uses short form only for a ready, fully covered state without an unavailable reason', () => {
    expect(scheduledMonumentCoverageForm(READY_COVERED)).toBe('short');
    for (const status of ['loading', 'not_cached', 'error'] as const) {
      expect(scheduledMonumentCoverageForm({ ...READY_COVERED, status })).toBe('full');
    }
    for (const unavailableReason of [
      'coverage_scotland',
      'coverage_ni',
      'coverage_border',
      'coverage_incomplete',
      'coverage_outside_uk',
    ] as const) {
      expect(scheduledMonumentCoverageForm({ ...READY_COVERED, unavailableReason })).toBe('full');
    }
    expect(scheduledMonumentCoverageForm({
      ...READY_COVERED,
      classification: 'partial',
    })).toBe('full');
  });

  it('shortens current-year dates, retains stale years, and omits coverage language', () => {
    const currentYear = new Date().getUTCFullYear();
    const current = scheduledMonumentCoverageShortText({
      ...READY_COVERED,
      dataset: { ...DATASET, builtAt: `${currentYear}-08-12T00:00:00.000Z` },
    });
    const stale = scheduledMonumentCoverageShortText({
      ...READY_COVERED,
      dataset: { ...DATASET, builtAt: `${currentYear - 1}-08-12T00:00:00.000Z` },
    });

    expect(current).toBe('Scheduled monuments · NHLE, Cadw · 12 Aug');
    expect(current).not.toMatch(/England|Wales|coverage/i);
    expect(stale).toBe(`Scheduled monuments · NHLE, Cadw · 12 Aug ${currentYear - 1}`);
    expect(scheduledMonumentCoverageShortText({ ...READY_COVERED, dataset: undefined }))
      .toBe('Scheduled monuments · NHLE, Cadw · data date unavailable');
  });

  it('labels a tapped polygon without making an in/out claim', () => {
    expect(scheduledMonumentPopupText({ Name: 'Castle Hill' })).toBe('Scheduled monument · Castle Hill');
    expect(scheduledMonumentPopupText({})).toBe('Scheduled monument');
  });

  it('keeps the map path cache-only, always-on, simply inspectable, and readable', async () => {
    const [mapHook, session, activeWorkspace, offlinePack, picker, line] = await Promise.all([
      readFile(new URL('../../src/hooks/useSessionMap.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/pages/Session.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/components/session/ActiveSessionWorkspace.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/services/offlinePack.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/components/session/SessionMapLayerPicker.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/components/session/ScheduledMonumentCoverageLine.tsx', import.meta.url), 'utf8'),
    ]);

    expect(mapHook).toContain("map.addSource('scheduled-monuments'");
    expect(mapHook).toContain("id: 'scheduled-monuments-fill'");
    expect(mapHook).toContain("id: 'scheduled-monuments-soft-edge'");
    expect(mapHook).not.toContain("id: 'scheduled-monument-buffer-fill'");
    expect(mapHook).not.toContain("id: 'scheduled-monument-buffer-outline'");
    expect(mapHook).not.toContain('scheduled-monument-buffers');
    expect(mapHook).not.toContain('buildMonumentBufferGeoJSON');
    expect(mapHook).toContain("'fill-opacity': 0.56");
    expect(mapHook).toContain("'line-color': '#dc2626'");
    expect(mapHook).toContain("'line-opacity': 0.46");
    const monumentLayers = mapHook.slice(
      mapHook.indexOf("id: 'scheduled-monuments-fill'"),
      mapHook.indexOf("map.addSource('boundary'"),
    );
    expect(monumentLayers).not.toContain("'fill-outline-color'");
    expect(mapHook).toContain('cacheOnly: true');
    expect(mapHook).toContain('allowPartialCoverage: true');
    expect(session).toContain('ensureScheduledMonumentMapCache');
    expect(session).toContain('scheduledMonumentCacheVersion');
    expect(session).toContain('scheduledMonumentCachePreparing');
    expect(session).toContain('<ScheduledMonumentCoverageLine state={scheduledMonumentCoverage} />');
    expect(activeWorkspace).toContain('<ScheduledMonumentCoverageLine state={props.scheduledMonumentCoverage} />');
    expect(offlinePack).toContain('Quietly prepares only the scheduled-monument index');
    expect(offlinePack).not.toContain('ensureScheduledMonumentMapCache(owner: PackOwner, onProgress');
    expect(picker).not.toMatch(/scheduled monument/i);
    expect(line).toContain('data-testid="scheduled-monument-coverage"');
    expect(line).toContain('scheduledMonumentCoverageForm(state)');
    expect(line).toContain('data-coverage-form="short"');
    expect(line).not.toContain('<button');
    expect(line).not.toContain('useState');
    expect(line).toContain('text-xs');
    expect(line).toContain('scheduled-monument-map-key');
    expect(line).not.toContain('rounded bg-white');
    expect(line).not.toMatch(/\btext-(?:2xs|3xs)\b/);
  });
});
