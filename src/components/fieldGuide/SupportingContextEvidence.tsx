import type { SupportingContextSummary } from '../../services/fieldguide/supportingContext';

export function SupportingContextEvidence({ summary }: { summary: SupportingContextSummary }) {
    const scheduledOverlap = summary.recordedHeritage.some(record => record.source === 'nhle'
        && ['contains_scan_centre', 'intersects_scan'].includes(record.relationship));
    return <div className="space-y-3 text-xs text-white/75">
        {scheduledOverlap && <div role="alert" className="rounded-xl border border-red-400/35 bg-red-500/10 p-3 space-y-1 text-red-100">
            <p className="font-bold">Scheduled monument overlap</p>
            <p>A scheduled monument boundary overlaps this scan footprint. Protection applies within the mapped boundary. Check current official protections and required consent before any fieldwork.</p>
        </div>}
        <div className="grid grid-cols-3 gap-2 text-center">
            {[['Sites', summary.recordedHeritage.length], ['Routes', summary.historicRoutes.length], ['Names', summary.environment.placeNames.length]].map(([label, count]) =>
                <div key={label} className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-2">
                    <span className="block text-base font-black text-blue-300">{count}</span>
                    <span className="text-[0.625rem] font-bold uppercase">{label}</span>
                </div>)}
        </div>
        <div className="space-y-2 border-t border-white/10 pt-3">
            {summary.historicRoutes.map(route => <p key={route.id}>{route.explanation}</p>)}
            {summary.lines.map(line => <p key={line}>{line}</p>)}
        </div>
        <div className="space-y-2 border-t border-white/10 pt-3">
            <p className="font-bold uppercase">Source limitations</p>
            {summary.coverage.limitations.map(line => <p key={line}>{line}</p>)}
        </div>
    </div>;
}

export function RecordedHeritageDetails({ summary }: { summary: SupportingContextSummary }) {
    if (!summary.recordedHeritage.length) return null;
    const spatialLabels = {
        contains_scan_centre: 'Mapped geometry contains the scan centre',
        intersects_scan: 'Mapped geometry intersects the scan footprint',
        point_within_scan: 'Recorded point within the scan footprint; extent unknown',
        nearby: 'Nearby; outside the scan footprint',
        query_extent: 'Returned in the broader query extent; overlap not established',
    };
    return <div className="space-y-2 text-xs text-white/75">
        <p className="font-bold uppercase">Recorded heritage context</p>
        {summary.recordedHeritage.map(record => <div key={record.id} className="rounded-xl bg-blue-500/5 border border-blue-500/15 p-3 space-y-1">
            <p className="font-bold">{'objectType' in record.feature ? record.feature.objectType : 'Name' in record.feature.properties ? record.feature.properties.Name : record.recordType}</p>
            <p>{record.source.toUpperCase()} · {record.recordType}{record.period ? ` · ${record.period}` : ''}</p>
            <p className="text-white/50">{record.id}</p>
            <p>{record.geometryBasis === 'bounding_box' ? 'Aerial mapping index extent only; the mapped monument boundary is not supplied.' : record.geometryBasis === 'unknown' ? 'Geometry detail is unknown; a mapped monument boundary is not confirmed.' : spatialLabels[record.relationship]}</p>
            {record.uncertainty && <p>{record.uncertainty}</p>}
        </div>)}
    </div>;
}
