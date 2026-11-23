import { readRaw } from '../storage/database';
const buildId = __BUILD_ID__;
const prefix = __DB_NAME__ + ':release:';
const ownCache = prefix + buildId;
const files = __PRECACHE__;
const base = new URL(import.meta.env.BASE_URL, self.location.origin).pathname;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // A failed installation never replaces a working release.
    const cache = await caches.open(ownCache);
    await cache.addAll(files);
    if (!(await Promise.all(files.map(url => cache.match(url)))).every(Boolean)) throw new Error('Неполный кеш');
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Read the release pin before touching any cache. Keep every cache if the DB is unreadable.
    try {
      const { release } = await readRaw();
      const pinned = release?.buildId;
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (!windows.length) {
        for (const name of await caches.keys()) {
          if (name.startsWith(prefix) && name !== ownCache && name !== prefix + pinned) await caches.delete(name);
        }
      }
    } catch { /* Never discard a release whose active pin cannot be read. */ }
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'STATUS') {
    event.waitUntil((async () => {
      try {
        const raw = await readRaw();
        const pinned = raw.release;
        const target = pinned?.formatVersion === 1 ? pinned.buildId : buildId;
        const cache = await caches.open(prefix + target);
        const response = await cache.match(base + 'release.json');
        const info = response ? await response.json() : null;
        const complete = !!info?.files?.length && (await Promise.all(info.files.map(url => cache.match(url)))).every(Boolean);
        event.ports[0]?.postMessage({ ready: complete, buildId, pinned: target });
      } catch { event.ports[0]?.postMessage({ ready: false, buildId }); }
    })());
  }
  if (event.data?.type === 'ACTIVATE') {
    event.waitUntil((async () => { const raw = await readRaw(); if (!raw.snapshot && !raw.release) await self.skipWaiting(); })());
  }
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(base)) return;
  event.respondWith((async () => {
    if (event.request.mode === 'navigate') {
      const recovery = async () => (await (await caches.open(ownCache)).match(base + 'index.html'))
        || new Response('Не удалось открыть сохранённый выпуск. Подключись к интернету и попробуй снова. Данные не удалены.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      try {
        const raw = await readRaw();
        const pin = raw.release;
        if (pin && (pin.formatVersion !== 1 || typeof pin.buildId !== 'string')) {
          return recovery(); // The client offers an explicit reset; never erase here.
        }
        const target = pin?.buildId || buildId;
        const cache = await caches.open(prefix + target);
        const html = await cache.match(base + 'index.html');
        if (html) return html;
        if (pin) return recovery();
      } catch {
        return recovery();
      }
    }
    let preferred = ownCache;
    try {
      const { release } = await readRaw();
      if (release?.formatVersion === 1 && typeof release.buildId === 'string') preferred = prefix + release.buildId;
    } catch { /* The recovery client must remain loadable if storage is unavailable. */ }
    const current = await (await caches.open(preferred)).match(event.request, { ignoreVary: true });
    if (current) return current;
    // Hashes identify old open clients' assets. Unversioned icons/manifest use only the preferred release.
    for (const name of (await caches.keys()).filter(name => name.startsWith(prefix) && name !== preferred && url.pathname.startsWith(base + 'assets/'))) {
      // These are same-origin public build assets, not negotiated or personal responses.
      // Vite's Vary: Origin must not prevent offline module/CSS requests with crossorigin.
      const hit = await (await caches.open(name)).match(event.request, { ignoreVary: true });
      if (hit) return hit;
    }
    return fetch(event.request);
  })());
});
