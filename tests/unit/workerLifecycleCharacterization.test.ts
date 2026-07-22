import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scanDataSource } from '../../src/engines/landscape/terrainEngine';
import type { WorkerParams, WorkerResult } from '../../src/workers/terrainScanWorker';

class CharacterizationWorker {
  static instances: CharacterizationWorker[] = [];

  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly posted: unknown[] = [];
  terminated = false;

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    CharacterizationWorker.instances.push(this);
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }

  emitError(): void {
    this.onerror?.({ message: 'worker failed' } as ErrorEvent);
  }
}

const bounds = {
  getWest: () => -0.2,
  getEast: () => 0.2,
  getSouth: () => 51.9,
  getNorth: () => 52.1,
};

describe('worker lifecycle characterization', () => {
  beforeEach(() => {
    CharacterizationWorker.instances = [];
    vi.stubGlobal('Worker', CharacterizationWorker);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('posts the terrain request and cleans up after a structured result', async () => {
    const registry: Worker[] = [];
    const resultPromise = scanDataSource(
      'terrain', 16, 100, 200, bounds, 65_536, { features: [] }, null, registry,
    );
    const worker = CharacterizationWorker.instances[0];

    expect(worker.options).toEqual({ type: 'module' });
    expect(worker.posted).toEqual([{
      sourceType: 'terrain',
      zoom: 16,
      tX_start: 100,
      tY_start: 200,
      bounds: { west: -0.2, east: 0.2, south: 51.9, north: 52.1 },
      n: 65_536,
      waybackIds: null,
    } satisfies WorkerParams]);
    expect(registry).toHaveLength(1);

    const expected: WorkerResult = { clusters: [], tilesLoaded: 4 };
    worker.emitMessage(expected);

    await expect(resultPromise).resolves.toEqual(expected);
    expect(registry).toEqual([]);
    expect(worker.terminated).toBe(true);
  });

  it('normalizes the legacy cluster-array response', async () => {
    const resultPromise = scanDataSource(
      'slope', 16, 100, 200, bounds, 65_536, { features: [] }, null,
    );
    const worker = CharacterizationWorker.instances[0];
    const legacyClusters = [{ id: 'legacy-cluster' }];

    worker.emitMessage(legacyClusters);

    await expect(resultPromise).resolves.toEqual({
      clusters: legacyClusters,
      tilesLoaded: 1,
    });
    expect(worker.terminated).toBe(true);
  });

  it('turns a terrain worker failure into an empty recoverable result', async () => {
    const registry: Worker[] = [];
    const resultPromise = scanDataSource(
      'hydrology', 16, 100, 200, bounds, 65_536, { features: [] }, null, registry,
    );
    const worker = CharacterizationWorker.instances[0];

    worker.emitError();

    await expect(resultPromise).resolves.toEqual({ clusters: [], tilesLoaded: 0 });
    expect(registry).toEqual([]);
    expect(worker.terminated).toBe(true);
  });
});
