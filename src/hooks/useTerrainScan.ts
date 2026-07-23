import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogLevel, LogSource } from '../utils/scanLogger';
import {
    runTerrainScanPipeline,
    type TerrainScanParams,
    type TerrainScanResult,
} from '../services/fieldguide/terrainScanCoordinator';

export type {
    ScanContext,
    TerrainScanResult,
} from '../services/fieldguide/terrainScanCoordinator';

interface UseTerrainScanOptions {
    onLog:          (msg: string, source?: LogSource, level?: LogLevel) => void;
    onStatusChange: (status: string) => void;
}

export function useTerrainScan({ onLog, onStatusChange }: UseTerrainScanOptions) {
    const [isScanning, setIsScanning] = useState(false);
    const tokenRef = useRef<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const mountedRef = useRef(true);
    const workersRef = useRef<Worker[]>([]);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const cancelScan = useCallback(() => {
        tokenRef.current = null;
        abortRef.current?.abort();
        workersRef.current.forEach(worker => worker.terminate());
        workersRef.current = [];
        if (mountedRef.current) setIsScanning(false);
    }, []);

    const runTerrainScan = useCallback(async (
        params: TerrainScanParams,
    ): Promise<TerrainScanResult | null> => {
        if (!params.mapRef.current) return null;

        abortRef.current?.abort();
        const abort = new AbortController();
        abortRef.current = abort;
        const token = crypto.randomUUID();
        tokenRef.current = token;
        const workerRegistry: Worker[] = [];
        workersRef.current = workerRegistry;

        if (mountedRef.current) setIsScanning(true);
        try {
            return await runTerrainScanPipeline(params, {
                onLog,
                onStatusChange,
                signal: abort.signal,
                workerRegistry,
                isActive: () => (
                    tokenRef.current === token
                    && !abort.signal.aborted
                    && mountedRef.current
                ),
            });
        } finally {
            if (tokenRef.current === token && mountedRef.current) {
                setIsScanning(false);
            }
        }
    }, [onLog, onStatusChange]);

    return {
        runTerrainScan,
        cancelTerrain: cancelScan,
        isTerrainScanning: isScanning,
    };
}
