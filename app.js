const $ = (id) => document.getElementById(id);

const els = {
  left: { ph: $("phLeft"), img: $("imgLeft"), vid: $("vidLeft"), ol: $("olLeft") },
  right:{ ph: $("phRight"),img: $("imgRight"),vid: $("vidRight"),ol: $("olRight") },
  diag: $("diag"),
  dOnline: $("dOnline"),
  dTvStatus: $("dTvStatus"),
  dTvLastSeen: $("dTvLastSeen"),
  dUpdate: $("dUpdate"),
  dBuild: $("dBuild"),
  dLeft: $("dLeft"),
  dRight: $("dRight"),
  dErr: $("dErr"),
  dCache: $("dCache"),
  dSleep: $("dSleep"),
  btnSleepOpen: $("btnSleepOpen"),
  btnSleepToggle: $("btnSleepToggle"),
  hotspot: $("hotspot"),
  netDock: $("netDock"),
  netBadge: $("netBadge"),
  btnReload: $("btnReload")
};

// ===== Build / Version (v7) =====
const LV_BUILD = "v7.3.2";
const LV_BUILD_DETAIL = "v7.3.2-20260209_131506";
let LV_REMOTE_BUILD = "-";
let _lvUpdateReloadScheduled = false;

// ===== Sleep Mode (Black/Screensaver) =====
// 요구사항
// - 진입: (기본) 우하단 1초 롱프레스  + (옵션) OK 7번 / ↑↑↓↓ 시퀀스
// - 입력: 텍스트 금지, 버튼으로 +10m/-10m/+1h/-1h
// - 저장: localStorage (전원 껐다 켜도 유지)
// - 우선순위: URL 파라미터 > 점주 저장값 > STORE_SLEEP(코드 기본값) > 기본값(00:00~09:30)
// - 동작: 검정 오버레이(또는 스크린세이버) + (권장) video pause/mute

const SLEEP_LS_KEY = "lv_sleep_settings_v1";
const DEFAULT_SLEEP = { start: "00:00", end: "09:30", mode: "black" };

// (옵션) 매장별 코드 기본값: 필요하면 여기 채워주세요.
const STORE_SLEEP = {
  presets: {
    // sbflower: { start: "01:00", end: "09:00", mode: "black" },
    // jtchiken: { start: "01:00", end: "09:00", mode: "black" },
  },
  default: null
};

let SLEEP_ACTIVE = false;
let SLEEP_MANUAL = null; // null=auto, true/false=manual override
let _sleepResolved = { ...DEFAULT_SLEEP, _src: "default" };
let _sleepEdit = { ...DEFAULT_SLEEP, target: "start" };

function _normHHMM(v, fallback) {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  let hh = Math.min(23, Math.max(0, Number(m[1])));
  let mm = Math.min(59, Math.max(0, Number(m[2])));
  return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
}
function _toMin(hhmm) {
  const m = String(hhmm || "").split(":");
  if (m.length < 2) return 0;
  return (Number(m[0]) * 60 + Number(m[1])) % (24 * 60);
}
function _fromMin(min) {
  const t = ((min % (24*60)) + (24*60)) % (24*60);
  const hh = Math.floor(t / 60);
  const mm = t % 60;
  return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
}
function _addMin(hhmm, delta) {
  return _fromMin(_toMin(hhmm) + delta);
}
function _safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
function _readSavedSleep() {
  const raw = localStorage.getItem(SLEEP_LS_KEY);
  const obj = raw ? _safeJsonParse(raw) : null;
  if (!obj || typeof obj !== "object") return null;
  const out = {
    start: _normHHMM(obj.start, null),
    end: _normHHMM(obj.end, null),
    mode: (obj.mode === "saver") ? "saver" : (obj.mode === "black" ? "black" : null),
  };
  if (!out.start || !out.end || !out.mode) return null;
  return out;
}
function _writeSavedSleep(v) {
  localStorage.setItem(SLEEP_LS_KEY, JSON.stringify({
    start: _normHHMM(v.start, DEFAULT_SLEEP.start),
    end: _normHHMM(v.end, DEFAULT_SLEEP.end),
    mode: (v.mode === "saver") ? "saver" : "black",
    savedAt: Date.now()
  }));
}

function resolveSleepConfig(storeSlug) {
  const params = new URLSearchParams(location.search);

  const urlStart = params.get("sleepStart") || params.get("ss");
  const urlEnd   = params.get("sleepEnd")   || params.get("se");
  const urlMode  = params.get("sleepMode")  || params.get("sm");

  const saved = _readSavedSleep();
  const codeDefault = (STORE_SLEEP.presets && STORE_SLEEP.presets[storeSlug]) || STORE_SLEEP.default;

  // base → codeDefault → saved → url
  let cfg = { ...DEFAULT_SLEEP, _src: "default" };
  if (codeDefault) { cfg = { ...cfg, ...codeDefault, _src: "STORE_SLEEP" }; }
  if (saved) { cfg = { ...cfg, ...saved, _src: "saved" }; }

  if (urlStart || urlEnd || urlMode) {
    cfg = {
      ...cfg,
      start: urlStart ? _normHHMM(urlStart, cfg.start) : cfg.start,
      end: urlEnd ? _normHHMM(urlEnd, cfg.end) : cfg.end,
      mode: urlMode === "saver" ? "saver" : "black",
      _src: "url"
    };
  }

  cfg.start = _normHHMM(cfg.start, DEFAULT_SLEEP.start);
  cfg.end   = _normHHMM(cfg.end, DEFAULT_SLEEP.end);
  cfg.mode  = (cfg.mode === "saver") ? "saver" : "black";
  return cfg;
}

function isSleepNow(cfg, now = new Date()) {
  const s = _toMin(cfg.start);
  const e = _toMin(cfg.end);
  const m = now.getHours() * 60 + now.getMinutes();

  // start == end → 취침 비활성(실수 방지)
  if (s === e) return false;

  // same-day window
  if (s < e) return (m >= s && m < e);

  // overnight window (e.g. 23:00~06:00)
  return (m >= s || m < e);
}

function setSleepActive(on) {
  if (on === SLEEP_ACTIVE) return;
  SLEEP_ACTIVE = on;

  const shield = document.getElementById("sleepShield");
  const saver = document.getElementById("sleepSaver");
  if (!shield) return;

  if (on) {
    // overlay
    shield.classList.add("on");
    shield.classList.toggle("saver", _sleepResolved.mode === "saver");

    // pause players (reduce load)
    try { leftPlayer.pauseForSleep(); } catch {}
    try { rightPlayer.pauseForSleep(); } catch {}
  } else {
    shield.classList.remove("on");
    shield.classList.remove("saver");

    // resume
    try { leftPlayer.play(); } catch {}
    try { rightPlayer.play(); } catch {}
  }
}

function updateSleepUI() {
  const p = document.getElementById("sleepPanel");
  if (!p) return;

  const startEl = document.getElementById("sleepStartVal");
  const endEl = document.getElementById("sleepEndVal");
  if (startEl) startEl.textContent = _sleepEdit.start;
  if (endEl) endEl.textContent = _sleepEdit.end;

  const sBtn = document.getElementById("sleepSelectStart");
  const eBtn = document.getElementById("sleepSelectEnd");
  if (sBtn) sBtn.classList.toggle("on", _sleepEdit.target === "start");
  if (eBtn) eBtn.classList.toggle("on", _sleepEdit.target === "end");

  const bBtn = document.getElementById("sleepModeBlack");
  const vBtn = document.getElementById("sleepModeSaver");
  if (bBtn) bBtn.classList.toggle("on", _sleepEdit.mode === "black");
  if (vBtn) vBtn.classList.toggle("on", _sleepEdit.mode === "saver");
}

