import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { pagePersistence } from '../services/pagePersistence';
import { collectionFactFields, type CollectionItem } from '../services/collectionModels';
import { collectionFacts, collectionSourceFingerprint } from '../services/collections';
import { FindPhoto } from './FindPhoto';

export function CollectionObject({ projectId, item, editing, onChange, onOpen }: { projectId: string; item: CollectionItem; editing: boolean; onChange: (item: CollectionItem) => void; onOpen: (id: string) => void }) {
  const find = useLiveQuery(async () => { const row = await pagePersistence.finds.get(item.findId); return row?.projectId === projectId ? row : null; }, [projectId, item.findId]);
  const photos = useLiveQuery(() => pagePersistence.media.where('findId').equals(item.findId).filter(row => row.projectId === projectId && row.type === 'photo').toArray(), [projectId, item.findId]);
  const { selectedMediaIds, selectedFactFields } = item;
  const [fingerprint, setFingerprint] = useState('');
  const [reviewError, setReviewError] = useState('');
  useEffect(() => {
    let active = true; setFingerprint('');
    if (find && photos) void collectionSourceFingerprint(find, { selectedMediaIds, selectedFactFields }, photos).then(value => { if (active) setFingerprint(value); }).catch(() => { if (active) setReviewError('Could not check photographs. Try reopening this collection.'); });
    return () => { active = false; };
  }, [find, photos, selectedFactFields, selectedMediaIds]);
  if (!find) return <div className="space-y-3 p-4"><p>Source find unavailable. Edit the collection to remove this item or relink its source find.</p>{item.displayTitle && <h2 className="break-words font-serif text-2xl">{item.displayTitle}</h2>}{item.caption && <p className="whitespace-pre-wrap break-words">{item.caption}</p>}</div>;
  const changed = fingerprint && item.sourceFingerprintWhenReviewed && fingerprint !== item.sourceFingerprintWhenReviewed;
  const title = item.displayTitle || find.objectType || 'Unidentified find';
  return <div className="space-y-4">
    <div className={`grid gap-3 ${item.selectedMediaIds.length > 1 ? 'sm:grid-cols-2' : 'sm:grid-cols-1'}`}>{item.selectedMediaIds.map(id => <FindPhoto projectId={projectId} key={id} findId={item.findId} mediaId={id} crop={item.cropSettings?.[id]} className="aspect-[4/3] rounded-xl" />)}{!item.selectedMediaIds.length && <div className="flex aspect-[4/3] items-center justify-center rounded-xl bg-stone-100 text-stone-600">No photograph selected</div>}</div>
    <h2 className="break-words font-serif text-2xl">{title}</h2>
    <dl className="flex flex-wrap gap-x-5 gap-y-2 break-words text-sm">{collectionFacts(find, item.selectedFactFields).map(fact => <div key={fact.label}><dt className="text-stone-500 dark:text-stone-400">{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
    {item.interpretationStatus && <p className="text-sm">Interpretation: {item.interpretationStatus === 'tentative' ? 'Tentative' : 'User considers supported'}</p>}
    {item.caption && <p className="whitespace-pre-wrap break-words leading-relaxed">{item.caption}</p>}
    {changed && <p role="status" className="rounded-lg bg-amber-100 p-3 text-amber-900">Selected source details or photographs changed since your last review. Your caption is unchanged.</p>}
    {reviewError && <p role="alert">{reviewError}</p>}
    <button className="ui-secondary" onClick={() => onOpen(item.findId)}>Open find record</button>
    {editing && <details className="rounded-xl border border-gray-200 dark:border-gray-600"><summary className="min-h-11 cursor-pointer px-3 py-3 font-medium text-emerald-800 dark:text-emerald-300">Edit caption, facts and photographs</summary><div className="space-y-4 border-t border-gray-200 p-3 dark:border-gray-600">
      <label className="block">Display title (optional)<input className="ui-input w-full" value={item.displayTitle ?? ''} onChange={e => onChange({ ...item, displayTitle: e.target.value })} /></label>
      <label className="block">Your caption<textarea className="ui-input w-full" rows={4} value={item.caption ?? ''} onChange={e => onChange({ ...item, caption: e.target.value })} /></label>
      <label className="block">Interpretation<select className="ui-input w-full" value={item.interpretationStatus ?? ''} onChange={e => onChange({ ...item, interpretationStatus: e.target.value === 'tentative' || e.target.value === 'supported' ? e.target.value : undefined })}><option value="">Not specified</option><option value="tentative">Tentative</option><option value="supported">User considers supported</option></select></label>
      <fieldset><legend>Facts to display and export</legend><div className="flex flex-wrap gap-3">{collectionFactFields.map(field => <label key={field} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={item.selectedFactFields.includes(field)} onChange={e => onChange({ ...item, selectedFactFields: e.target.checked ? [...item.selectedFactFields, field] : item.selectedFactFields.filter(value => value !== field) })} />{{ period: 'Recorded period', material: 'Material', weightG: 'Weight', widthMm: 'Width', heightMm: 'Height', targetId: 'Target ID', coilLabel: 'Coil', programmeLabel: 'Programme', frequencyLabel: 'Frequency' }[field]}</label>)}</div></fieldset>
      <fieldset><legend>Existing photographs · choose up to two</legend><div className="grid grid-cols-2 gap-3">{photos?.map(photo => <label key={photo.id}><FindPhoto projectId={projectId} findId={find.id} mediaId={photo.id} className="h-28 rounded-lg" /><span className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={item.selectedMediaIds.includes(photo.id)} disabled={!item.selectedMediaIds.includes(photo.id) && item.selectedMediaIds.length >= 2} onChange={e => {
        const cropSettings = { ...item.cropSettings }; delete cropSettings[photo.id];
        onChange({ ...item, cropSettings, selectedMediaIds: e.target.checked ? [...item.selectedMediaIds, photo.id] : item.selectedMediaIds.filter(id => id !== photo.id) });
      }} />Select photograph</span></label>)}</div></fieldset>
      {item.selectedMediaIds.filter(id => !photos?.some(photo => photo.id === id)).map(id => <button key={id} className="ui-secondary" onClick={() => { const cropSettings = { ...item.cropSettings }; delete cropSettings[id]; onChange({ ...item, cropSettings, selectedMediaIds: item.selectedMediaIds.filter(value => value !== id) }); }}>Remove missing photograph selection</button>)}
      {item.selectedMediaIds.map((id, index) => <fieldset key={id} className="rounded-lg border p-2"><legend>Photograph {index + 1} crop</legend>{(['x', 'y'] as const).map(axis => <label key={axis} className="block">{axis === 'x' ? 'Horizontal position' : 'Vertical position'}<input className="min-h-11 w-full accent-emerald-700" type="range" min={0} max={100} value={item.cropSettings?.[id]?.[axis] ?? 50} onChange={e => onChange({ ...item, cropSettings: { ...item.cropSettings, [id]: { x: item.cropSettings?.[id]?.x ?? 50, y: item.cropSettings?.[id]?.y ?? 50, [axis]: Number(e.target.value) } } })} /></label>)}{index > 0 && <button className="ui-secondary" onClick={() => onChange({ ...item, selectedMediaIds: [...item.selectedMediaIds].reverse() })}>Use this photograph first / on cover</button>}</fieldset>)}
      <button className="ui-secondary" disabled={!fingerprint} onClick={() => onChange({ ...item, sourceFingerprintWhenReviewed: fingerprint })}>Mark source reviewed</button><p className="text-xs">Review acknowledges changes; it does not certify accuracy.</p>
    </div></details>}
  </div>;
}
