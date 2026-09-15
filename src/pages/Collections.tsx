import { CollectionCard } from '../components/CollectionCard';
import { useRecordNavigationGuard } from '../hooks/useRecordNavigationGuard';
import { CollectionExportModal } from '../components/CollectionExportModal';
import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { pagePersistence } from '../services/pagePersistence';
import { newCollection, newCollectionItem, saveCollection, deleteCollection, duplicateCollection } from '../services/collections';
import { orderCollectionItems, type FindCollection, type CollectionItem } from '../services/collectionModels';
import { CollectionFindPicker } from '../components/CollectionFindPicker';
import { CollectionObject } from '../components/CollectionObject';
import { FindModal } from '../components/FindModal';
import { FindPhoto } from '../components/FindPhoto';
import { useConfirmDialog } from '../components/ConfirmModal';
import { Modal } from '../components/Modal';

export default function Collections({ projectId }: { projectId: string }) {
  const [params, setParams] = useSearchParams(); const location = useLocation(); const navigate = useNavigate();
  const id = params.get('collection');
  const collections = useLiveQuery(() => pagePersistence.collections.where('projectId').equals(projectId).reverse().sortBy('updatedAt'), [projectId]);
  const selected = useLiveQuery(async () => {
    if (!id) return null;
    const collection = await pagePersistence.collections.get(id);
    if (collection?.projectId !== projectId) return null;
    return { collection, items: orderCollectionItems(await pagePersistence.collectionItems.where('collectionId').equals(id).toArray()) };
  }, [id, projectId]);
  const [draft, setDraft] = useState<FindCollection | null>(null); const [items, setItems] = useState<CollectionItem[]>([]); const [revision, setRevision] = useState<string>();
  const [exporting, setExporting] = useState(false);
  const [relinkItemId, setRelinkItemId] = useState<string>();
  const [picker, setPicker] = useState(false); const [openFind, setOpenFind] = useState<string>(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [example, setExample] = useState(false);
  const { confirm, dialog } = useConfirmDialog();
  const savingRef = useRef(false);
  savingRef.current = busy;
  const navigationGuard = useRecordNavigationGuard(!!draft, savingRef, () => setDraft(null));
  useEffect(() => {
    const state = location.state as { findIds?: string[] } | null;
    if (state?.findIds?.length) {
      const collection = newCollection(projectId); setDraft(collection); setRevision(undefined);
      setItems([...new Set(state.findIds)].map((findId, position) => newCollectionItem(collection.id, findId, position)));
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.key, location.state, location.pathname, projectId, navigate]);
  function create() { setDraft(newCollection(projectId)); setRevision(undefined); setItems([]); setError(''); }
  async function cancel() { if (await confirm({ title: 'Discard collection changes?', message: 'Your unsaved collection edits will be lost.', confirmLabel: 'Discard changes', danger: true })) { setDraft(null); setError(''); } }
  async function save() {
    if (!draft || busy) return; setBusy(true); setError('');
    try { const saved = await saveCollection(draft, items, revision); savingRef.current = false; navigationGuard.committed(); setDraft(null); setParams({ collection: saved.id }); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not save. Your edits are still here.'); }
    finally { setBusy(false); }
  }
  const collection = draft ?? selected?.collection;
  const visibleItems = draft ? items : selected?.items ?? [];
  const cover = visibleItems.find(item => item.id === collection?.coverItemId) ?? visibleItems[0];
  return <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 pb-28">
    {dialog}{navigationGuard.dialog}
    {!draft && (collection ? <button className="min-h-11 text-sm font-medium text-emerald-700 dark:text-emerald-300" onClick={() => setParams({})}>← All collections</button> : <Link className="inline-flex min-h-11 items-center text-sm font-medium text-emerald-700 dark:text-emerald-300" to="/finds-box">← FindsBox</Link>)}
    <header className="space-y-2"><p className="text-xs font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">Your own small museum</p><h1 className="font-serif text-4xl leading-tight">Collections</h1></header>
    {error && <p role="alert" className="rounded-xl bg-red-100 p-3 text-red-900">{error}</p>}
    {!collection && <>
      <p>Turn your finds into a collection worth exploring.</p><div className="flex flex-wrap gap-3"><button className="ui-primary" onClick={create}>Create a collection</button><button className="ui-secondary" onClick={() => setExample(true)}>See an example</button></div>
      {id && selected === null && <p>This collection is unavailable in this project.</p>}
      <div className="grid gap-5 sm:grid-cols-2">{collections?.map(row => <CollectionCard key={row.id} collection={row} onOpen={() => setParams({ collection: row.id })} />)}</div>
    </>}
    {collection && <>
      <div className="flex flex-wrap gap-2">{draft ? <><button disabled={busy} className="ui-primary" onClick={save}>{busy ? 'Saving…' : 'Save collection'}</button><button disabled={busy} className="ui-secondary" onClick={cancel}>Cancel editing</button><button className="ui-secondary" onClick={() => setPicker(true)}>Choose finds ({items.length}/50)</button></> : <>
        <button className="ui-primary" aria-label="Edit collection" onClick={() => { setDraft(collection); setItems(visibleItems); setRevision(collection.updatedAt); }}>Edit collection</button>
        <button className="ui-secondary" aria-label="Export collection" disabled={!visibleItems.length} onClick={() => setExporting(true)}>Export</button>
        <details className="relative"><summary className="ui-secondary cursor-pointer">More</summary><div className="absolute right-0 z-20 mt-2 grid w-48 gap-2 rounded-xl border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-800">
        <button className="ui-secondary" onClick={async () => { try { const copied = await duplicateCollection(collection.id); setParams({ collection: copied.id }); } catch (error) { setError(String(error)); } }}>Duplicate</button>
        <button className="ui-secondary" onClick={async () => { if (await confirm({ title: 'Delete collection?', message: 'This removes its presentation and captions. Your finds and photographs remain saved.', confirmLabel: 'Delete collection', danger: true })) { try { await deleteCollection(collection.id); setParams({}); } catch (error) { setError(String(error)); } } }}>Delete collection</button>
        </div></details>
      </>}</div>
      {draft && <div className="space-y-3 rounded-2xl border p-4">
        <label className="block">Collection title<input className="ui-input w-full" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
        <label className="block">Starter title (optional)<select className="ui-input w-full" value="" onChange={e => { if (e.target.value) setDraft({ ...draft, title: e.target.value }); }}><option value="">Choose a prompt</option>{['Favourite finds', 'Mystery objects', 'Everyday objects from the past', 'A season of discoveries'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="block">Your introduction<textarea className="ui-input w-full" rows={5} value={draft.introduction} onChange={e => setDraft({ ...draft, introduction: e.target.value })} /></label>
      </div>}
      <section className="overflow-hidden rounded-2xl border border-stone-200 bg-stone-50 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        {cover?.selectedMediaIds[0] && <FindPhoto projectId={projectId} findId={cover.findId} mediaId={cover.selectedMediaIds[0]} crop={cover.cropSettings?.[cover.selectedMediaIds[0]]} className="aspect-[4/3]" />}
        <div className="p-6 sm:p-8"><h2 className="break-words font-serif text-3xl leading-tight sm:text-4xl">{collection.title}</h2><p className="mt-4 whitespace-pre-wrap break-words leading-relaxed">{collection.introduction}</p><p className="mt-4 text-sm text-stone-500 dark:text-stone-400">{visibleItems.length} selected finds · A personal collection</p></div>
      </section>
      {visibleItems.map((item, index) => <section key={item.id} className="space-y-4 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-6">
        {draft && <div className="flex flex-wrap items-center gap-2"><span>Object {index + 1}</span>{([-1, 1] as const).map(direction => <button key={direction} disabled={index + direction < 0 || index + direction >= items.length} className="ui-secondary" onClick={() => { const next = [...items]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; setItems(next.map((row, position) => ({ ...row, position }))); }}>{direction < 0 ? 'Move up' : 'Move down'}</button>)}<button className="ui-secondary" aria-pressed={draft.coverItemId === item.id} onClick={() => setDraft({ ...draft, coverItemId: item.id })}>Use as cover</button><button className="ui-secondary" onClick={() => { setItems(items.filter(row => row.id !== item.id)); if (draft.coverItemId === item.id) setDraft({ ...draft, coverItemId: undefined }); }}>Remove item</button></div>}
        <CollectionObject projectId={projectId} item={item} editing={!!draft} onChange={updated => setItems(items.map(row => row.id === updated.id ? updated : row))} onOpen={setOpenFind} />
        {draft && <button className="ui-secondary" onClick={() => setRelinkItemId(item.id)}>Relink source find</button>}
      </section>)}
      {!visibleItems.length && <p>Choose finds to begin your exhibition.</p>}
    </>}
    {picker && draft && <CollectionFindPicker projectId={projectId} selected={items.map(item => item.findId)} onClose={() => setPicker(false)} onApply={ids => { const next = ids.map((findId, position) => ({ ...(items.find(item => item.findId === findId) ?? newCollectionItem(draft.id, findId, position)), position })); setItems(next); if (!next.some(item => item.id === draft.coverItemId)) setDraft({ ...draft, coverItemId: undefined }); }} />}
    {exporting && collection && <CollectionExportModal collectionId={collection.id} projectId={projectId} items={visibleItems} onClose={() => setExporting(false)} />}
    {relinkItemId && draft && <CollectionFindPicker projectId={projectId} selected={[]} replacement={{ excludedFindIds: items.map(item => item.findId) }} onClose={() => setRelinkItemId(undefined)} onApply={ids => {
      if (ids.length !== 1) return;
      setItems(items.map(item => item.id === relinkItemId ? { ...item, findId: ids[0], selectedMediaIds: [], cropSettings: undefined, sourceFingerprintWhenReviewed: undefined } : item));
    }} />}
    {openFind && <FindModal findId={openFind} onClose={() => setOpenFind(undefined)} />}
    {example && <Modal title="Demonstration collection" onClose={() => setExample(false)}><article className="space-y-4 p-4"><p className="text-sm">Example only · these demonstration objects are not saved to your records.</p><h2 className="font-serif text-3xl">The mystery drawer</h2><p>A few objects I keep returning to. Each has a question still to answer.</p><div className="rounded-xl bg-stone-100 p-8 text-center text-stone-800"><div className="mx-auto h-20 w-20 rounded-full border-8 border-stone-400" aria-hidden="true" /><h3 className="mt-4 font-serif text-xl">An unidentified ring</h3><p>Recorded period: Unknown</p><p className="mt-3">I like its simple shape. I have not identified its purpose yet.</p></div></article></Modal>}
  </main>;
}