function openSleepPanel() {
  const p = document.getElementById("sleepPanel");
  if (!p) return;

  const store = CONFIG?.store || safeSlug(new URLSearchParams(location.search).get("store"), DEFAULT_STORE);
  _sleepResolved = resolveSleepConfig(store);
  _sleepEdit = { start: _sleepResolved.start, end: _sleepResolved.end, mode: _sleepResolved.mode, target: "start" };

  p.classList.add("open");
  p.setAttribute("aria-hidden", "false");
  updateSleepUI();

  // focus first button for remote
  const first = document.getElementById("sleepSelectStart");
  first && first.focus && first.focus();
}

function closeSleepPanel() {
  const p = document.getElementById("sleepPanel");
  if (!p) return;
  p.classList.remove("open");
  p.setAttribute("aria-hidden", "true");
}


function toggleManualSleep() {
  // 1회 누르면 "지금 상태 반대로" 수동 적용
  // 다시 누르면 수동 해제(자동 스케줄로 복귀)
  if (SLEEP_MANUAL !== null) {
    SLEEP_MANUAL = null;
    tickSleep();
    return;
  }
  SLEEP_MANUAL = !SLEEP_ACTIVE;
  setSleepActive(SLEEP_MANUAL);
  try { updateDiag(); } catch {}
}


function tickSleep() {
  const store = CONFIG?.store || safeSlug(new URLSearchParams(location.search).get("store"), DEFAULT_STORE);
  _sleepResolved = resolveSleepConfig(store);
  const should = (SLEEP_MANUAL !== null) ? SLEEP_MANUAL : isSleepNow(_sleepResolved);
  setSleepActive(should);
  try { updateDiag(); } catch {}
}

function setupSleepUI() {
  // bottom-right long press (1s) — works even while sleepShield is covering the screen.
  // 구현 포인트:
  // - 별도 overlay div로 클릭을 가로막지 않고, "우하단 코너 영역"을 좌표로 감지합니다.
  // - 롱프레스가 트리거된 경우에만, 해당 코너 영역의 '다음 click 1회'를 막아(광고 링크 오작동 방지) 패널만 뜨게 합니다.
  const CORNER = { w: 140, h: 140, ms: 1000 }; // 우하단 감지 영역/시간(필요하면 조절)
  let pressTimer = null;
  let activePointerId = null;
  let suppressClickUntil = 0;

  const inCorner = (e) => {
    const x = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
    const y = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    return x >= (window.innerWidth - CORNER.w) && y >= (window.innerHeight - CORNER.h);
  };

  const clearPress = () => {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
    activePointerId = null;
  };

  const startPress = (e) => {
    // 멀티 터치/스크롤 중에는 무시
    if (!inCorner(e)) return;
    clearPress();
    activePointerId = e.pointerId ?? "touch";
    pressTimer = setTimeout(() => {
      suppressClickUntil = Date.now() + 900; // 롱프레스 직후 클릭 1회 차단용 타임윈도우
      openSleepPanel();
    }, CORNER.ms);
  };

  const endPress = (e) => {
    const pid = e.pointerId ?? "touch";
    if (activePointerId && pid !== activePointerId) return;
    clearPress();
  };

  // capture 단계로 걸어두면, 기존 클릭(광고 링크 등)을 최대한 방해하지 않습니다.
  document.addEventListener("pointerdown", startPress, true);
  document.addEventListener("pointerup", endPress, true);
  document.addEventListener("pointercancel", endPress, true);
  document.addEventListener("pointerleave", endPress, true);

  // 터치만 지원하는 환경 대비
  document.addEventListener("touchstart", startPress, { capture:true, passive:true });
  document.addEventListener("touchend", endPress, { capture:true, passive:true });
  document.addEventListener("touchcancel", endPress, { capture:true, passive:true });

  // 롱프레스가 트리거된 직후에는 코너 영역 클릭을 1회만 막아 "링크 오작동"을 방지합니다.
  document.addEventListener("click", (e) => {
    if (Date.now() > suppressClickUntil) return;
    // click 이벤트에는 touches가 없으므로 clientX/Y 사용
    if (inCorner(e)) {
      e.preventDefault();
      e.stopPropagation();
      suppressClickUntil = 0;
    }
  }, true);

  // panel buttons

  const bind = (id, fn) => {
    const el = document.getElementById(id);
    el && el.addEventListener("click", fn);
  };

  bind("sleepClose", closeSleepPanel);

  bind("sleepSelectStart", () => { _sleepEdit.target = "start"; updateSleepUI(); });
  bind("sleepSelectEnd", () => { _sleepEdit.target = "end"; updateSleepUI(); });

  bind("sleepMinusHour", () => {
    if (_sleepEdit.target === "start") _sleepEdit.start = _addMin(_sleepEdit.start, -60);
    else _sleepEdit.end = _addMin(_sleepEdit.end, -60);
    updateSleepUI();
  });
  bind("sleepMinus10", () => {
    if (_sleepEdit.target === "start") _sleepEdit.start = _addMin(_sleepEdit.start, -10);
    else _sleepEdit.end = _addMin(_sleepEdit.end, -10);
    updateSleepUI();
  });
  bind("sleepPlus10", () => {
    if (_sleepEdit.target === "start") _sleepEdit.start = _addMin(_sleepEdit.start, +10);
    else _sleepEdit.end = _addMin(_sleepEdit.end, +10);
    updateSleepUI();
  });
  bind("sleepPlusHour", () => {
    if (_sleepEdit.target === "start") _sleepEdit.start = _addMin(_sleepEdit.start, +60);
    else _sleepEdit.end = _addMin(_sleepEdit.end, +60);
    updateSleepUI();
  });

  bind("sleepModeBlack", () => { _sleepEdit.mode = "black"; updateSleepUI(); });
  bind("sleepModeSaver", () => { _sleepEdit.mode = "saver"; updateSleepUI(); });

  bind("sleepReset", () => {
    _sleepEdit = { ...DEFAULT_SLEEP, target: "start" };
    updateSleepUI();
  });

  bind("sleepSave", () => {
    _writeSavedSleep(_sleepEdit);
    SLEEP_MANUAL = null; // 저장하면 자동 스케줄로 복귀
    closeSleepPanel();
    tickSleep(); // apply immediately
  });


  // 프리셋(점주 원터치)
  bind("sleepPresetDefault", () => {
    _sleepEdit.start = "00:00";
    _sleepEdit.end   = "09:30";
    updateSleepUI();
  });
  bind("sleepPresetNight", () => {
    _sleepEdit.start = "04:00";
    _sleepEdit.end   = "14:00";
    updateSleepUI();
  });
  bind("sleepPresetOff", () => {
    // start==end => OFF(취침 비활성)
    _sleepEdit.start = "00:00";
    _sleepEdit.end   = "00:00";
    updateSleepUI();
  });

  // Optional key sequences (remote-friendly)
  let okCount = 0;
  let okTimer = null;

  const openDiagPanel = () => {
    try { els.diag.classList.add("open"); } catch {}
    try { updateDiag(); } catch {}
  };

  const seq = [];
  const pushSeq = (k) => {
    seq.push(k);
    while (seq.length > 4) seq.shift();
    if (seq.join(",") === "ArrowUp,ArrowUp,ArrowDown,ArrowDown") {
      openDiagPanel();
      seq.length = 0;
    }
  };

  window.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      okCount++;
      clearTimeout(okTimer);
      okTimer = setTimeout(() => { okCount = 0; }, 2000);
      if (okCount >= 7) { openDiagPanel(); okCount = 0; }
    }
    if (["ArrowUp","ArrowDown"].includes(e.key)) pushSeq(e.key);
  });
  tickSleep();
  setInterval(tickSleep, 10000);
}


