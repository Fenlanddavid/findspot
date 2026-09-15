import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { pagePersistence } from '../services/pagePersistence';

/** Query photos only as a visible card approaches the viewport. */
export function FindPhoto({ projectId, findId, mediaId, crop, className = '' }: { projectId: string; findId: string; mediaId?: string; crop?: { x: number; y: number }; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '200px' });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const photo = useLiveQuery(async () => {
    if (!visible) return undefined;
    const row = mediaId ? await pagePersistence.media.get(mediaId) : await pagePersistence.media.where('findId').equals(findId).filter(row => row.projectId === projectId && row.type === 'photo').first();
    return row?.projectId === projectId && row.findId === findId && row.type === 'photo' ? row : null;
  }, [projectId, findId, mediaId, visible]);
  useEffect(() => {
    setFailed(false); setUrl('');
    if (!photo?.blob) { setUrl(''); return; }
    let active = true;
    let objectUrl = '';
    // Resize decoded photos for cards; release the full-size bitmap immediately.
    void createImageBitmap(photo.blob, { resizeWidth: 640, resizeQuality: 'medium' }).then(bitmap => {
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0); bitmap.close();
      canvas.toBlob(blob => {
        if (blob && active) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }
        canvas.width = 0; canvas.height = 0;
      }, 'image/jpeg', .8);
    }).catch(() => { if (active) { setUrl(''); setFailed(true); } });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [photo]);
  return <div ref={ref} className={`flex items-center justify-center overflow-hidden bg-stone-200 text-sm text-stone-600 ${className}`}>
    {url ? <img src={url} alt="Recorded find" loading="lazy" className="h-full w-full object-cover" style={{ objectPosition: `${crop?.x ?? 50}% ${crop?.y ?? 50}%` }} /> : <span>{photo === null || failed ? mediaId ? 'Photograph unavailable' : 'No photograph' : 'Photograph loading…'}</span>}
  </div>;
}
