/* Rhythm 서비스 워커 (빌드 시 vite.config.ts 의 offlineSw 플러그인이 아래 VERSION / PRECACHE 자리 표시자를 채워 dist/sw.js 로 출력한다)
 *
 *  - 설치 시 앱 파일 전체를 사전 캐시 → 오프라인에서도 앱이 열리고 곡 업로드/플레이가 가능
 *  - 같은 출처의 GET 만 처리한다. Firebase/Google API(다른 출처)는 건드리지 않는다.
 *  - 화면 이동(HTML)은 네트워크 우선(3초 제한) → 실패하면 캐시. 그 외 파일은 캐시 우선.
 *  - 새 버전은 열려 있는 탭이 모두 닫혀야 활성화된다 (사용 중인 앱의 파일이 중간에 바뀌지 않도록 skipWaiting 을 쓰지 않음).
 */
const VERSION = '__VERSION__';
const CACHE = 'rhythm-' + VERSION;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('rhythm-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      Promise.race([fetch(req), timeout(3000)])
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); }
          return res;
        })
        .catch(() => caches.match('./index.html').then((hit) => hit || caches.match('./'))),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })),
  );
});