let CONFIG = null;
let errorCount = 0;

function watchdogTouch(side, currentTime=0) {
  try {
    WD_STATE.lastTU[side] = Date.now();
    WD_STATE.lastCT[side] = currentTime || 0;
  } catch {}
}
function watchdogStall(side, why="") {
  // 가벼운 기록만 (실제 복구는 주기 체크에서)
  try { WD_STATE.stallHits += 1; } catch {}
}
function watchdogRecordError(reason="") {
  try {
    if (!CONFIG?.watchdogEnabled) return;
    if (SLEEP_ACTIVE) return;
    if (/offline/i.test(reason)) return;

    const now = Date.now();
    WD_STATE.errTimes.push(now);
    const win = CONFIG.watchdogWindowMs || 300000;
    WD_STATE.errTimes = WD_STATE.errTimes.filter(t => (now - t) < win);
  } catch {}
}
function watchdogSoftKick(reason="") {
  try {
    console.warn("[WATCHDOG] soft kick:", reason);
    leftPlayer.play();
    rightPlayer.play();
  } catch {}
}
function watchdogHardReload(reason="") {
  console.warn("[WATCHDOG] hard reload:", reason);
  try { triggerRestartNow(); } catch { try { location.reload(); } catch {} }
}

function setupWatchdog() {
  setInterval(() => {
    try {
      if (!CONFIG?.watchdogEnabled) return;
      if (SLEEP_ACTIVE) return;

      const now = Date.now();
      const stallMs = CONFIG.watchdogStallMs || 30000;

      // 1) 영상 timeupdate 정지 감지(30초)
      for (const side of ["LEFT", "RIGHT"]) {
        const player = side === "LEFT" ? leftPlayer : rightPlayer;
        const vid = player?.el?.vid;
        if (!vid) continue;

        const visible = vid.style.display === "block";
        if (!visible) continue;
        if (vid.paused) continue;

        const last = WD_STATE.lastTU[side] || 0;
        if (last && (now - last) > stallMs) {
          WD_STATE.lastTU[side] = now; // 반복 트리거 방지
          watchdogSoftKick(`${side} stalled`);
        }
      }

      // 2) 오류 누적(기준: 3회) → 하드 리로드
      const win = CONFIG.watchdogWindowMs || 300000;
      WD_STATE.errTimes = WD_STATE.errTimes.filter(t => (now - t) < win);
      if (WD_STATE.errTimes.length >= (CONFIG.watchdogMaxErrors || 3)) {
        WD_STATE.errTimes = [];
        watchdogHardReload(`errors >= ${CONFIG.watchdogMaxErrors || 3}`);
        return;
      }

      // 3) 메모리 경고(가능한 브라우저에서만)
      try {
        const pm = performance && performance.memory;
        if (pm && pm.usedJSHeapSize && pm.jsHeapSizeLimit) {
          const ratio = pm.usedJSHeapSize / pm.jsHeapSizeLimit;
          const th = CONFIG.watchdogMemThreshold || 0.88;
          if (ratio > th) {
            WD_STATE.memHits += 1;
            if (WD_STATE.memHits >= 3) {
              WD_STATE.memHits = 0;
              watchdogHardReload(`memory ${(ratio * 100).toFixed(0)}%`);
            }
          } else {
            WD_STATE.memHits = 0;
          }
        }
      } catch {}
    } catch {}
  }, 5000);
}


const MEDIA_CACHE = "lv-media-v3";
const STATIC_CACHE = "lv-static-v14";
const CACHE_STATE = { total: 0, done: 0, running: false, msg: "-" };
const NET_STATE = { online: navigator.onLine, lastProbe: null };

// ===== HEARTBEAT (TV online check) =====
// 목적: TV(현장)가 1분마다 서버에 "나 켜져있어요" 출석체크를 보내면,
//      관리자(admin)는 그 기록을 보고 TV가 온라인인지 확인할 수 있습니다.
//
// 사용법(URL):
// - TV 설치용:   ...?store=gobne&leftBase=...&role=tv
// - 관리자 확인: ...?store=gobne&leftBase=...&role=admin
// (선택) apiBase를 바꾸고 싶으면 &apiBase=https://localvision-api.kiklekidz.workers.dev

function qp(name, defVal="") {
  try { return new URLSearchParams(location.search).get(name) || defVal; } catch { return defVal; }
}
function getRole() {
  const r = String(qp("role","tv")).toLowerCase();
  return (r === "admin") ? "admin" : "tv";
}
function getApiBase() {
  // 기본값: 안준님이 쓰는 Worker API
  return String(qp("apiBase","https://localvision-api.kiklekidz.workers.dev")).replace(/\/+$/, "");
}
function getOrCreateDeviceId(role="tv") {
  // 기기마다 딱 1번만 만들고 계속 재사용(학생증 번호 같은 것)
  const key = role === "admin" ? "lv_admin_id_v1" : "lv_tv_id_v1";
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      const gen = (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now()+"-"+Math.random().toString(16).slice(2));
      id = (role === "admin" ? "admin-" : "tv-") + gen;
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return (role === "admin" ? "admin-" : "tv-") + (Date.now()+"");
  }
}

const HB_STATE = {
  role: "tv",
  deviceId: "-",
  apiBase: "-",
  lastSeenTs: 0,
  online: false
};

async function sendHeartbeat() {
  // 와이파이 약해도 재생이 멈추면 안 되니까: 실패해도 조용히 넘어감
  try {
    if (!CONFIG?.store) return;
    const url = `${HB_STATE.apiBase}/heartbeat`;
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        store: CONFIG.store,
        role: HB_STATE.role,       // tv 또는 admin
        deviceId: HB_STATE.deviceId,
        ts: Date.now(),
        build: (typeof LV_BUILD === "string" ? LV_BUILD : "unknown")
      }),
      cache: "no-store"
    });
  } catch {}
}

function fmtKorea(ts) {
  try { return new Date(ts).toLocaleString("ko-KR"); } catch { return "-"; }
}
function fmtAgo(ms) {
  const s = Math.floor(ms/1000);
  if (s < 60) return `${s}초 전`;
  const m = Math.floor(s/60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m/60);
  return `${h}시간 전`;
}

