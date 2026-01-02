const STATIC_CACHE = "lv-static-v7";
const MEDIA_CACHE  = "lv-media-v3"; // 기존 v1.2 캐시 재사용

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(["./", "./index.html", "./app.js", "./sw.js"]);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k.startsWith("lv-") && ![STATIC_CACHE, MEDIA_CACHE].includes(k))
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

function isImageUrl(req) {
  const u = new URL(req.url);
  return /\.(jpg|jpeg|png|webp|gif)(\?|#|$)/i.test(u.pathname);
}
function hasRange(req) {
  return req.headers && req.headers.has("range");
}
function isVideoUrl(req) {
  const u = new URL(req.url);
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(u.pathname);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // 영상 Range 요청은 건드리지 않음(온라인 재생 안정)
  if (isVideoUrl(req) && hasRange(req)) return;

  // 이미지: cache-first (오프라인 대비)
  if (isImageUrl(req)) {
    event.respondWith((async () => {
      const cache = await caches.open(MEDIA_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;

      try {
        const res = await fetch(req);
        cache.put(req, res.clone()).catch(()=>{});
        return res;
      } catch {
        return cached || Response.error();
      }
    })());
    return;
  }

  // 정적 파일: cache-first
  event.respondWith((async () => {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;

    const res = await fetch(req);
    cache.put(req, res.clone()).catch(()=>{});
    return res;
  })());
});
