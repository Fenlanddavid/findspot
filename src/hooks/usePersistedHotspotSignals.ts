import { useEffect, useState } from 'react';
import type { Hotspot } from '../pages/fieldGuideTypes';
import {
    getCellSignals,
    summarisePersistedSignals,
    type PersistedSignalSummary,
} from '../services/findHotspotService';

/** Batch-loads persisted signal summaries for the given hotspots, keyed by
 *  hotspot.id. One DB pass on change; card reads the map synchronously. */
export function usePersistedHotspotSignals(hotspots: Hotspot[]) {
    const [summaries, setSummaries] = useState<Map<string, PersistedSignalSummary>>(new Map());

    // Stable dependency: ids + centers only (avoid re-firing on unrelated re-renders)
    const key = hotspots.map(h => `${h.id}:${h.center[0]},${h.center[1]}`).join('|');

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const next = new Map<string, PersistedSignalSummary>();
            for (const h of hotspots) {
                const records = await getCellSignals(h.center);
                const summary = summarisePersistedSignals(records);
                if (summary) next.set(h.id, summary);
            }
            if (!cancelled) setSummaries(next);
        })();
        return () => { cancelled = true; };
    }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

    return summaries;
}