function renderTvStatus(online, lastSeen) {
  if (els.dTvStatus) els.dTvStatus.textContent = online ? "ONLINE ✅" : "OFFLINE ❌";
  if (els.dTvLastSeen) {
    els.dTvLastSeen.textContent = lastSeen ? `${fmtKorea(lastSeen)} (${fmtAgo(Date.now()-lastSeen)})` : "-";
  }
}

async function fetchTvStatusForAdmin() {
  try {
    if (HB_STATE.role !== "admin") return;
    if (!CONFIG?.store) return;

    // 서버에서 store별 tv 마지막 출석을 내려주는 API
    // 응답 예시: { online:true, lastSeen: 1700000000000, deviceId:"tv-..." }
    const url = `${HB_STATE.apiBase}/status?store=${encodeURIComponent(CONFIG.store)}&role=tv`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return;

    const data = await res.json();
    const online = !!data.online;
    const lastSeen = Number(data.lastSeen || 0);

    HB_STATE.online = online;
    HB_STATE.lastSeenTs = lastSeen;

    renderTvStatus(online, lastSeen);
  } catch {}
}

let PENDING_SYNC = false; // 오프라인이면 "다음 동기화 대기"
let LAST_SIG = { LEFT: "", RIGHT: "" };

// media cache 메타(LRU 비슷하게 ts/우선순위 관리)
const MEDIA_META_KEY = "lv_media_meta_v1";

// watchdog 상태
const WD_STATE = {
  lastTU: { LEFT: 0, RIGHT: 0 },
  lastCT: { LEFT: 0, RIGHT: 0 },
  errTimes: [],
  stallHits: 0,
  memHits: 0
};


