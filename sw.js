// sw.js — 離線快取。版號 CACHE 只在【程式】改動時 bump（功能版本）；每日資料不 bump。
//   程式（SHELL 其餘檔案）：cache-first，離線秒開。
//   資料（DATA）：network-first，3 秒內抓到就用最新並寫回快取；沒網路／太慢 → 用上次快取。
const CACHE = 'fl-v44';
const DATA = [
  'exercises.json', 'history.json', 'version.json',
  'summary-block.txt', 'summary-hiit-block.txt', 'summary-cardio-block.txt',
  'renames.json'
];
const SHELL = [
  './', './index.html', './styles.css', './app.js',
  './lib/format.js', './lib/session.js', './lib/storage.js', './lib/custom.js',
  './manifest.webmanifest',
  ...DATA.map(f => './' + f),
  './icons/icon-192.png', './icons/icon-512-maskable.png', './icons/apple-touch-icon-180.png'
];
const NET_TIMEOUT = 3000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 讓頁面查詢目前生效的快取版本（app 顯示版本號用）
self.addEventListener('message', (e) => {
  if (e.data === 'version' && e.ports && e.ports[0]) e.ports[0].postMessage({ cache: CACHE });
});

// 資料檔：先上網（cache:'no-cache' 繞過瀏覽器 HTTP 快取、向伺服器確認），成功就寫回快取；
// 3 秒沒回來或沒網路 → 用上次快取（網路之後若回來仍會寫回，下次開 app 就是新的）
function networkFirst(req) {
  const key = new URL(req.url).pathname;
  return caches.open(CACHE).then(cache => {
    const net = fetch(req, { cache: 'no-cache' }).then(res => {
      if (res && res.ok) cache.put(key, res.clone());
      return res;
    });
    const timeout = new Promise(res => setTimeout(res, NET_TIMEOUT));
    return Promise.race([net.catch(() => null), timeout.then(() => null)]).then(r =>
      (r && r.ok) ? r : cache.match(key, { ignoreSearch: true }).then(c => c || net));
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('./index.html').then(r => r || fetch(req)));
    return;
  }
  const url = new URL(req.url);
  if (url.origin === location.origin && DATA.some(f => url.pathname.endsWith('/' + f))) {
    e.respondWith(networkFirst(req));
    return;
  }
  e.respondWith(caches.match(req).then(r => r || fetch(req)));
});
