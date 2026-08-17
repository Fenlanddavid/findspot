import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('startup performance architecture', () => {
  it('keeps Home permission enrichment independent of raw GPS tracks and Turf', async () => {
    const source = await readFile(
      new URL('../../src/services/permissions.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain('db.tracks');
    expect(source).not.toContain('calculateCoverage');
    expect(source).not.toContain('@turf/');
  });

  it('does not run global hotspot outcome resolution during application launch', async () => {
    const source = await readFile(new URL('../../src/App.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('refreshHotspotPredictionOutcomes');
    expect(source).not.toContain('aggregateAndSweepHotspotPredictions');
    expect(source).toContain("where('derivationStatus').equals('pending')");
  });

  it('keeps V5 Home selection project-indexed and out of global session scans', async () => {
    const [homePage, homeContext] = await Promise.all([
      readFile(new URL('../../src/pages/Home.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/services/home/homeContext.ts', import.meta.url), 'utf8'),
    ]);
    expect(homePage).not.toContain('db.sessions.toArray()');
    expect(homeContext).not.toContain('db.sessions.toArray()');
    expect(homeContext).toContain("sessions.where('projectId').equals(projectId)");
  });

  it('does not scan Field Guide caches or offline packs on Home', async () => {
    const source = await readFile(new URL('../../src/pages/Home.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('getPackMeta');
    expect(source).not.toContain('fieldGuideCache');
    expect(source).not.toContain('runGeologyContext');
  });

  it('renders Home before progressive continuity has resolved', async () => {
    const source = await readFile(new URL('../../src/pages/Home.tsx', import.meta.url), 'utf8');
    const readinessLine = source.split('\n').find(line => line.includes('homePresentationReady')) ?? '';
    expect(readinessLine).not.toContain('continuityItem');
  });

  it('keeps the V5 page ratchets at or below their recorded baselines', async () => {
    const [home, session] = await Promise.all([
      readFile(new URL('../../src/pages/Home.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/pages/Session.tsx', import.meta.url), 'utf8'),
    ]);
    expect(home.split('\n').length - 1).toBeLessThanOrEqual(1033);
    expect(session.split('\n').length - 1).toBeLessThanOrEqual(1746);
  });

  it('keeps V5 context and review services React-free', async () => {
    const sources = await Promise.all([
      '../../src/services/home/homeContext.ts',
      '../../src/services/continuity/continuityResolver.ts',
      '../../src/services/session/activeSessionContext.ts',
      '../../src/services/session/sessionReview.ts',
      '../../src/services/session/sessionActivity.ts',
      '../../src/services/session/sessionFieldPosition.ts',
    ].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
    for (const source of sources) {
      expect(source).not.toContain("from 'react'");
      expect(source).not.toContain('from "react"');
    }
  });

  it('demand-mounts and disposes the active-session map outside the Map tab', async () => {
    const [session, mapHook, mapLayersHook] = await Promise.all([
      readFile(new URL('../../src/pages/Session.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/hooks/useSessionMap.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/hooks/useSessionMapLayers.ts', import.meta.url), 'utf8'),
    ]);
    expect(session).toContain("enabled: !isActiveSessionMode || workspaceTab === 'map'");
    expect(mapHook).toContain('if (!enabled)');
    expect(mapHook).toContain('mapRef.current?.remove()');
    expect(mapHook).toContain('createFieldGuideMapStyle(mapLayers.control.isSatellite)');
    expect(mapHook).toContain('registerRomanStandaloneLayers(map)');
    expect(mapHook).toContain('initialFitCompleteRef');
    expect(mapHook).toContain('viewportRef');
    expect(mapHook).toContain("map.on('dragstart', () => setIsFollowing(false))");
    expect(mapLayersHook).not.toContain('useFieldGuideHistoricLayers');
  });

  it('commits session completion before review and offers review before coverage enrichment', async () => {
    const source = await readFile(new URL('../../src/pages/Session.tsx', import.meta.url), 'utf8');
    const finish = source.indexOf('await finishSessionRecord(sessionId, endTimeIso)');
    const review = source.indexOf('await getSessionReview(sessionId)', finish);
    const showReview = source.indexOf('setShowSummary(true)', finish);
    const coverage = source.indexOf('prepareSessionSearchedAreas(sessionId)', finish);
    expect(finish).toBeGreaterThan(-1);
    expect(review).toBeGreaterThan(finish);
    expect(showReview).toBeGreaterThan(review);
    expect(coverage).toBeGreaterThan(showReview);
  });
});
