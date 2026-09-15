import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router';
import { pagePersistence } from '../services/pagePersistence';
import { newCollectionItem, saveCollection } from '../services/collections';
import { orderCollectionItems } from '../services/collectionModels';
import { Modal } from './Modal';

export function AddToCollection({ projectId, findIds, onClose }: { projectId: string; findIds: string[]; onClose: () => void }) {
  const collections = useLiveQuery(() => pagePersistence.collections.where('projectId').equals(projectId).toArray(), [projectId]);
  const [chosen, setChosen] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const navigate = useNavigate();
  return <Modal title="Add to collection" onClose={onClose}><div className="space-y-4"><p>{findIds.length} selected finds</p><label className="block">Collection<select className="ui-input w-full" value={chosen} onChange={e => setChosen(e.target.value)}><option value="">Create a new collection</option>{collections?.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select></label>{error && <p role="alert">{error}</p>}<button className="ui-primary" disabled={busy} onClick={async () => {
    if (!chosen) { onClose(); navigate('/finds-box/collections', { state: { findIds } }); return; }
    setBusy(true);
    try {
      const collection = await pagePersistence.collections.get(chosen); if (collection?.projectId !== projectId) throw new Error('Collection is unavailable.');
      const items = orderCollectionItems(await pagePersistence.collectionItems.where('collectionId').equals(chosen).toArray());
      for (const findId of new Set(findIds)) if (!items.some(item => item.findId === findId)) items.push(newCollectionItem(chosen, findId, items.length));
      await saveCollection(collection, items, collection.updatedAt); onClose(); navigate(`/finds-box/collections?collection=${encodeURIComponent(chosen)}`);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not add finds.'); } finally { setBusy(false); }
  }}>{chosen ? 'Add selected finds' : 'Review new collection'}</button></div></Modal>;
}
