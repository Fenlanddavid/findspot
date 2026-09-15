import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { capturePublicCollection, renderCollectionPages, collectionZip, collectionPdf, type CollectionExportPage } from '../services/collectionExport';
import type { CollectionItem } from '../services/collectionModels';
import { triggerDownload } from '../utils/download';

function PreviewPage({ page }: { page: CollectionExportPage }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const value = URL.createObjectURL(page.blob); setUrl(value); return () => URL.revokeObjectURL(value); }, [page]);
  return url ? <img src={url} alt={`Export page ${page.filename.match(/\d+/)?.[0]}`} loading="lazy" className="w-full rounded-xl border" /> : <div className="aspect-[4/5] rounded-xl bg-black/5" aria-label="Loading export page" />;
}
export function CollectionExportModal({ collectionId, projectId, items, onClose }: { collectionId: string; projectId: string; items: CollectionItem[]; onClose: () => void }) {
  const [selected, setSelected] = useState(items.map(item => item.id));
  const [publicDetectorLabel, setPublicDetectorLabel] = useState('');
  const [pages, setPages] = useState<CollectionExportPage[]>([]); const [status, setStatus] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [allowMissing, setAllowMissing] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function run(task: (signal: AbortSignal) => Promise<void>) {
    if (busy) return; setBusy(true); setError(''); controller.current = new AbortController();
    try { await task(controller.current.signal); }
    catch (error) { if (controller.current.signal.aborted || error instanceof DOMException && error.name === 'AbortError') setStatus('Export cancelled. Your collection is saved.'); else setError(error instanceof Error ? error.message : 'Could not prepare export. Try fewer objects.'); }
    finally { setBusy(false); }
  }
  return <Modal title="Export collection" onClose={() => { controller.current?.abort(); onClose(); }}>
    <div className="space-y-4"><p>Check your photographs and wording for details you do not want to share.</p><p className="text-sm">Only the displayed facts, selected photographs and your collection wording are included. Review every page below before saving.</p>
      {!pages.length && <><fieldset><legend>Objects to include</legend>{items.map((item, index) => <label key={item.id} className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={busy} checked={selected.includes(item.id)} onChange={e => setSelected(e.target.checked ? [...selected, item.id] : selected.filter(id => id !== item.id))} />{item.displayTitle || `Object ${index + 1}`}</label>)}</fieldset><label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={allowMissing} onChange={e => setAllowMissing(e.target.checked)} />Allow clearly labelled missing-photograph placeholders</label>
        <label className="block">Public detector label (optional)<input className="ui-input mt-1 w-full" maxLength={100} disabled={busy} value={publicDetectorLabel} onChange={event => setPublicDetectorLabel(event.target.value)} /><span className="mt-1 block text-sm">Only include a name you want others to see.</span></label>
        <button disabled={busy || !selected.length} className="ui-primary" onClick={() => run(async signal => {
          const snapshot = await capturePublicCollection(collectionId, projectId, selected);
          snapshot.publicDetectorLabel = publicDetectorLabel.trim();
          if (!allowMissing && snapshot.objects.some(object => object.missingPhotos)) throw new Error('Some selected photographs are missing. Repair the collection or explicitly allow placeholders.');
          const result = await renderCollectionPages(snapshot, signal, count => setStatus(`Preparing preview · ${count} pages`));
          setPages(result); setStatus('Export prepared. Review every page before saving.');
        })}>Prepare full preview</button></>}
      {status && <p role="status">{status}</p>}{error && <p role="alert" className="text-red-700">{error}</p>}
      {busy && <button className="ui-secondary" onClick={() => controller.current?.abort()}>Cancel export</button>}
      {pages.map(page => <PreviewPage key={page.filename} page={page} />)}
      {!!pages.length && <div className="flex flex-wrap gap-3"><button disabled={busy} className="ui-primary" onClick={() => run(async signal => { const archive = await collectionZip(pages, signal); signal.throwIfAborted(); triggerDownload(archive, 'findspot-collection.zip'); setStatus('Export prepared; download requested.'); })}>Save carousel ZIP</button>
        <button disabled={busy} className="ui-primary" onClick={() => run(async signal => { triggerDownload(await collectionPdf(pages, signal), 'findspot-collection.pdf'); setStatus('Export prepared; download requested.'); })}>Save PDF booklet</button>
        <button disabled={busy} className="ui-secondary" onClick={() => run(async signal => { const files = pages.map(page => new File([page.blob], page.filename, { type: 'image/png' })); if (navigator.canShare?.({ files })) { await navigator.share({ files, title: 'My collection' }); setStatus('Share sheet closed.'); } else { const archive = await collectionZip(pages, signal); signal.throwIfAborted(); triggerDownload(archive, 'findspot-collection.zip'); setStatus('Image sharing unavailable. ZIP download requested.'); } })}>Share carousel</button>
        <button disabled={busy} className="ui-secondary" onClick={() => { setPages([]); setStatus(''); }}>Change export selection</button>
      </div>}
    </div>
  </Modal>;
}
