const $ = (id) => document.getElementById(id);

const els = {
  left: { ph: $("phLeft"), img: $("imgLeft"), vid: $("vidLeft"), ol: $("olLeft") },
  right:{ ph: $("phRight"),img: $("imgRight"),vid: $("vidRight"),ol: $("olRight") },
  diag: $("diag"),
  dOnline: $("dOnline"),
  dUpdate: $("dUpdate"),
  dLeft: $("dLeft"),
  dRight: $("dRight"),
  dErr: $("dErr"),
  dCache: $("dCache"),
  hotspot: $("hotspot"),
  fsBtn: $("fsBtn")
};

let CONFIG = null;
let errorCount = 0;

const MEDIA_CACHE = "lv-media-v3";
const STATIC_CACHE = "lv-static-v3";
const CACHE_STATE = { total: 0, done: 0, running: false, msg: "-" };
const NET_STATE = { online: navigator.onLine, lastProbe: null };

function nowStr() {
  const d = new Date();
  const pad = (n)=> String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function setOnlineState(v, why="") {
  NET_STATE.online = !!v;
  NET_STATE.lastProbe = why ? `${nowStr()} ${why}` : nowStr();
}

async function probeOnline(timeoutMs=2000) {
  // navigator.onLine은 가끔 틀릴 수 있어서, 실제로 playlist.json을 한번 찔러봅니다.
  if (!CONFIG?.leftPlaylistUrl) return;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(CONFIG.leftPlaylistUrl, { cache: "no-store", signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) setOnlineState(true, "(probe ok)");
    else setOnlineState(false, "(probe bad)");
  } catch {
    clearTimeout(t);
    setOnlineState(false, "(probe fail)");
  }
}

function isVideo(url=""){ return /\.(mp4|webm|ogg)(\?|#|$)/i.test(url); }
function isImage(url=""){ return /\.(jpg|jpeg|png|webp|gif)(\?|#|$)/i.test(url); }

function resolveUrl(u="", base="") {
  if (!u) return "";
  // 이미 절대 URL이면 그대로, 상대경로면 playlist.json 위치를 기준으로 절대 URL로 변환
  try { return new URL(u, base || location.href).toString(); }
  catch { return u; }
}

async function getMediaCache() {
  return await caches.open(MEDIA_CACHE);
}

async function cacheHas(url) {
  const cache = await getMediaCache();
  const hit = await cache.match(url, { ignoreSearch: false });
  return !!hit;
}

async function cachePut(url, res) {
  const cache = await getMediaCache();
  try { await cache.put(url, res); } catch {}
}

async function cacheGet(url) {
  const cache = await getMediaCache();
  try { return await cache.match(url); } catch { return null; }
}


async function ensureCached(url) {
  try {
    const has = await cacheHas(url);
    if (has) return true;
    if (!navigator.onLine) return false;
    const res = await fetch(url, { cache: "no-store" });
    if (res && res.ok) {
      await cachePut(url, res.clone());
      return true;
    }
  } catch {}
  return false;
}

async function trimMediaCache(keepUrls=[]) {
  const keep = new Set(keepUrls);
  const cache = await getMediaCache();
  const keys = await cache.keys();
  await Promise.all(keys.map(req => {
    const u = req.url;
    if (!keep.has(u)) return cache.delete(req);
  }));
}

async function prefetchAllMedia(urls=[]) {
  if (!CONFIG?.enableOfflineCache) return;
  if (!navigator.onLine) return;

  const uniq = [...new Set(urls)].filter(Boolean);
  if (!uniq.length) return;

  CACHE_STATE.total = uniq.length;
  CACHE_STATE.done = 0;
  CACHE_STATE.running = true;
  CACHE_STATE.msg = "캐시 중...";

  for (const u of uniq) {
    try {
      const already = await cacheGet(u);
      if (already) { CACHE_STATE.done += 1; continue; }

      const res = await fetch(u, { cache: "no-store" });
      if (res && res.ok) {
        await cachePut(u, res.clone());
      }
    } catch {}
    CACHE_STATE.done += 1;
    updateDiag();
  }

  // 현재 목록에 없는 오래된 파일은 정리
  try { await trimMediaCache(uniq); } catch {}

  CACHE_STATE.running = false;
  CACHE_STATE.msg = "완료";
  updateDiag();
}


async function getVideoBlobUrlFromCache(url) {
  const res = await cacheGet(url);
  if (!res) throw new Error("not cached");
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

async function getVideoBlobUrl(url) {
  // 1) 캐시에 있으면 캐시에서 blob으로
  let res = await cacheGet(url);
  if (!res && navigator.onLine) {
    // 2) 없으면 네트워크에서 통째로 받아 캐시에 저장
    const netRes = await fetch(url, { cache: "no-store" });
    if (netRes && netRes.ok) {
      await cachePut(url, netRes.clone());
      res = netRes;
    }
  }
  if (!res) throw new Error("video not available");

  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// ===== AUTO STORE CONFIG (v1.4.0) =====
// - config.json 없이 URL 파라미터로 자동 구성합니다.
// - 기본 사용: ?store=sbflower  /  ?store=jtchiken
// - 신규 매장(버킷이 새로 생기는 경우): ?store=ppbunsick&leftBase=https://pub-xxxx.r2.dev
// - (옵션) rightBase도 바꿀 수 있음: &rightBase=https://pub-yyyy.r2.dev

const DEFAULT_STORE = "sbflower";

// ✅ 현재 안준님 R2 공개 도메인(업로드된 sbflower.json/jtchiken.json 기반)
const STORE_LEFT_BASE = {
  sbflower: "https://pub-895ae0fd1f6649a2a78a77b99a0d2ecc.r2.dev",
  jtchiken: "https://pub-64a5f42fb4914b5c85a8d2c427951a06.r2.dev"
};

// ✅ 공통 RIGHT(gongtong) 버킷 공개 도메인
const DEFAULT_RIGHT_BASE = "https://pub-5c242b129bd849fbadd5a54319ea3540.r2.dev";

function cleanBase(u="") {
  return String(u || "").trim().replace(/\/+$/, "");
}
function safeSlug(v, fallback) {
  v = (v || "").toString().trim();
  if (!v) return fallback;
  v = v.replace(/[^a-zA-Z0-9_-]/g, "");
  return v || fallback;
}
function numParam(params, key, def) {
  const raw = params.get(key);
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : def;
}
function boolParam(params, key, def) {
  const raw = params.get(key);
  if (raw == null) return def;
  return ["1","true","yes","on"].includes(String(raw).toLowerCase());
}

async function loadConfig() {
  const params = new URLSearchParams(location.search);

  const store = safeSlug(params.get("store"), DEFAULT_STORE);

  // 1) (최우선) left= 로 전체 playlist URL을 직접 줄 수 있음
  let leftPlaylistUrl = params.get("left") || "";

  // 2) leftBase= 로 버킷 도메인만 주면 /left/playlist.json 자동 생성
  if (!leftPlaylistUrl) {
    const leftBase = params.get("leftBase") || STORE_LEFT_BASE[store] || "";
    if (leftBase) leftPlaylistUrl = `${cleanBase(leftBase)}/left/playlist.json`;
  }

  // 3) right= 로 전체 playlist URL 직접 지정 가능
  let rightPlaylistUrl = params.get("right") || "";

  // 4) rightBase= 로 도메인만 주면 /right/playlist.json 자동 생성 (기본은 gongtong)
  if (!rightPlaylistUrl) {
    const rightBase = params.get("rightBase") || DEFAULT_RIGHT_BASE;
    if (rightBase) rightPlaylistUrl = `${cleanBase(rightBase)}/right/playlist.json`;
  }

  if (!leftPlaylistUrl) {
    throw new Error(
      `LEFT playlist URL을 만들 수 없습니다.\n` +
      `- 기본: ?store=sbflower 또는 ?store=jtchiken\n` +
      `- 신규 매장: ?store=ppbunsick&leftBase=https://pub-xxxx.r2.dev\n` +
      `- 또는 ?left=https://.../playlist.json`
    );
  }
  if (!rightPlaylistUrl) {
    throw new Error(
      `RIGHT playlist URL을 만들 수 없습니다.\n` +
      `- 기본 RIGHT는 gongtong(공통)입니다.\n` +
      `- 필요시 ?rightBase=https://pub-yyyy.r2.dev 또는 ?right=https://.../playlist.json`
    );
  }

  return {
    deviceId: `AUTO-${store}`,
    store,

    leftPlaylistUrl,
    rightPlaylistUrl,

    // (기본값들) 필요하면 URL로도 조절 가능
    imageDurationSecDefault: numParam(params, "imgdur", 10),
    loadTimeoutMs: numParam(params, "timeout", 30000),

    dailyUpdateTime: params.get("update") || "23:30",
    playlistRefreshFallbackMs: numParam(params, "refresh", 3600000),

    enableOfflineCache: boolParam(params, "offline", true),
    cacheStrategy: params.get("cache") || "prefetch-next"
  };
}

async function safeFetchJson(url) {
  const res = await fetch(url, { cache:"no-store" });
  if (!res.ok) throw new Error(`fetch failed ${res.status}`);
  return await res.json();
}

function savePlaylistCache(key, data) {
  localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
}
function loadPlaylistCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw)?.data ?? null;
  } catch { return null; }
}

class SimplePlayer {
  constructor(name, el) {
    this.name = name;
    this.el = el;
    this.list = [];
    this.idx = 0;
    this.currentUrl = "";
    this.currentLink = "";
    this.loadTimer = null;
    this.imgTimer = null;

    el.vid.addEventListener("ended", () => this.next());
    el.vid.addEventListener("error", () => this.skip("video error"));
    el.ol.addEventListener("click", () => this.openLink());
  }

  setList(list) {
    this.list = Array.isArray(list) ? list : [];
    this.idx = 0;
  }

  showPh(msg) {
    this.el.ph.textContent = msg;
    this.el.ph.style.display = "flex";
    this.el.img.style.display = "none";
    this.el.vid.style.display = "none";
    this.el.ol.style.display = "none";
  }

  showOverlay(link) {
    if (link && /^https?:\/\//i.test(link)) this.el.ol.style.display = "block";
    else this.el.ol.style.display = "none";
  }

  play() {
    if (!this.list.length) return this.showPh("콘텐츠 없음");

    const item = this.list[this.idx % this.list.length];
    const url = item.url || "";
    const link = item.link || "";
    const duration = Number(item.duration) || CONFIG.imageDurationSecDefault;

    this.currentUrl = url;
    this.currentLink = link;
    this.showOverlay(link);

    clearTimeout(this.loadTimer);
    clearTimeout(this.imgTimer);

    this.showPh("불러오는 중…");

    this.loadTimer = setTimeout(() => {
      this.skip("load timeout");
    }, CONFIG.loadTimeoutMs);

    if (isVideo(url)) this.playVideo(url);
    else if (isImage(url)) this.playImage(url, duration);
    else this.skip("unknown type");
  }


  async playVideo(url) {
    clearTimeout(this.imgTimer);
    this.el.img.style.display = "none";
    this.el.vid.style.display = "none";
    this.el.vid.loop = false;

    // 이전 blob URL 해제
    if (this._blobUrl) {
      try { URL.revokeObjectURL(this._blobUrl); } catch {}
      this._blobUrl = "";
    }

    // play()가 연속 호출될 수 있어서 토큰으로 최신 요청만 살림
    this._token = (this._token || 0) + 1;
    const token = this._token;

    // 공통: 준비되면 표시
    this.el.vid.oncanplay = () => {
      clearTimeout(this.loadTimer);
      this.el.ph.style.display = "none";
      this.el.vid.style.display = "block";
      this.el.vid.play().catch(()=>{});
    };

    this.el.vid.onerror = () => {
      clearTimeout(this.loadTimer);
      this.skip("video error");
    };

    // ✅ 핵심 전략
    // - 온라인: 즉시 스트리밍(URL 그대로)로 재생(로딩 화면 최소화)
    //          동시에 백그라운드로 '통째 다운로드'해서 캐시에 저장(오프라인 대비)
    // - 오프라인: 캐시에 저장된 Response -> blob -> blob URL 로 재생
    const online = navigator.onLine;

    if (online) {
      // 1) 즉시 스트리밍 재생 (빠름)
      this.el.vid.crossOrigin = "anonymous"; // CORS 허용 시 blob/캐시 호환성 ↑
      this.el.vid.src = url;
      this.el.vid.load();

      // 2) 동시에 캐시 저장(백그라운드)
      ensureCached(url).then((ok) => {
        // 캐시 진행상황은 진단 패널에서 확인 가능
      }).catch(()=>{});

      return;
    }

    // 오프라인이면: 캐시된 blob으로만 재생 가능
    (async () => {
      try {
        const blobUrl = await getVideoBlobUrlFromCache(url);

        // 최신 요청만 살림
        if (token !== this._token) {
          try { URL.revokeObjectURL(blobUrl); } catch {}
          return;
        }
        this._blobUrl = blobUrl;

        this.el.vid.src = blobUrl;
        this.el.vid.load();
      } catch (e) {
        // 캐시에 없으면 -> 스킵
        this.skip("offline no cached video");
      }
    })();
  }


  playImage(url, durationSec) {
    // stop video
    this.el.vid.pause();
    this.el.vid.removeAttribute("src");
    this.el.vid.load();

    this.el.vid.style.display = "none";
    this.el.img.style.display = "none";

    this.el.img.onload = () => {
      clearTimeout(this.loadTimer);
      this.el.ph.style.display = "none";
      this.el.img.style.display = "block";

      clearTimeout(this.imgTimer);
      this.imgTimer = setTimeout(() => this.next(), durationSec * 1000);
    };
    this.el.img.onerror = () => this.skip("image error");

    this.el.img.src = url;
  }

  next() {
    this.idx = (this.idx + 1) % Math.max(this.list.length, 1);
    this.play();
  }

  skip(reason) {
    errorCount += 1;
    console.warn(`[${this.name}] skip: ${reason}`);
    els.dErr.textContent = String(errorCount);

    clearTimeout(this.loadTimer);
    clearTimeout(this.imgTimer);

    this.idx = (this.idx + 1) % Math.max(this.list.length, 1);
    this.play();
  }

  openLink() {
    const link = this.currentLink;
    if (!link || !/^https?:\/\//i.test(link)) return;
    window.open(link, "_blank");
  }
}

const leftPlayer = new SimplePlayer("LEFT", els.left);
const rightPlayer = new SimplePlayer("RIGHT", els.right);


function updateDiag() {
  // 온라인/오프라인 표시
  const onlineText = NET_STATE.online ? "ONLINE ✅" : "OFFLINE ❌";
  if (els.dOnline) els.dOnline.textContent = onlineText;

  // 캐시 진행률 표시
  if (els.dCache) {
    const a = CACHE_STATE.total || 0;
    const b = CACHE_STATE.done || 0;
    const msg = CACHE_STATE.msg || "-";
    els.dCache.textContent = a ? `${b}/${a} · ${msg}` : msg;
  }

  const last = localStorage.getItem("lv_last_update") || "-";
  if (els.dUpdate) els.dUpdate.textContent = last;

  if (els.dLeft) els.dLeft.textContent = leftPlayer?.currentUrl || "-";
  if (els.dRight) els.dRight.textContent = rightPlayer?.currentUrl || "-";

  if (els.dErr) els.dErr.textContent = String(errorCount);
}

function scheduleDailyUpdate() {
  const [hh, mm] = (CONFIG.dailyUpdateTime || "23:30").split(":").map(Number);
  const now = new Date();

  const next = new Date(now);
  next.setHours(hh, mm, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  const delay = next.getTime() - now.getTime();
  console.log("Next update scheduled at:", next.toString());

  setTimeout(async () => {
    await updatePlaylists("daily");
    scheduleDailyUpdate();
  }, delay);
}

async function maybeRegisterSW() {
  if (!CONFIG.enableOfflineCache) return;
  if (!("serviceWorker" in navigator)) return;

  try {
    await navigator.serviceWorker.register("./sw.js");
    console.log("✅ service worker registered");
  } catch (e) {
    console.warn("service worker register failed:", e);
  }
}

async function prefetchToSW(urls) {
  if (!CONFIG.enableOfflineCache) return;
  if (!("serviceWorker" in navigator)) return;

  try {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.active) return;

    reg.active.postMessage({ type:"CACHE_URLS", payload:{ urls }});
  } catch {}
}


function normalizeList(arr, baseUrl) {
  // playlist.json 안의 url이 "flower_1.jpg"처럼 상대경로여도 OK.
  // baseUrl(=playlist.json 주소)을 기준으로 절대 URL로 바꿔서 재생/캐시가 안정화됨.
  return (Array.isArray(arr) ? arr : [])
    .map(x => {
      const rawUrl = (x?.url ?? "").toString().trim();
      const rawLink = (x?.link ?? "").toString().trim();
      return {
        url: resolveUrl(rawUrl, baseUrl),
        link: rawLink,
        duration: x.duration || x.durationSec || x.duration_sec || null
      };
    })
    .filter(x => x.url && (isVideo(x.url) || isImage(x.url)));
}

async function updatePlaylists(reason="manual") {
  updateDiag();

  const leftKey = "lv_left_playlist";
  const rightKey = "lv_right_playlist";

  try {
    const [l, r] = await Promise.all([
      safeFetchJson(CONFIG.leftPlaylistUrl),
      safeFetchJson(CONFIG.rightPlaylistUrl)
    ]);

    const leftList = normalizeList(l, CONFIG.leftPlaylistUrl);
    const rightList = normalizeList(r, CONFIG.rightPlaylistUrl);

    leftPlayer.setList(leftList);
    rightPlayer.setList(rightList);

    savePlaylistCache(leftKey, leftList);
    savePlaylistCache(rightKey, rightList);

    localStorage.setItem("lv_last_update", `${nowStr()} (${reason})`);
    updateDiag();

    // 오프라인 재생을 위해(영상 포함): 현재 플레이리스트의 모든 미디어를 자동 캐시
    if (CONFIG.enableOfflineCache) {
      // cacheStrategy:
      // - prefetch-next: 다음 콘텐츠 몇 개만 먼저 저장(끊김 최소)
      // - cache-all: 전체를 다 저장(완전 오프라인에 더 유리)
      let urls = [];
      if ((CONFIG.cacheStrategy || "prefetch-next") === "cache-all") {
        urls = [...new Set([...leftList, ...rightList].map(x=>x.url))];
      } else {
        if (leftList[0]) urls.push(leftList[0].url);
        if (leftList[1]) urls.push(leftList[1].url);
        if (rightList[0]) urls.push(rightList[0].url);
        if (rightList[1]) urls.push(rightList[1].url);
        urls = [...new Set(urls)];
      }
      // 재생은 바로 시작하고, 캐시는 뒤에서 진행
      prefetchAllMedia(urls).catch(()=>{});
    } else {
      // (옵션) 기존 방식: 일부만 미리 캐시
      if (CONFIG.cacheStrategy === "prefetch-next") {
        const urls = [];
        if (leftList[0]) urls.push(leftList[0].url);
        if (leftList[1]) urls.push(leftList[1].url);
        if (rightList[0]) urls.push(rightList[0].url);
        if (rightList[1]) urls.push(rightList[1].url);
        await prefetchToSW([...new Set(urls)]);
      } else if (CONFIG.cacheStrategy === "cache-all") {
        const urls = [...new Set([...leftList, ...rightList].map(x=>x.url))];
        await prefetchToSW(urls);
      }
    }

    // 재생 시작
    leftPlayer.play();
    rightPlayer.play();

  } catch (e) {
    console.warn("playlist update failed:", e);

    // 실패하면 "기존 캐시/기존 목록 유지"
    const cachedLeft = loadPlaylistCache(leftKey) || leftPlayer.list;
    const cachedRight = loadPlaylistCache(rightKey) || rightPlayer.list;

    if (!cachedLeft?.length) leftPlayer.showPh("LEFT: 업데이트 실패(기존 없음)");
    else { leftPlayer.setList(cachedLeft); leftPlayer.play(); }

    if (!cachedRight?.length) rightPlayer.showPh("RIGHT: 업데이트 실패(기존 없음)");
    else { rightPlayer.setList(cachedRight); rightPlayer.play(); }

    updateDiag();
  }
}

function setupDiagToggle() {
  // 좌상단 5번 탭하면 진단 패널 열기/닫기
  let count = 0;
  let timer = null;

  els.hotspot.addEventListener("click", () => {
    count += 1;
    clearTimeout(timer);
    timer = setTimeout(() => { count = 0; }, 1200);

    if (count >= 5) {
      els.diag.classList.toggle("open");
      count = 0;
      updateDiag();
    }
  });

  window.addEventListener("online", updateDiag);
  window.addEventListener("offline", updateDiag);
}

function setupFullscreen() {
  const btn = els.fsBtn;
  if (!btn) return;

  const updateBtn = () => {
    btn.textContent = document.fullscreenElement ? "⤢" : "⛶";
  };

  btn.addEventListener("click", async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (e) {
      console.warn("fullscreen failed:", e);
    }
    updateBtn();
  });

  document.addEventListener("fullscreenchange", updateBtn);
  updateBtn();
}

(async function init(){
  // ✅ fullscreen/진단은 가장 먼저(초기화 실패해도 버튼은 동작)
  setupDiagToggle();
  setupFullscreen();
  updateDiag();

  try {
    CONFIG = await loadConfig();
    console.log("CONFIG:", CONFIG);

    await maybeRegisterSW();
    await probeOnline(2000);
    await updatePlaylists("startup");
  } catch (e) {
    console.warn("init failed:", e);
    // 초기화 실패 시에도 fullscreen 버튼은 동작해야 함
  }

  // 23:30 업데이트 예약
  scheduleDailyUpdate();

  // 혹시 23:30 타이밍을 놓쳤거나, 네트워크가 복구되었을 때를 대비한 fallback
  setInterval(() => updatePlaylists("fallback"), CONFIG.playlistRefreshFallbackMs || 3600000);

  // 온라인 상태 주기 체크(진짜 연결 여부)
  setInterval(() => probeOnline(2000), 5000);

  // 진단 패널 주기 업데이트
  setInterval(updateDiag, 2000);
})();
