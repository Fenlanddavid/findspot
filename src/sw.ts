/// <reference lib="webworker" />

import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import {
  COMPANION_SHARE_CACHE,
  COMPANION_SHARE_CACHE_PATH,
  MAX_COMPANION_CONTEXT_CHARS,
  MAX_COMPANION_FILE_BYTES,
  MAX_COMPANION_MULTIPART_BYTES,
  MAX_COMPANION_SESSION_ID_CHARS,
} from './shared/companionLimits';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision?: string | null }>;
};

const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

async function assertBoundedRequestBody(request: Request): Promise<void> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (!Number.isFinite(parsedLength) || parsedLength < 0 || parsedLength > MAX_COMPANION_MULTIPART_BYTES) {
      throw new Error('Shared payload is too large.');
    }
  }
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Shared payload is missing.');
  let received = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > MAX_COMPANION_MULTIPART_BYTES) {
        await reader.cancel();
        throw new Error('Shared payload is too large.');
      }
    }
  } finally {
    reader.releaseLock();
  }
}

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith('findspot-companion-share-') && name !== COMPANION_SHARE_CACHE)
      .map(name => caches.delete(name)));
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== '/findspot/companion-share') return;

  event.respondWith((async () => {
    try {
      await assertBoundedRequestBody(event.request.clone());
      const form = await event.request.formData();
      const allowedNames = new Set(['recording', 'context']);
      if ([...form.keys()].some(name => !allowedNames.has(name)) || form.getAll('recording').length !== 1 || form.getAll('context').length > 1) {
        return new Response('The shared Companion recording is invalid.', { status: 400 });
      }
      const recording = form.get('recording');
      if (!(recording instanceof File)) {
        return new Response('A Companion recording file is required.', { status: 400 });
      }
      if (recording.size === 0 || recording.size > MAX_COMPANION_FILE_BYTES) {
        return new Response('The shared Companion recording is too large.', { status: 413 });
      }
      if (recording.type && recording.type !== 'application/json' && recording.type !== 'application/vnd.findspot.companion+json') {
        return new Response('The shared file is not a Companion recording.', { status: 415 });
      }
      const cache = await caches.open(COMPANION_SHARE_CACHE);
      const cacheUrl = new URL(COMPANION_SHARE_CACHE_PATH, self.location.origin).toString();
      await cache.put(cacheUrl, new Response(recording, {
        headers: {
          'Content-Type': recording.type || 'application/vnd.findspot.companion+json',
          'Cache-Control': 'no-store',
        },
      }));
      const destination = new URL('/findspot/companion-import?shared=1', self.location.origin);
      const context = form.get('context');
      const trustedContextPrefix = `${self.location.origin}/findspot/companion-import`;
      if (typeof context === 'string' && context.length <= MAX_COMPANION_CONTEXT_CHARS && context.startsWith(trustedContextPrefix)) {
        const requested = new URL(context);
        if (requested.origin === self.location.origin && requested.pathname === '/findspot/companion-import') {
          const requestedNames = [...new Set(requested.searchParams.keys())];
          if (requestedNames.some(name => name !== 'session' && name !== 'finish') || requested.searchParams.getAll('finish').length > 1) {
            return Response.redirect(destination, 303);
          }
          const sessionId = requested.searchParams.get('session');
          if (
            sessionId
            && requested.searchParams.getAll('session').length === 1
            && sessionId.length <= MAX_COMPANION_SESSION_ID_CHARS
            && SESSION_ID_PATTERN.test(sessionId)
          ) destination.searchParams.set('session', sessionId);
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
