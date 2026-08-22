/// <reference lib="webworker" />

import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision?: string | null }>;
};

const SHARE_CACHE = 'findspot-companion-share-v1';
const SHARE_CACHE_PATH = '/findspot/__companion_share__/pending';

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== '/findspot/companion-share') return;

  event.respondWith((async () => {
    try {
      const form = await event.request.formData();
      const recording = form.get('recording');
      if (!(recording instanceof File)) {
        return new Response('A Companion recording file is required.', { status: 400 });
      }
      const cache = await caches.open(SHARE_CACHE);
      const cacheUrl = new URL(SHARE_CACHE_PATH, self.location.origin).toString();
      await cache.put(cacheUrl, new Response(recording, {
        headers: {
          'Content-Type': recording.type || 'application/vnd.findspot.companion+json',
          'Cache-Control': 'no-store',
        },
      }));
      const destination = new URL('/findspot/companion-import?shared=1', self.location.origin);
      const context = form.get('context');
      const trustedContextPrefix = `${self.location.origin}/findspot/companion-import`;
      if (typeof context === 'string' && context.startsWith(trustedContextPrefix)) {
        const requested = new URL(context);
        if (requested.pathname === '/findspot/companion-import') {
          const sessionId = requested.searchParams.get('session');
          if (sessionId) destination.searchParams.set('session', sessionId);
          if (requested.searchParams.get('finish') === '1') {
            destination.searchParams.set('finish', '1');
          }
        }
      }
      return Response.redirect(destination, 303);
    } catch {
      return new Response('The shared Companion recording could not be received.', { status: 400 });
    }
  })());
});
