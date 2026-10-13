import { useEffect, useRef, useState } from 'react';
import { useFieldGuideContext } from './FieldGuideContext';
import { hillfortDistanceLabel, hillfortStatusLabel } from '../../services/fieldguide/hillfortSpatial';
import type { HillfortContext } from '../../types/hillforts';
import { selectHillfortContextEvidence } from '../../services/fieldguide/landscapeInterpretation/evidenceSalience';
import { hillfortContextNarrative } from '../../services/fieldguide/landscapeInterpretation/narrativeGenerator';

export function HillfortContextReading({ context, onSelect }: { context?: HillfortContext; onSelect?: (id: string) => void }) {
    if (!context || !context.results.length) return null;
    const selected = selectHillfortContextEvidence(context);
    return <div className="space-y-2 text-sm text-white/80" aria-label="Hillfort landscape context">
        <p>{hillfortContextNarrative(context)}</p>
        {selected.map(item => <p key={item.record.id}>
            <button type="button" className="underline text-violet-200 py-2 text-left" onClick={() => onSelect?.(item.record.id)}>{item.record.name} · {item.record.id}</button>
            {` — ${item.record.interpretationStatus || 'identification not recorded'}. ${hillfortDistanceLabel(item.distanceFromCentreM)}.`}
            {item.matches.length > 0 && ' Related heritage source records are linked in the site details; these do not count as independent support.'}
        </p>)}
        <button type="button" className="underline text-violet-200 py-2 text-left" onClick={() => onSelect?.('all')}>View all {context.results.length} hillfort records</button>
    </div>;
}