function nowStr() {
  const d = new Date();
  const pad = (n)=> String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function setOnlineState(v, why="") {
  NET_STATE.online = !!v;
  NET_STATE.lastProbe = why ? `${nowStr()} ${why}` : nowStr();
  updateNetBadge();
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


function updateNetBadge() {
  if (!els.netDock || !els.netBadge) return;
  if (CONFIG && CONFIG.enableNetBadge === false) {
    els.netDock.style.display = "none";
    return;
  }
  const online = !!NET_STATE.online;
  const wait = !online && !!PENDING_SYNC;
  els.netDock.style.display = "";
  els.netBadge.textContent = wait ? "OFFLINE · SYNC WAIT" : (online ? "ONLINE" : "OFFLINE");
}


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

async function cachePut(url, res, meta={}) {
  const cache = await getMediaCache();
  try { await cache.put(url, res); } catch {}
  try {
    touchMediaMeta(url, {
      ts: Date.now(),
      pri: Number(meta.pri || meta.priority || 1),
      side: meta.side || meta.group || "",
      type: meta.type || (isVideo(url) ? "video" : "image")
    });
  } catch {}
}

async function cacheGet(url) {
  const cache = await getMediaCache();
  try { return await cache.match(url); } catch { return null; }
}

function readMediaMeta() {
  try { return JSON.parse(localStorage.getItem(MEDIA_META_KEY) || "{}") || {}; } catch { return {}; }
}
function writeMediaMeta(m) {
  try { localStorage.setItem(MEDIA_META_KEY, JSON.stringify(m || {})); } catch {}
}
function touchMediaMeta(url, patch={}) {
  if (!url) return;
  const meta = readMediaMeta();
  const prev = meta[url] || {};
  const priPrev = Number(prev.pri || 1);
  const priNew  = Number(patch.pri || priPrev || 1);
  meta[url] = {
    ...prev,
    ...patch,
    pri: Math.max(priPrev, priNew),
    ts: Number(patch.ts || Date.now()),
    type: patch.type || prev.type || (isVideo(url) ? "video" : "image")
  };
  writeMediaMeta(meta);
}

function collectKeepUrls() {
  const out = [];
  try {
    if (leftPlayer?.currentUrl) out.push(leftPlayer.currentUrl);
    if (rightPlayer?.currentUrl) out.push(rightPlayer.currentUrl);
    const ln = leftPlayer?.list || [];
    const rn = rightPlayer?.list || [];
    if (ln.length) out.push(ln[(leftPlayer.idx + 1) % ln.length]?.url);
    if (rn.length) out.push(rn[(rightPlayer.idx + 1) % rn.length]?.url);
  } catch {}
  return [...new Set(out.filter(Boolean))];
}

async function ensureCached(url, meta={}) {
  try {
    const hit = await cacheGet(url);
    if (hit) { touchMediaMeta(url, { ...meta, ts: Date.now() }); return true; }
    if (!NET_STATE.online) return false;

    const res = await fetch(url, { cache: "no-store" });
    if (res && res.ok) {
      await cachePut(url, res.clone(), meta);
      return true;
    }
  } catch {}
  return false;
}

async function pruneMediaCache({ keepUrls=[], maxEntries=12 } = {}) {
  try {
    const cache = await getMediaCache();
    const keys = await cache.keys();
    if (!keys || keys.length <= maxEntries) return;

    const keep = new Set((keepUrls || []).filter(Boolean));
    const meta = readMediaMeta();

    const entries = keys.map(req => {
      const u = req.url;
      const m = meta[u] || {};
      const pri = Number(m.pri || 1);
      const ts = Number(m.ts || 0);
      const type = m.type || (isVideo(u) ? "video" : "image");
      // 삭제 우선순위: (1) 우선순위 낮은 것 (2) video 먼저 (3) 오래된 것
      const typePri = type === "video" ? 0 : 1;
      return { req, u, pri, ts, typePri, keep: keep.has(u) };
    });

    const victims = entries
      .filter(e => !e.keep)
      .sort((a,b) => (a.pri - b.pri) || (a.typePri - b.typePri) || (a.ts - b.ts));

    let cur = keys.length;
    for (const v of victims) {
      if (cur <= maxEntries) break;
      await cache.delete(v.req);
      delete meta[v.u];
      cur -= 1;
    }
    writeMediaMeta(meta);
  } catch {}
}

async function prefetchUrls(urls=[], metaMap={}) {
  if (!CONFIG?.enableOfflineCache) return;
  if (!NET_STATE.online) return;
  const uniq = [...new Set(urls)].filter(Boolean);
  if (!uniq.length) return;

  for (const u of uniq) {
    const meta = (metaMap && metaMap[u]) ? metaMap[u] : {};
    await ensureCached(u, meta);
  }
}

async function prefetchAllMedia(urls=[], metaMap={}) {
  if (!CONFIG?.enableOfflineCache) return;
  if (!NET_STATE.online) return;

  const uniq = [...new Set(urls)].filter(Boolean);
  if (!uniq.length) return;

  CACHE_STATE.total = uniq.length;
  CACHE_STATE.done = 0;
  CACHE_STATE.running = true;
  CACHE_STATE.msg = "캐시 중...";

  for (const u of uniq) {
    try {
      const already = await cacheGet(u);
      if (already) touchMediaMeta(u, { ...(metaMap[u] || {}), ts: Date.now() });
      else await ensureCached(u, metaMap[u] || {});
    } catch {}
    CACHE_STATE.done += 1;
    updateDiag();
  }

  // 상한 초과 시: 오래된 것부터 삭제 (좌측(LEFT)은 더 오래 유지)
  try {
    const keep = collectKeepUrls().concat(uniq);
    await pruneMediaCache({ keepUrls: keep, maxEntries: CONFIG.cacheMaxEntries || 12 });
  } catch {}

  CACHE_STATE.running = false;
  CACHE_STATE.msg = "완료";
  updateDiag();
}


async function getVideoBlobUrlFromCache(url, meta={}) {
  const res = await cacheGet(url);
  if (!res) throw new Error("not cached");
  try { touchMediaMeta(url, { ...(meta||{}), ts: Date.now(), type: "video" }); } catch {}
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}


async function getVideoBlobUrl(url, meta={}) {
  // 1) 캐시에 있으면 캐시에서 blob으로
  let res = await cacheGet(url);

  // 2) 없으면(온라인일 때) 네트워크에서 통째로 받아 캐시에 저장
  if (!res && NET_STATE.online) {
    const netRes = await fetch(url, { cache: "no-store" });
    if (netRes && netRes.ok) {
      await cachePut(url, netRes.clone(), { ...(meta||{}), type: "video" });
      res = netRes;
    }
  }
  if (!res) throw new Error("video not available");

  try { touchMediaMeta(url, { ...(meta||{}), ts: Date.now(), type: "video" }); } catch {}
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

    dailyUpdateTime: params.get("update") || "09:10",
    playlistRefreshFallbackMs: numParam(params, "refresh", 3600000),

    // (운영용) 매일 새벽 자동 재시작/새로고침
    // - restart=HH:MM (기본 09:00)
    // - restartMode=auto|reload|fully (기본 auto)
    // - restartJitterSec=0.. (기본 180초, 여러 TV 동시부하 방지)
    // - restartWindowMin=... (기본 60분, 너무 늦게 깨면 오늘은 스킵)
    dailyRestartTime: params.get("restart") || "09:00",
    dailyRestartMode: params.get("restartMode") || "auto",
    restartJitterSec: numParam(params, "restartJitterSec", 180),
    restartWindowMin: numParam(params, "restartWindowMin", 60),

    enableOfflineCache: boolParam(params, "offline", true),
    cacheStrategy: params.get("cache") || "prefetch-next",

    // cache 관리(엔트리 수 기준)
    cacheMaxEntries: numParam(params, "cacheMax", 12),

    // 네트워크 배지(우하단, 호버 시 표시)
    enableNetBadge: boolParam(params, "netBadge", true),

    // 업데이트 안전 반영(미리 로드 확인)
    updatePrefetchTimeoutMs: numParam(params, "upPrefetch", 6000),

    // Watchdog(자가복구)
    watchdogEnabled: boolParam(params, "wd", true),
    watchdogStallMs: numParam(params, "wdStall", 30000),
    watchdogMaxErrors: numParam(params, "wdErr", 3),
    watchdogWindowMs: numParam(params, "wdWin", 300000),
    watchdogMemThreshold: numParam(params, "wdMem", 0.88),

    // ✅ 자동 버전 체크(무터치 업데이트): version.json 값이 바뀌면 자동 reload
    versionWatchEnabled: boolParam(params, "verWatch", true),
    versionCheckMs: numParam(params, "verCheckMs", 600000),
    versionReloadJitterSec: numParam(params, "verReloadJitterSec", 30),
    versionUrl: params.get("verUrl") || "./version.json",
    // 🔊 사운드(기본 OFF). autoplay 안정화를 위해 기본은 muted로 재생합니다.
    soundEnabled: boolParam(params, "sound", false),
    soundSide: (params.get("soundSide") || "LEFT").toUpperCase()
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

// ===== Autoplay / Gesture retry =====
// 일부 TV/브라우저(WebView 포함)에서는 "소리 ON 상태"에서 autoplay가 차단됩니다.
// 해결: 1) 항상 muted 로 먼저 재생 시도 2) 그래도 실패하면 첫 사용자 입력(pointer/key)에서 재시도.
const _lvGestureRetrySet = new WeakSet();
function registerGestureRetry(videoEl){
  if (!videoEl || _lvGestureRetrySet.has(videoEl)) return;
  _lvGestureRetrySet.add(videoEl);

  const retry = () => {
    try {
      videoEl.muted = true;
      const p = videoEl.play();
      if (p && typeof p.catch === "function") p.catch(()=>{});
    } catch {}
    window.removeEventListener("pointerdown", retry, true);
    window.removeEventListener("keydown", retry, true);
  };

  window.addEventListener("pointerdown", retry, true);
  window.addEventListener("keydown", retry, true);
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
    this._blobUrl = "";
    this._token = 0;
    this._waitTimer = null;

    el.vid.addEventListener("ended", () => this.next());
    el.vid.addEventListener("error", () => this.skip("video error"));
    el.ol.addEventListener("click", () => this.openLink());

    // watchdog용: timeupdate가 멈추면(멈춤/검은화면 등) 자가복구 트리거
    el.vid.addEventListener("timeupdate", () => watchdogTouch(this.name, el.vid.currentTime));
    el.vid.addEventListener("playing", () => {
      watchdogTouch(this.name, el.vid.currentTime);
      // 사운드 옵션: 지정한 사이드만 재생 중일 때만 unmute
      try {
        const side = (CONFIG?.soundSide || "LEFT");
        if (CONFIG?.soundEnabled && side === this.name) el.vid.muted = false;
      } catch {}
    });
el.vid.addEventListener("stalled", () => watchdogStall(this.name, "stalled"));
    el.vid.addEventListener("waiting", () => watchdogStall(this.name, "waiting"));
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

  pauseForSleep() {
    try { clearTimeout(this.loadTimer); } catch {}
    try { clearTimeout(this.imgTimer); } catch {}
    try { clearTimeout(this._waitTimer); } catch {}
    try { this.el.vid.muted = true; this.el.vid.pause(); } catch {}
  }

  _meta(type, url) {
    return {
      pri: this.name === "LEFT" ? 2 : 1,
      side: this.name,
      type: type || (isVideo(url) ? "video" : "image")
    };
  }

  async _waitForOnline(reason="") {
    clearTimeout(this.loadTimer);
    clearTimeout(this.imgTimer);
    clearTimeout(this._waitTimer);

    this.showPh(`OFFLINE: 캐시 없음 (동기화 대기)`);
    // 온라인 복귀 시 자동 재생
    this._waitTimer = setTimeout(() => {
      if (NET_STATE.online && !SLEEP_ACTIVE) this.play();
      else this._waitForOnline(reason);
    }, 20000);
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
    clearTimeout(this._waitTimer);

    this.showPh("불러오는 중…");

    this.loadTimer = setTimeout(() => {
      this.skip("load timeout");
    }, CONFIG.loadTimeoutMs);

    // 다음 콘텐츠 미리 캐시(무중단/오프라인 대비)
    this.prefetchNext();

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

    const meta = this._meta("video", url);

    // 공통: 준비되면 표시
    this.el.vid.oncanplay = () => {
      clearTimeout(this.loadTimer);
      this.el.ph.style.display = "none";
      this.el.vid.style.display = "block";

      // ✅ autoplay 안정화: "muted 상태"로 먼저 재생 (TV/브라우저 정책 대응)
      this.el.vid.muted = true;
      const p = this.el.vid.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => {
          // autoplay가 막히면 첫 사용자 입력에서 재시도
          registerGestureRetry(this.el.vid);
        });
      }
    };

    this.el.vid.onerror = () => {
      clearTimeout(this.loadTimer);
      this.skip("video error");
    };

    const online = !!NET_STATE.online;

    if (online) {
      // 1) 즉시 스트리밍 재생 (빠름)
      try { this.el.vid.removeAttribute("crossorigin"); } catch {} // CORS 없더라도 재생되게
      this.el.vid.src = url;
      this.el.vid.load();

      // 2) 동시에 캐시 저장(백그라운드) — 오프라인 대비
      ensureCached(url, meta).catch(()=>{});
      try { touchMediaMeta(url, { ...meta, ts: Date.now() }); } catch {}

      return;
    }

    // 오프라인이면: 캐시된 blob으로만 재생 가능
    (async () => {
      try {
        const hit = await cacheHas(url);
        if (!hit) return this._waitForOnline("offline no cached video");

        const blobUrl = await getVideoBlobUrlFromCache(url, meta);

        // 최신 요청만 살림
        if (token !== this._token) {
          try { URL.revokeObjectURL(blobUrl); } catch {}
          return;
        }
        this._blobUrl = blobUrl;

        this.el.vid.src = blobUrl;
        this.el.vid.load();
      } catch (e) {
        this._waitForOnline("offline no cached video");
      }
    })();
  }

  playImage(url, durationSec) {
    const meta = this._meta("image", url);

    // stop video
    this.el.vid.pause();
    this.el.vid.removeAttribute("src");
    this.el.vid.load();

    this.el.vid.style.display = "none";
    this.el.img.style.display = "none";

    // 오프라인 + 캐시 없음이면 "대기"로 전환(무한 스킵 방지)
    if (!NET_STATE.online) {
      cacheHas(url).then((hit) => {
        if (!hit) return this._waitForOnline("offline no cached image");
        // 캐시가 있으면 정상 로드 진행
        this._loadImage(url, durationSec, meta);
      }).catch(() => this._waitForOnline("offline no cached image"));
      return;
    }

    this._loadImage(url, durationSec, meta);
  }

  _loadImage(url, durationSec, meta) {
    this.el.img.onload = () => {
      clearTimeout(this.loadTimer);
      this.el.ph.style.display = "none";
      this.el.img.style.display = "block";

      try { touchMediaMeta(url, { ...meta, ts: Date.now() }); } catch {}

      clearTimeout(this.imgTimer);
      this.imgTimer = setTimeout(() => this.next(), durationSec * 1000);
    };
    this.el.img.onerror = () => this.skip("image error");
    this.el.img.src = url;

    // 백그라운드 캐시(온라인일 때)
    ensureCached(url, meta).catch(()=>{});
  }

  getNextUrls(n=2) {
    const out = [];
    const L = this.list.length;
    if (!L) return out;
    for (let k=1; k<=n; k++) {
      const item = this.list[(this.idx + k) % L];
      if (item && item.url) out.push(item.url);
    }
    return out;
  }

  prefetchNext() {
    if (!CONFIG?.enableOfflineCache) return;
    if (!NET_STATE.online) return;

    const urls = this.getNextUrls(2);
    if (!urls.length) return;

    const metaMap = {};
    for (const u of urls) metaMap[u] = this._meta(isVideo(u) ? "video" : "image", u);

    // 가볍게 미리 캐시만(진단용 카운트/정리까지는 updatePlaylists에서)
    prefetchUrls(urls, metaMap).then(() => {
      // 상한 관리(오래된 것부터)
      pruneMediaCache({ keepUrls: collectKeepUrls().concat(urls), maxEntries: CONFIG.cacheMaxEntries || 12 }).catch(()=>{});
    }).catch(()=>{});
  }

  next() {
    this.idx = (this.idx + 1) % Math.max(this.list.length, 1);
    this.play();
  }

  skip(reason) {
    // 오프라인 캐시 없음은 watchdog/에러카운트로 잡지 않음(대기 모드로 처리)
    if (/offline/i.test(reason)) {
      return this._waitForOnline(reason);
    }

    errorCount += 1;
    watchdogRecordError(reason);
    console.warn(`[${this.name}] skip: ${reason}`);
    els.dErr.textContent = String(errorCount);

    clearTimeout(this.loadTimer);
    clearTimeout(this.imgTimer);
    clearTimeout(this._waitTimer);

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

  if (els.dBuild) {
    const r = (typeof LV_REMOTE_BUILD === 'string' && LV_REMOTE_BUILD !== '-') ? ` (remote:${LV_REMOTE_BUILD})` : '';
    els.dBuild.textContent = `${LV_BUILD_DETAIL}${r}`;
  }

  // 취침 상태 표시
  if (els.dSleep) {
    const r = _sleepResolved || { start: "00:00", end: "09:30", mode: "black", _src: "-" };
    const modeLabel = (r.mode === "screensaver") ? "세이버" : "블랙";
    const manualLabel = (SLEEP_MANUAL === null) ? "자동" : (SLEEP_MANUAL ? "수동ON" : "수동OFF");
    const onLabel = SLEEP_ACTIVE ? "ON" : "OFF";
    els.dSleep.textContent = `${onLabel} · ${manualLabel} · ${r.start}~${r.end} · ${modeLabel} · ${r._src}`;
  }

  // 진단패널 버튼 라벨(리모컨 OK로 조작 가능)
  if (els.btnSleepToggle) {
    els.btnSleepToggle.textContent =
      (SLEEP_MANUAL !== null) ? "수동해제" : (SLEEP_ACTIVE ? "즉시OFF" : "즉시ON");
  }

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

function msUntilNextTime(hhmm) {
  const parts = String(hhmm || "").split(":");
  if (parts.length < 2) return null;
  const hh = Number(parts[0]);
  const mm = Number(parts[1]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;

  const now = new Date();
  const next = new Date(now);
  next.setHours(hh, mm, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

async function triggerRestartNow(reason = "manual") {
  // 최신 파일(sw/app.js 등) 받게끔, 재시작 전에 SW 업데이트를 한 번 시도
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
    }
  } catch {}

  // 브라우저만 쓰는 운영환경에서 "리로드해도 옛날 파일이 계속 뜨는" 문제를 줄이기 위해
  // (SW cache-first 때문에) 온라인일 때 정적 캐시를 한 번 비운 뒤 리로드합니다.
  try {
    if (navigator.onLine && ("caches" in window)) {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(k => k.startsWith("lv-static"))
          .map(k => caches.delete(k))
      );
    }
  } catch {}

  const mode = (CONFIG.dailyRestartMode || "auto").toLowerCase();
  const hasFully = (typeof window.fully !== "undefined") && (typeof window.fully.restartApp === "function");

  // Fully Kiosk(PLUS)에서 JavaScript Interface가 켜져 있으면 앱 자체 재시작 가능
  // docs: fully.restartApp() 제공
  if (mode === "fully" || (mode === "auto" && hasFully)) {
    try {
      window.fully.restartApp();
      return;
    } catch {}
  }

  // 일반 브라우저/웹뷰: 페이지 리로드(=소프트 재시작)
  try {
    localStorage.setItem("lv_last_restart", `${nowStr()} (${reason})`);
  } catch {}
  location.reload();
}

function scheduleDailyRestart() {
  const t = CONFIG.dailyRestartTime;
  if (!t) return;

  const baseDelay = msUntilNextTime(t);
  if (baseDelay == null) {
    console.warn("Invalid dailyRestartTime:", t);
    return;
  }

  const jitterMs = Math.max(0, Number(CONFIG.restartJitterSec || 0)) * 1000;
  const add = jitterMs ? Math.floor(Math.random() * jitterMs) : 0;
  const plannedAt = Date.now() + baseDelay + add;

  console.log("Next restart scheduled at:", new Date(plannedAt).toString(), `(target ${t}, +${Math.round(add/1000)}s)`);

  setTimeout(async () => {
    // 기기가 슬립 상태였다가 한참 뒤에 깨어나면, 영업시간에 갑자기 리로드될 수 있음 → 윈도우 밖이면 스킵
    const lateMs = Date.now() - plannedAt;
    const windowMs = Math.max(0, Number(CONFIG.restartWindowMin || 60)) * 60 * 1000;
    if (lateMs > windowMs) {
      console.log("Daily restart skipped (too late):", `${Math.round(lateMs/60000)}m late`);
      scheduleDailyRestart();
      return;
    }

    await triggerRestartNow("daily");
    // 리로드/재시작이 성공하면 이 아래는 보통 실행되지 않음.
    scheduleDailyRestart();
  }, baseDelay + add);
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

function listSignature(list=[]) {
  try {
    return JSON.stringify((list||[]).map(x => ({
      u: x.url || "",
      d: Number(x.duration) || 0,
      l: x.link || ""
    })));
  } catch { return ""; }
}

function preflightMedia(url, timeoutMs=6000) {
  return new Promise((resolve) => {
    if (!url) return resolve(false);

    const to = setTimeout(() => cleanup(false), Math.max(500, timeoutMs|0));

    function cleanup(ok) {
      clearTimeout(to);
      try { el && el.remove(); } catch {}
      resolve(!!ok);
    }

    let el = null;

    // 이미지: 실제 로드 가능 여부 확인
    if (isImage(url)) {
      el = new Image();
      el.onload = () => cleanup(true);
      el.onerror = () => cleanup(false);
      el.src = url;
      return;
    }

    // 영상: metadata 로드로 확인(실제 재생과 가장 가까움)
    if (isVideo(url)) {
      el = document.createElement("video");
      el.preload = "metadata";
      el.muted = true;
      el.playsInline = true;
      el.onloadedmetadata = () => cleanup(true);
      el.onerror = () => cleanup(false);
      el.src = url;
      try { el.load(); } catch {}
      return;
    }

    cleanup(false);
  });
}

async function preflightBatch(urls=[], timeoutMs=6000) {
  const uniq = [...new Set((urls||[]).filter(Boolean))];
  for (const u of uniq) {
    const ok = await preflightMedia(u, timeoutMs);
    if (!ok) return false;
  }
  return true;
}

async function updatePlaylists(reason="") {
  const when = nowStr();
  updateNetBadge();

  const leftUrl = resolveUrl(CONFIG.leftPlaylistUrl);
  const rightUrl = resolveUrl(CONFIG.rightPlaylistUrl);

  // 오프라인이면: 캐시 재생 + 다음 동기화 대기
  if (!NET_STATE.online) {
    PENDING_SYNC = true;
    updateNetBadge();

    const leftCached = loadPlaylistCache("LEFT", []);
    const rightCached = loadPlaylistCache("RIGHT", []);

    if (leftCached.length) leftPlayer.setList(leftCached);
    if (rightCached.length) rightPlayer.setList(rightCached);

    if (!SLEEP_ACTIVE) {
      if (!leftPlayer.currentUrl) leftPlayer.play();
      if (!rightPlayer.currentUrl) rightPlayer.play();
    }

    localStorage.setItem("lv_last_update", `${when} (OFFLINE: sync wait)`);
    updateDiag();
    return;
  }

  PENDING_SYNC = false;
  updateNetBadge();

  try {
    const [leftJson, rightJson] = await Promise.all([
      safeFetchJson(leftUrl),
      safeFetchJson(rightUrl)
    ]);

    const leftList = normalizeList(leftJson, leftUrl);
    const rightList = normalizeList(rightJson, rightUrl);

    // playlist가 비었거나 깨졌으면 롤백
    if (!leftList.length || !rightList.length) {
      throw new Error("playlist empty");
    }

    const sigL = listSignature(leftList);
    const sigR = listSignature(rightList);

    const changed = (sigL !== LAST_SIG.LEFT) || (sigR !== LAST_SIG.RIGHT);

    // 변경 없으면 재시작 없이 타임스탬프만 갱신
    if (!changed) {
      localStorage.setItem("lv_last_update", `${when} (no change)`);
      updateDiag();
      return;
    }

    // ✅ 업데이트 안전 반영: 다음 콘텐츠를 먼저 로드 확인 후에만 교체
    const preUrls = [];
    for (const it of leftList.slice(0, 2)) if (it?.url) preUrls.push(it.url);
    for (const it of rightList.slice(0, 2)) if (it?.url) preUrls.push(it.url);

    const preOK = await preflightBatch(preUrls, CONFIG.updatePrefetchTimeoutMs || 6000);
    if (!preOK) {
      const haveCache = loadPlaylistCache("LEFT", []).length && loadPlaylistCache("RIGHT", []).length;
      // 최초 실행 등 캐시가 없는 경우엔 "안전반영"을 완화하여 일단 재생은 하되, 이후 업데이트에서 다시 검증
      if (haveCache) throw new Error("preflight failed");
      console.warn("[UPDATE] preflight failed (no cache). applying anyway.");
    }

    // 적용 + 마지막 정상본 저장
    leftPlayer.setList(leftList);
    rightPlayer.setList(rightList);
    savePlaylistCache("LEFT", leftList);
    savePlaylistCache("RIGHT", rightList);
    LAST_SIG.LEFT = sigL;
    LAST_SIG.RIGHT = sigR;

    // 캐시 전략에 따라 선캐시(오프라인/끊김 방지)
    if (CONFIG.enableOfflineCache) {
      let urls = [];
      const metaMap = {};

      const mark = (u, pri, side) => {
        if (!u) return;
        urls.push(u);
        metaMap[u] = {
          pri,
          side,
          type: isVideo(u) ? "video" : "image"
        };
      };

      if (CONFIG.cacheStrategy === "cache-all") {
        for (const it of leftList) mark(it.url, 2, "LEFT");
        for (const it of rightList) mark(it.url, 1, "RIGHT");
      } else {
        // 기본: 다음 2개씩만 캐시(총 4개 + 현재)
        for (const it of leftList.slice(0, 2)) mark(it.url, 2, "LEFT");
        for (const it of rightList.slice(0, 2)) mark(it.url, 1, "RIGHT");
      }

      urls = [...new Set(urls)].filter(Boolean);
      await prefetchAllMedia(urls, metaMap);
    }

    // 재생(무중단에 가깝게: 새 리스트 적용 후 바로)
    if (!SLEEP_ACTIVE) {
      leftPlayer.play();
      rightPlayer.play();
    }

    localStorage.setItem("lv_last_update", `${when} (${reason || "updated"})`);
    updateDiag();
  } catch (e) {
    console.warn("updatePlaylists failed:", e);
    errorCount += 1;

    // 롤백: 마지막 정상본
    const leftCached = loadPlaylistCache("LEFT", []);
    const rightCached = loadPlaylistCache("RIGHT", []);

    if (leftCached.length) {
      leftPlayer.setList(leftCached);
      LAST_SIG.LEFT = listSignature(leftCached);
    }
    if (rightCached.length) {
      rightPlayer.setList(rightCached);
      LAST_SIG.RIGHT = listSignature(rightCached);
    }

    if (!SLEEP_ACTIVE) {
      if (!leftPlayer.currentUrl) leftPlayer.play();
      if (!rightPlayer.currentUrl) rightPlayer.play();
    }


    // 캐시도 없으면, 화면에 이유를 표시(무한 '로딩 중' 방지)
    if (!leftCached.length) leftPlayer.showPh("LEFT 로딩 실패 (진단패널 확인)");
    if (!rightCached.length) rightPlayer.showPh("RIGHT 로딩 실패 (진단패널 확인)");

    localStorage.setItem("lv_last_update", `${when} (ROLLBACK)`);
    updateDiag();
  }
}

function setupDiagToggle() {
  // 좌상단 5번 탭하면 진단 패널 열기/닫기
  let count = 0;
  let timer = null;


  // 롱프레스(1.2s)로도 진단 패널 토글 (터치 인식 개선)
  let holdT = null;
  const holdStart = () => {
    clearTimeout(holdT);
    holdT = setTimeout(() => {
      els.diag.classList.toggle("open");
      updateDiag();
    }, 1200);
  };
  const holdEnd = () => { clearTimeout(holdT); };
  els.hotspot.addEventListener("pointerdown", holdStart);
  els.hotspot.addEventListener("pointerup", holdEnd);
  els.hotspot.addEventListener("pointercancel", holdEnd);
  els.hotspot.addEventListener("pointerleave", holdEnd);

  els.hotspot.addEventListener("click", () => {
    count += 1;
    clearTimeout(timer);
    timer = setTimeout(() => { count = 0; }, 2500);

    if (count >= 5) {
      els.diag.classList.toggle("open");
      count = 0;
      updateDiag();
    }
  });

  window.addEventListener("online", () => {
    setOnlineState(true, "(event online)");
    const wasPending = PENDING_SYNC;
    PENDING_SYNC = false;
    updateNetBadge();
    probeOnline();
    if (wasPending) updatePlaylists("online");
    updateDiag();
  });

  window.addEventListener("offline", () => {
    setOnlineState(false, "(event offline)");
    PENDING_SYNC = true;
    updateNetBadge();
    updateDiag();
  });
}




function setupSWControllerReload() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // 새 SW가 컨트롤러로 바뀌면 한 번만 자동 리로드
    try {
      if (sessionStorage.getItem('lv_sw_controller_reload') === '1') return;
      sessionStorage.setItem('lv_sw_controller_reload', '1');
    } catch {}
    setTimeout(() => {
      try { location.reload(); } catch {}
    }, 300);
  });
}

async function fetchRemoteBuild() {
  const url = (CONFIG.versionUrl || './version.json');
  // 캐시/엣지 영향 최소화: 쿼리 스티커 + no-store
  const u = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
  const res = await fetch(u, { cache: 'no-store' });
  if (!res.ok) throw new Error('version fetch ' + res.status);
  const data = await res.json();
  const build = String(data.build ?? data.version ?? data.v ?? '').trim();
  return build || '-';
}

function scheduleAutoReload(reason, targetBuild) {
  if (_lvUpdateReloadScheduled) return;
  _lvUpdateReloadScheduled = true;

  const jitterMs = Math.max(0, Number(CONFIG.versionReloadJitterSec || 30)) * 1000;
  const delay = 2000 + Math.floor(Math.random() * (jitterMs + 1));

  try { localStorage.setItem('lv_version_target', String(targetBuild || '')); } catch {}
  try { localStorage.setItem('lv_version_reload_planned', String(Date.now() + delay)); } catch {}

  console.log('[VERSION] change detected → reload scheduled in', Math.round(delay/1000),'s', reason, targetBuild);
  setTimeout(() => {
    try { localStorage.setItem('lv_version_last_reload', String(Date.now())); } catch {}
    try { location.reload(); } catch {}
  }, delay);
}

function setupVersionWatcher() {
  if (!CONFIG.versionWatchEnabled) return;

  // 디바이스가 계속 리로드 루프에 빠지지 않도록 최소 간격 제한
  const MIN_GAP_MS = 10 * 60 * 1000;

  const tick = async () => {
    try {
      if (!navigator.onLine) return;
      LV_REMOTE_BUILD = await fetchRemoteBuild();
      updateDiag();

      if (LV_REMOTE_BUILD !== '-' && LV_REMOTE_BUILD !== LV_BUILD) {
        let last = 0;
        try { last = Number(localStorage.getItem('lv_version_last_reload') || 0); } catch {}
        if (Date.now() - last < MIN_GAP_MS) {
          console.log('[VERSION] detected but throttled');
          return;
        }
        scheduleAutoReload('remote build differs', LV_REMOTE_BUILD);
      }
    } catch (e) {
      // 조용히 실패: 네트워크/캐시 이슈 가능
    }
  };

  const base = Math.max(60000, Number(CONFIG.versionCheckMs || 600000));
  const firstDelay = 15000 + Math.floor(Math.random() * 15000);
  setTimeout(() => {
    tick();
    setInterval(tick, base);
  }, firstDelay);
}

(async function init(){
  // ✅ 진단은 가장 먼저(초기화 실패해도 동작)
  setupDiagToggle();
  setupSleepUI();
  setupSWControllerReload();

  // ✅ 진단패널에서 취침 설정/즉시토글(리모컨 OK로 조작 가능)
  if (els.btnSleepOpen) els.btnSleepOpen.addEventListener("click", () => { SLEEP_MANUAL = null; openSleepPanel(); });
  if (els.btnSleepToggle) els.btnSleepToggle.addEventListener("click", () => { toggleManualSleep(); });

  // ✅ 진단패널: 수동 새로고침(리모컨으로도 가능)
  if (els.btnReload) els.btnReload.addEventListener("click", () => { triggerRestartNow("diag_reload"); });

  updateDiag();

  try {
    CONFIG = await loadConfig();
    console.log("CONFIG:", CONFIG);
    updateNetBadge();
    setupWatchdog();

    await maybeRegisterSW();
    await probeOnline(2000);
    await updatePlaylists("startup");
  } catch (e) {
    console.warn("init failed:", e);
    // 초기화 실패 시에도 fullscreen 버튼은 동작해야 함
  }

  // 23:30 업데이트 예약
  scheduleDailyUpdate();

  // (기본) 매일 리스타트 예약
  scheduleDailyRestart();

  // ✅ v7: 버전 체크로 무터치 자동 업데이트
  setupVersionWatcher();

  // 혹시 23:30 타이밍을 놓쳤거나, 네트워크가 복구되었을 때를 대비한 fallback
  setInterval(() => updatePlaylists("fallback"), CONFIG.playlistRefreshFallbackMs || 3600000);

  // 온라인 상태 주기 체크(진짜 연결 여부)
  setInterval(() => probeOnline(2000), 5000);

  // 진단 패널 주기 업데이트
  setInterval(updateDiag, 2000);
})();
