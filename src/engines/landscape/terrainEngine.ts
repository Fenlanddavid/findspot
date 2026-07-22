// ─── Terrain engine — worker spawner ─────────────────────────────────────────
// Each scanDataSource call runs in its own Web Worker (OffscreenCanvas + fetch)
// so the six source types process in parallel without blocking the main thread.

import { Cluster } from '../../pages/fieldGuideTypes';
import { WaybackIds } from '../../utils/waybackService';
import type { WorkerParams, WorkerResult } from '../../workers/terrainScanWorker';
import { runWorkerRequest } from '../../workers/client';
import { createTerrainScanWorker } from '../../workers/factory';

type SourceType = 'terrain' | 'terrain_global' | 'slope' | 'hydrology' | 'satellite_spring' | 'satellite_summer';
const TERRAIN_WORKER_TIMEOUT_MS = 30_000;

function decodeLegacyTerrainResponse(value: unknown): WorkerResult | undefined {
    if (Array.isArray(value)) {
        const clusters = value as Cluster[];
        return { clusters, tilesLoaded: clusters.length > 0 ? 1 : 0 };
    }
    if (
        typeof value === 'object' && value !== null &&
        Array.isArray((value as WorkerResult).clusters) &&
        typeof (value as WorkerResult).tilesLoaded === 'number'
    ) {
        return value as WorkerResult;
    }
    return undefined;
}

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
    signal?: AbortSignal,
): Promise<WorkerResult> {
    let liveWorker: Worker | undefined;
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

    return runWorkerRequest<WorkerParams, WorkerResult>({
        createWorker: createTerrainScanWorker,
        payload: params,
        signal,
        timeoutMs: TERRAIN_WORKER_TIMEOUT_MS,
        decodeLegacyResponse: decodeLegacyTerrainResponse,
        onWorkerCreated: worker => {
            liveWorker = worker;
            workerReg?.push(worker);
        },
    }).catch(() => ({ clusters: [], tilesLoaded: 0 })).finally(() => {
        if (!workerReg || !liveWorker) return;
        const index = workerReg.indexOf(liveWorker);
        if (index !== -1) workerReg.splice(index, 1);
    });
}
