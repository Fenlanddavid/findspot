import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogLevel, LogSource } from '../utils/scanLogger';
import { SCAN_CONFIG } from '../utils/scanConfig';
import {
    runHistoricScanPipeline,
    type HistoricScanOptions,
    type HistoricScanResult,
} from '../services/fieldguide/historicScanCoordinator';

export type {
    HistoricScanOptions,
    HistoricScanResult,
} from '../services/fieldguide/historicScanCoordinator';

interface UseHistoricScanOptions {
    onLog:          (msg: string, source?: LogSource, level?: LogLevel) => void;
    onStatusChange: (status: string) => void;
}

export function useHistoricScan({ onLog, onStatusChange }: UseHistoricScanOptions) {
    const [isScanning, setIsScanning] = useState(false);
    const tokenRef = useRef<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const cancelScan = useCallback(() => {
        tokenRef.current = null;
        abortRef.current?.abort();
        if (mountedRef.current) setIsScanning(false);
    }, []);

    const runHistoricScan = useCallback(async (
        options: HistoricScanOptions,
    ): Promise<HistoricScanResult | null> => {
        const map = options.mapRef.current;
        if (!map) return null;
        if (map.getZoom() < SCAN_CONFIG.MIN_HISTORIC_ZOOM) {
            onLog(
                `> ZOOM IN: Historic scan works best at zoom ${SCAN_CONFIG.MIN_HISTORIC_ZOOM}+.`,
                'historic',
                'warn',
            );
            return null;
        }

        abortRef.current?.abort();
        const abort = new AbortController();
        abortRef.current = abort;
        const token = crypto.randomUUID();
        tokenRef.current = token;

        if (mountedRef.current) setIsScanning(true);
        try {
            return await runHistoricScanPipeline(options, {
                onLog,
                onStatusChange,
                signal: abort.signal,
                isActive: () => (
                    tokenRef.current === token
                    && !abort.signal.aborted
                    && mountedRef.current
                ),
            });
        } finally {
            if (mountedRef.current) onStatusChange('');
            if (tokenRef.current === token && mountedRef.current) {
                setIsScanning(false);
            }
        }
    }, [onLog, onStatusChange]);

    return {
        runHistoricScan,
        cancelHistoric: cancelScan,
        isHistoricScanning: isScanning,
    };
}
