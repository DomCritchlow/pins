// Pins service worker — bumps CACHE_NAME on every deploy so old shells get evicted.
const CACHE_NAME = 'pins-shell-v5';

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
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Never cache API calls or Google's auth/Picker/gapi assets.
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
  // Cache-first for everything else in shell.
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
