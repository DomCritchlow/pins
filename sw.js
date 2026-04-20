// Pins service worker — bumps CACHE_NAME on every deploy so old shells get evicted.
const CACHE_NAME = 'pins-shell-v13';

// Separate long-lived cache for Places photo media.
// Persists across shell version bumps — photos don't change, so we keep them.
const PHOTO_CACHE = 'pins-photos-v1';
const PHOTO_MAX = 60; // max entries before oldest-first eviction

const SHELL = [
  './',
  './index.html',
  './style.css',
  './config.js',
  './util.js',
  './auth.js',
  './sheets.js',
  './places.js',
  './maps.js',
  './picker.js',
  './labels.js',
  './app.js',
  './manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css',
  'https://unpkg.com/@phosphor-icons/web@2.1.1/src/fill/style.css',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          // Only evict old shell caches — leave the photo cache alone across deploys.
          .filter((k) => k.startsWith('pins-shell-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Places photo media — cache-first so repeat views are free ($0.007 per
  // unique photo, paid once, then served from SW cache indefinitely).
  if (url.hostname === 'places.googleapis.com' && url.pathname.includes('/media')) {
    e.respondWith(cacheFirstPhoto(e.request));
    return;
  }

  // All other Google API calls (auth, sheets, places data) — never cache.
  if (
    url.hostname === 'sheets.googleapis.com' ||
    url.hostname === 'www.googleapis.com' ||
    url.hostname === 'maps.googleapis.com' ||
    url.hostname === 'places.googleapis.com' ||
    url.hostname === 'openidconnect.googleapis.com' ||
    url.hostname === 'accounts.google.com' ||
    url.hostname === 'apis.google.com' ||
    url.hostname === 'docs.google.com'
  ) {
    return;
  }

  // Shell assets — cache-first.
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});

// Cache-first strategy for photo media.
// The API key is stripped from the cache key so key rotations don't orphan
// cached photos, and so the same image isn't double-stored under two keys.
async function cacheFirstPhoto(request) {
  const cache = await caches.open(PHOTO_CACHE);
  const cacheKey = urlWithoutKey(request.url);

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      await trimPhotoCache(cache);
      await cache.put(cacheKey, response.clone());
    }
    return response;
  } catch (_) {
    // Offline and not cached — return a transparent 1×1 so the UI doesn't break.
    return new Response(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
      { headers: { 'Content-Type': 'image/svg+xml' } }
    );
  }
}

// Remove the `key` query param so cache entries survive API key rotations.
function urlWithoutKey(urlStr) {
  const u = new URL(urlStr);
  u.searchParams.delete('key');
  return u.toString();
}

// Evict the oldest entries when the cache exceeds PHOTO_MAX.
async function trimPhotoCache(cache) {
  const keys = await cache.keys();
  if (keys.length >= PHOTO_MAX) {
    const excess = keys.slice(0, keys.length - PHOTO_MAX + 1);
    await Promise.all(excess.map((k) => cache.delete(k)));
  }
}
