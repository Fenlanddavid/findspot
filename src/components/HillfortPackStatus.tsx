import { useEffect, useState } from 'react';
import { hasCachedHillfortDataset } from '../services/hillfortService';
import type { PackMeta } from '../services/offlinePack';

/** Mount only in an explicitly opened pack management surface, never Home. */
export function HillfortPackStatus({ meta }: { meta: PackMeta }) {
    const [available, setAvailable] = useState<boolean | null>(null);
    useEffect(() => {
        let active = true;
        if (meta.layers.hillforts !== 'cached') { setAvailable(false); return; }
        void hasCachedHillfortDataset().then(value => { if (active) setAvailable(value); }).catch(() => { if (active) setAvailable(false); });
        return () => { active = false; };
    }, [meta]);
    return <p className="text-xs py-2 text-gray-500 dark:text-gray-400">{available === null ? 'Checking downloaded hillfort context…' : available ? 'Complete hillfort context downloaded, including surrounding records and source details.' : 'Hillfort context not downloaded or evicted. Refresh this pack to include it.'}</p>;
}
