// ─── Terrain engine — worker spawner ─────────────────────────────────────────
// Each scanDataSource call runs in its own Web Worker (OffscreenCanvas + fetch)
// so the six source types process in parallel without blocking the main thread.

import { Cluster } from '../pages/fieldGuideTypes';
import { WaybackIds } from './waybackService';
import type { WorkerParams } from '../workers/terrainScanWorker';

type SourceType = 'terrain' | 'terrain_global' | 'slope' | 'hydrology' | 'satellite_spring' | 'satellite_summer';

/**
 * Spawn a worker to scan one tile source. The worker fetches tiles, runs the
 * full pixel pipeline, and resolves with the detected clusters.
 *
 * @param workerReg  Optional array; the live Worker is pushed in so the caller
 *                   can terminate() it on cancel before it finishes.
 */
export function scanDataSource(
    sourceType: SourceType,
    zoom: number,
    tX_start: number,
    tY_start: number,
    bounds: { getWest(): number; getEast(): number; getSouth(): number; getNorth(): number },
    n: number,
    _assetsGeoJSON: { features: unknown[] },   // kept for API compatibility — unused
    waybackIds: WaybackIds | null = null,
    workerReg?: Worker[],
): Promise<Cluster[]> {
    return new Promise<Cluster[]>((resolve) => {
        const worker = new Worker(
            new URL('../workers/terrainScanWorker.ts', import.meta.url),
            { type: 'module' },
        );

        if (workerReg) workerReg.push(worker);

        const cleanup = () => {
            if (workerReg) {
                const i = workerReg.indexOf(worker);
                if (i !== -1) workerReg.splice(i, 1);
            }
        };

        worker.onmessage = (e: MessageEvent<Cluster[]>) => {
            cleanup();
            resolve(e.data);
            worker.terminate();
        };

        worker.onerror = () => {
            cleanup();
            resolve([]);
            worker.terminate();
        };

        const params: WorkerParams = {
            sourceType,
            zoom,
            tX_start,
            tY_start,
            bounds: {
                west:  bounds.getWest(),
                east:  bounds.getEast(),
                south: bounds.getSouth(),
                north: bounds.getNorth(),
            },
            n,
            waybackIds,
        };

        worker.postMessage(params);
    });
}
