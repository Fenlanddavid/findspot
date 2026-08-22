export const COMPANION_SHARE_CACHE = 'findspot-companion-share-v1';
export const COMPANION_SHARE_CACHE_PATH = '/findspot/__companion_share__/pending';

export async function takePendingCompanionShare(): Promise<File | null> {
  if (!('caches' in window)) return null;
  const cache = await caches.open(COMPANION_SHARE_CACHE);
  const url = new URL(COMPANION_SHARE_CACHE_PATH, window.location.origin).toString();
  const response = await cache.match(url);
  if (!response) return null;
  await cache.delete(url);
  const blob = await response.blob();
  return new File([blob], 'companion-recording.json', {
    type: blob.type || 'application/vnd.findspot.companion+json',
  });
}
