import { useLiveQuery } from 'dexie-react-hooks';
import { pagePersistence } from '../services/pagePersistence';
import { orderCollectionItems, type FindCollection } from '../services/collectionModels';
import { FindPhoto } from './FindPhoto';

export function CollectionCard({ collection, onOpen }: { collection: FindCollection; onOpen: () => void }) {
  const items = useLiveQuery(async () => orderCollectionItems(await pagePersistence.collectionItems.where('collectionId').equals(collection.id).toArray()), [collection.id]);
  const cover = items?.find(item => item.id === collection.coverItemId) ?? items?.[0];
  return <button onClick={onOpen} className="group overflow-hidden rounded-2xl border border-stone-200 bg-white text-left shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-gray-700 dark:bg-gray-800">
    {cover?.selectedMediaIds[0] ? <FindPhoto projectId={collection.projectId} findId={cover.findId} mediaId={cover.selectedMediaIds[0]} crop={cover.cropSettings?.[cover.selectedMediaIds[0]]} className="aspect-[3/2]" /> : <div className="flex aspect-[3/2] items-center justify-center bg-stone-100 text-emerald-800 dark:bg-gray-900 dark:text-emerald-300"><svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M9 24 32 10l23 14H9ZM8 54h48M13 49h38M17 29v16m15-16v16m15-16v16" /><circle cx="32" cy="21" r="2" /></svg></div>}
    <div className="space-y-2 p-5"><p className="text-xs font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">{items?.length ?? 0} {items?.length === 1 ? 'find' : 'finds'} · Private collection</p><h2 className="break-words font-serif text-2xl leading-tight">{collection.title}</h2>{collection.introduction && <p className="line-clamp-2 text-sm leading-relaxed text-gray-600 dark:text-gray-300">{collection.introduction}</p>}<span className="inline-block pt-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">Explore collection <span aria-hidden="true">↗</span></span></div>
  </button>;
}
