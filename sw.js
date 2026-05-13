/* ═══════════════════════════════════════════════════
   CHEOLMIN 대시보드 — Service Worker
   캐시 전략: Cache First (오프라인 지원)
   ═══════════════════════════════════════════════════ */

const CACHE_NAME = 'cm-dashboard-v1';
const CACHE_URLS = [
  './index.html',
  './manifest.json',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
];

/* ── 설치: 핵심 파일 캐시 ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] 캐시 설치 중...');
      return cache.addAll(CACHE_URLS);
    }).then(() => self.skipWaiting())
  );
});

/* ── 활성화: 이전 캐시 정리 ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] 오래된 캐시 삭제:', k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

/* ── fetch: Cache First → Network Fallback ── */
self.addEventListener('fetch', event => {
  // Notion API 등 외부 요청은 네트워크 직접 사용
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        // 유효한 응답만 캐시
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => {
        // 오프라인 + 캐시 없음 → index.html 폴백
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

/* ── 백그라운드 동기화 알림 (선택) ── */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
