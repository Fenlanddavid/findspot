import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db';
import { geologyAuditWarning } from '../../src/engines/geologyContext/geologyAudit';
import { runGeologyContext } from '../../src/engines/geologyContext';
import type { GeologyAuditEntry } from '../../src/engines/geologyContext/geologyContextTypes';

describe('geology diagnostics integrity', () => {
  beforeEach(async () => {
    await db.open();
    await db.geologyContext.clear();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await db.geologyContext.clear();
  });

  it('audits a rejected fetch as a request failure and surfaces the warning', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Network unavailable');
    }));
    const audit: GeologyAuditEntry[] = [];

    await expect(runGeologyContext(
      { lat: 52.2053, lon: 0.1218 },
      { onAudit: entry => audit.push(entry) },
    )).resolves.toBeNull();

    expect(audit).toEqual([
      expect.objectContaining({ action: 'request_fail' }),
    ]);
    expect(geologyAuditWarning(audit[0]))
      .toBe('BGS geology unavailable via proxy. Scan unaffected.');
  });

  it('honours a cached empty tile without fetching it again within the TTL', async () => {
    const root = {
      localName: 'FeatureCollection',
      nodeName: 'FeatureCollection',
      textContent: '',
      children: [],
      attributes: { length: 0 },
    };
    vi.stubGlobal('NodeFilter', { SHOW_ELEMENT: 1 });
    vi.stubGlobal('DOMParser', class {
      parseFromString() {
        return {
          documentElement: root,
          getElementsByTagName: () => [],
          createTreeWalker: () => ({
            currentNode: root,
            nextNode: () => null,
          }),
        };
      }
    });
    const fetchSpy = vi.fn(async () => new Response(
      '<?xml version="1.0"?><FeatureCollection/>',
      { status: 200, headers: { 'Content-Type': 'application/vnd.ogc.gml' } },
    ));
    vi.stubGlobal('fetch', fetchSpy);

    await expect(runGeologyContext({ lat: 52.1, lon: 0.1 })).resolves.toBeNull();
    await expect(runGeologyContext({ lat: 52.1, lon: 0.1 })).resolves.toBeNull();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
