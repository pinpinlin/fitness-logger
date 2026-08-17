// sw.js — 離線快取（precache + cache-first）。每次部署（含 exercises.json 重生）bump CACHE。
const CACHE = 'fl-v7';
const SHELL = [
  './', './index.html', './styles.css', './app.js',
  './lib/format.js', './lib/session.js', './lib/storage.js',
  './manifest.webmanifest', './exercises.json',
  './summary-block.txt', './summary-hiit-block.txt', './summary-cardio-block.txt',
  './icons/icon-192.png', './icons/icon-512-maskable.png', './icons/apple-touch-icon-180.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('./index.html').then(r => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req).then(r => r || fetch(req)));
});