export function HillfortRecords({ selectedOnly = false }: { selectedOnly?: boolean }) {
    const { hillfortContext: context, selectedHillfortId, selectHillfort, historicLayerVisibility } = useFieldGuideContext();
    const selectedRef = useRef<HTMLDivElement>(null);
    const [showAll, setShowAll] = useState(false);
    useEffect(() => {
        if (!selectedHillfortId) return;
        const scroll = () => selectedRef.current?.scrollIntoView({ block: 'start' });
        const frame = requestAnimationFrame(scroll);
        // Re-align after the existing mobile sheet's expansion transition.
        const timer = window.setTimeout(scroll, 320);
        return () => { cancelAnimationFrame(frame); window.clearTimeout(timer); };
    }, [selectedHillfortId]);
    if (!context || (context.status === 'empty' && context.results.length === 0)) return null;
    const selected = context.results.find(r => r.record.id === selectedHillfortId);
    if (selectedOnly && !selected) return null;
    const metadata = context.metadata;
    return <section className="rounded-xl border border-violet-300/25 p-3 space-y-3" aria-label="Hillfort Atlas records">
        {!selectedOnly && <>
        <div className="flex justify-between gap-3"><h3 className="font-semibold text-violet-200">Hillforts</h3><button type="button" className="min-h-11 px-2 text-sm text-white/80" onClick={() => selectHillfort(null)}>Close list</button></div>
        <p className="text-sm text-white/80">{hillfortStatusLabel(context)}{historicLayerVisibility.hillforts === false ? ' Map layer hidden.' : ''}</p>
        <p className="text-sm text-white/70">Atlas locations provide archaeological context, not site boundaries or permission to detect.</p>
        <div className="max-h-60 overflow-y-auto space-y-1">
            {(showAll ? context.results : context.results.slice(0, 20)).map(item => <button type="button" key={item.record.id}
                aria-pressed={selectedHillfortId === item.record.id} onClick={() => selectHillfort(item.record.id)}
                className="block w-full min-h-11 rounded-lg border border-white/10 px-3 py-2 text-left text-sm text-white hover:bg-white/10">
                {item.record.name} <span className="text-violet-200">{item.record.id}</span>
                <span className="block text-white/60">{item.relationship === 'within_scan' ? 'Recorded location within the scanned area' : 'Surrounding context'} · {hillfortDistanceLabel(item.distanceFromCentreM)}</span>
            </button>)}
        </div>
        {!showAll && context.results.length > 20 && <button type="button" className="min-h-11 text-violet-200 underline" onClick={() => setShowAll(true)}>Show all {context.results.length} records</button>}
        </>}
        {selected && <div ref={selectedRef} className="space-y-2 rounded-xl border border-violet-300/30 bg-slate-900 p-3 text-sm text-white/85" aria-label="Atlas site detail">
            <div className="flex justify-between gap-3"><h4 className="font-bold">{selected.record.name}</h4><button type="button" className="min-h-11 px-2" onClick={() => selectHillfort(null)} aria-label="Close Atlas site detail">Close</button></div>
            <p>Atlas {selected.record.id} · {selected.record.country}</p>
            <p>Atlas locations provide archaeological context, not site boundaries or permission to detect.</p>
            {selected.record.alternativeNames && <p>Also recorded as: {selected.record.alternativeNames}</p>}
            <p>Identification: {selected.record.interpretationStatus || 'Not recorded'}. Data reliability: {selected.record.dataStatus || 'Not recorded'}.</p>
            {selected.record.interpretationComments && <p>{selected.record.interpretationComments}</p>}
            {selected.record.dataComments && <p>{selected.record.dataComments}</p>}
            <p>Recorded classification: {Object.entries(selected.record.classification).filter(([k,v]) => k !== 'Comments' && v === 'Yes').map(([k]) => k).join(', ') || 'Not recorded'}.</p>
            {selected.record.classification.Comments && <p>{selected.record.classification.Comments}</p>}
            <p>Recorded construction dating: {Object.entries(selected.record.dating).filter(([k,v]) => !['Reliability','Comments'].includes(k) && v === 'Yes').map(([k]) => k).join(', ') || 'Not recorded'}.</p>
            <p>Dating reliability: {selected.record.dating.Reliability || 'Not recorded'}.</p>
            {selected.record.dating.Comments && <p>{selected.record.dating.Comments}</p>}
            <p>{selected.relationship === 'within_scan' ? 'Recorded location within the scanned area. This does not establish that the whole monument lies within it.' : 'Recorded location in the surrounding 2 km context area.'} {hillfortDistanceLabel(selected.distanceFromCentreM)}. Location accuracy is not recorded.</p>
            <p>{selected.record.description || 'No description recorded.'}</p>
            {selected.matches.map(match => <p key={`${match.relationship}:${match.sourceId}`}>{match.relationship === 'shared_identifier' ? 'Additional information for' : 'Unresolved possible match to'} NHLE {match.sourceId}. {match.reason}</p>)}
            <p>Protection and permission must be checked separately. An absent or unlinked designation does not mean this site is unprotected.</p>
            <details><summary className="py-2 cursor-pointer">Source identifiers and references</summary>
                {Object.entries(selected.record.identifiers).filter(([,v]) => v).map(([k,v]) => <p key={k}>{k}: {v}</p>)}
                <p>{selected.record.references || 'References not recorded.'}</p>
            </details>
            <a className="inline-block py-3 underline text-violet-200" href={selected.record.recordUrl} target="_blank" rel="noopener noreferrer">Open Atlas record</a>
            <p>External records and linked documents require connectivity; these downloaded details remain available offline.</p>
            <p>{metadata?.attribution}</p>
        </div>}
        {metadata && <details className="text-xs text-white/70"><summary className="py-2 cursor-pointer">Dataset, attribution and limitations</summary>
            <p>{metadata.attribution}</p><p>{metadata.edition} · Archive released {metadata.publicationDate} · Acquired {metadata.acquiredAt}</p>
            <p>{metadata.limitations}</p><p>{metadata.transformations}</p>
            <p>Source: {metadata.sourceLicence}</p><p>Adaptation: {metadata.adaptationLicence}</p>
            <p>{metadata.locationPrecision}</p>
        </details>}
    </section>;
}
