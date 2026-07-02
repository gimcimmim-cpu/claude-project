/* 이 파일이 하는 일은 하나뿐입니다: intern-schedule/ 경로에 대해
   상위 폴더(루트)의 서비스워커가 갖고 있는 넓은 scope를 가로채서,
   여기서는 캐싱 없이 항상 네트워크에서 최신 파일을 받아오게 만드는 것.
   (서비스워커는 더 구체적인 scope가 우선 적용되는 표준 동작을 이용) */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
