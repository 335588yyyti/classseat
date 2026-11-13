'use strict';

/* =========================================================
   教室座位安排 — 純前端、資料存在瀏覽器 localStorage
   ========================================================= */

const MIN_N = 26;
const MAX_N = 40;
const DESK_W = 104;
const DESK_H = 60;
const PODIUM_SPACE = 70;
const STORE_KEY = 'classseat-v1';
const WEIGHT_MUL = { 1: 1, 2: 3, 3: 8 };
const WEIGHT_LABEL = { 1: '低', 2: '中', 3: '高' };
const TAG_COLORS = ['#7c3aed', '#0891b2', '#ea580c', '#16a34a', '#db2777', '#4f46e5', '#ca8a04', '#64748b'];
const STRATEGY_LABEL = { front: '盡量前排', back: '盡量後排', spread: '彼此分散', none: '僅標示' };
const PREF_LABEL = { any: '不限', front: '盡量前排', back: '盡量後排' };
const HLEVEL_LABEL = { short: '矮', midshort: '中矮', mid: '中', midtall: '中高', tall: '高' };
const HLEVEL_TARGET = { short: 0.1, midshort: 0.3, mid: 0.5, midtall: 0.7, tall: 0.9 };
/** 身高顯示文字：有公分顯示公分，否則顯示身高等級 */
const heightText = (s) => (s.height ? `${s.height}` : s.hlevel ? HLEVEL_LABEL[s.hlevel] : '');
const HPREF_LABEL = { any: '不限', outer: '盡量外側', center: '盡量中間' };
const LAYOUT_LABEL = { rows: '直排', groups: '分組', u: 'ㄇ字型' };
// 座位圖（type: 'map'）：自己存的桌椅位置，可以有很多張，例如「本班」「段考」
const isTemplate = (type = state.layout.type) => type === 'map';
const currentMap = () => (state.layout.type === 'map' ? state.maps.find((m) => m.id === state.layout.mapId) : null);
const templateFrom = (seats) => seats.map(({ x, y, group }) => ({ x, y, group }));

// 自訂版型的預設值：依班上座位圖（黑板在上方，共 27 個座位、5 組）
const CLASS_LAYOUT = [
  // 第 1 組：左前方兩欄
  [0, 0, 'G1'], [112, 0, 'G1'], [0, 80, 'G1'], [112, 80, 'G1'], [0, 160, 'G1'], [112, 160, 'G1'], [0, 240, 'G1'],
  // 第 2 組：中間前方三角形（前 3、中 2、後 1）
  [330, 0, 'G2'], [442, 0, 'G2'], [554, 0, 'G2'], [386, 90, 'G2'], [498, 90, 'G2'], [442, 180, 'G2'],
  // 第 3 組：右邊六角形
  [790, 90, 'G3'], [734, 170, 'G3'], [846, 170, 'G3'], [734, 250, 'G3'], [846, 250, 'G3'], [790, 330, 'G3'],
  // 第 4 組：左後方 2×2
  [56, 360, 'G4'], [168, 360, 'G4'], [56, 440, 'G4'], [168, 440, 'G4'],
  // 第 5 組：中間後方 2×2
  [400, 360, 'G5'], [512, 360, 'G5'], [400, 440, 'G5'], [512, 440, 'G5'],
].map(([x, y, group]) => ({ x, y, group }));

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------------- state ---------------- */

function newStudent(no) {
  return {
    id: uid(), no, name: '學生' + no, gender: '', myopia: false, height: '', hlevel: '', note: '',
    tags: [], avoidAdj: [], avoidGroup: [], preferGroup: [], pref: 'any', hpref: 'any',
  };
}

function defaultState() {
  const s = {
    className: '',
    students: [],
    tags: [
      { id: uid(), name: '需要關注', strategy: 'front', weight: 2 },
      { id: uid(), name: '容易聊天', strategy: 'spread', weight: 2 },
    ],
    conditions: {
      myopia: { on: true, weight: 3 },
      height: { on: true, weight: 2 },
      gender: { on: true, weight: 1 },
      prevSeat: { on: true, weight: 3, n: 1 },
      prevSide: { on: true, weight: 2 },
      prevGroup: { on: true, weight: 2 },
      adjRange: 'gap', // 不可相鄰的範圍：touch 貼在一起、gap 隔一點也算、group 同一組也算
    },
    layout: { type: 'map', mapId: 'class', cols: 6, paired: true, groups: 6 },
    maps: [{ id: 'class', name: '本班', seats: CLASS_LAYOUT.map((p) => ({ ...p })) }],
    // 老師暗中安排：fixed 座位→一定抽到的學生；ban 座位→一定不會抽到的學生；apart 不能坐隔壁的兩人
    secret: { fixed: {}, ban: {}, apart: [], backup: {} },
    // 抽籤設定（在「說明」面板裡調整）
    drawOpts: { mode: 'cond', order: 'front', speed: 'mid', sound: 'on' },
    seats: [],
    assign: {}, // seatId -> studentId
    pool: [], // 還沒放進座位的名條（老師一個一個放）
    locked: [], // studentIds
    flipped: false,
    custom: false,
    tab: 'students',
    mode: 'swap',
  };
  for (let i = 1; i <= 30; i++) s.students.push(newStudent(i));
  return s;
}

function load() {
  try {
    const raw = store().getItem(storeKey());
    if (!raw) return null;
    return normalize(JSON.parse(raw));
  } catch {
    return null;
  }
}

function normalize(data) {
  if (!data || !Array.isArray(data.students)) return null;
  const d = defaultState();
  const s = { ...d, ...data };
  s.conditions = { ...d.conditions, ...(data.conditions || {}) };
  s.layout = { ...d.layout, ...(data.layout || {}) };
  s.tags = Array.isArray(data.tags) ? data.tags : d.tags;
  s.students = data.students.map((st, i) => ({ ...newStudent(i + 1), ...st }));
  s.seats = Array.isArray(data.seats) ? data.seats : [];
  if (Array.isArray(data.maps)) {
    s.maps = data.maps;
  } else {
    // 舊版資料：「本班」「自訂」轉成座位圖
    s.maps = [{ id: 'class', name: '本班', seats: data.customLayout?.length ? data.customLayout : d.maps[0].seats }];
    if (data.freeLayout?.length) s.maps.push({ id: 'free', name: '自訂', seats: data.freeLayout });
    if (s.layout.type === 'custom') s.layout = { ...s.layout, type: 'map', mapId: 'class' };
    if (s.layout.type === 'free') s.layout = { ...s.layout, type: 'map', mapId: data.freeLayout?.length ? 'free' : 'class' };
  }
  if (!data.layout) s.layout.type = 'rows';
  if (s.layout.type === 'map' && !s.maps.some((m) => m.id === s.layout.mapId)) {
    if (s.maps.length) s.layout.mapId = s.maps[0].id; else s.layout.type = 'rows';
  }
  s.secret = { fixed: {}, ban: {}, apart: [], backup: {}, ...(data.secret || {}) };
  s.drawOpts = { ...d.drawOpts, ...(data.drawOpts || {}) };
  s.plans = Array.isArray(data.plans) ? data.plans : [];
  delete s.customLayout;
  delete s.freeLayout;
  s.assign = data.assign && typeof data.assign === 'object' ? data.assign : {};
  s.pool = Array.isArray(data.pool) ? data.pool : [];
  s.locked = Array.isArray(data.locked) ? data.locked : [];
  return s;
}

/* ---------- 雲端（Firebase）：班級代碼＋老師密碼 ---------- */
// 把 Firebase 專案的設定貼在這裡（Firebase 主控台 → 專案設定 → 你的應用程式 → SDK 設定），雲端功能就會出現
// 例：{ apiKey: '...', authDomain: '...firebaseapp.com', projectId: '...', appId: '...' }
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAvD9tWYPTmh9Ty4X911goTnoCXLja3jrQ',
  authDomain: 'homeworksystem-eca4b.firebaseapp.com',
  projectId: 'homeworksystem-eca4b',
  storageBucket: 'homeworksystem-eca4b.firebasestorage.app',
  messagingSenderId: '652457196206',
  appId: '1:652457196206:web:e5b1fe2f2d5d438ee48b3f',
};
const FB_CONFIG_KEY = 'classseat-firebase-config';
const SESSION_KEY = 'classseat-session';
const classKey = (code) => 'classseat-class:' + code;
function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}
function setSession(sess) {
  if (sess?.kiosk) { try { sessionStorage.setItem(KIOSK_KEY, JSON.stringify(sess)); } catch { /* ignore */ } return; }
  try {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    if (sess) (sess.remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify(sess));
  } catch { /* 無痕模式等情況 */ }
}
/* 同一台裝置登入的其他班級（科任老師一人好幾班）：班級代碼 → 登入資訊 */
const OTHERS_KEY = 'classseat-others';
function getOthers() {
  const read = (st) => { try { return JSON.parse(st.getItem(OTHERS_KEY) || '{}') || {}; } catch { return {}; } };
  return { ...read(sessionStorage), ...read(localStorage) };
}
function setOthers(map) {
  const keep = {}, temp = {};
  for (const [k, v] of Object.entries(map)) (v.remember ? keep : temp)[k] = v;
  try {
    localStorage.setItem(OTHERS_KEY, JSON.stringify(keep));
    sessionStorage.setItem(OTHERS_KEY, JSON.stringify(temp));
  } catch { /* ignore */ }
}
/* 抽籤專用連結：#draw=班級代碼&t=連結代碼。打開後馬上把網址列上的連結代碼拿掉，只存在這個分頁 */
const KIOSK_KEY = 'classseat-kiosk';
function readKiosk() {
  const m = location.hash.match(/^#draw=([^&]+)&t=([^&]+)/);
  if (m) {
    const k = { kiosk: true, code: decodeURIComponent(m[1]), token: m[2], updatedAt: 0, syncedHash: '' };
    try { sessionStorage.setItem(KIOSK_KEY, JSON.stringify(k)); } catch { /* ignore */ }
    history.replaceState(null, '', location.pathname + location.search);
    return k;
  }
  try { return JSON.parse(sessionStorage.getItem(KIOSK_KEY) || 'null'); } catch { return null; }
}
const KIOSK = readKiosk();
// 已經開著網頁時又點了抽籤連結：重新載入成抽籤模式
window.addEventListener('hashchange', () => { if (/^#draw=/.test(location.hash)) location.reload(); });
const cloud = { session: KIOSK || getSession(), status: 'idle', busy: false, pending: false, timer: null };
const storeKey = () => (cloud.session ? (cloud.session.kiosk ? 'classseat-kiosk-data:' : 'classseat-class:') + cloud.session.code : STORE_KEY);
// 抽籤專用模式的資料只放在這個分頁（關掉就沒了），不會留在學校的電腦上
const store = () => (cloud.session?.kiosk ? sessionStorage : localStorage);
/** 字串的簡單雜湊，用來判斷資料有沒有變（不是加密用） */
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + ':' + str.length;
}

// 第一次打開（這台沒有任何資料、也沒登入）：先請老師建立自己的班級
const FIRST_VISIT = (() => { try { return !cloud.session && !localStorage.getItem(STORE_KEY) && !localStorage.getItem('classseat-welcomed'); } catch { return false; } })();
let state = load() || defaultState();
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const json = JSON.stringify(state);
    try { store().setItem(storeKey(), json); } catch { /* 無痕模式等情況 */ }
    // 登入雲端班級時，資料有變就排程上傳
    if (cloud.session && hashStr(json) !== cloud.session.syncedHash) scheduleCloudSave();
  }, 200);
}

/** 按「💾 儲存」：馬上存到這台，有登入雲端也馬上上傳 */
async function saveNow() {
  clearTimeout(saveTimer);
  const json = JSON.stringify(state);
  let okLocal = true;
  try { store().setItem(storeKey(), json); } catch { okLocal = false; }
  const stamp = (t) => { const el = $('#saveStamp'); if (el) el.textContent = t; };
  const hm = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (cloud.session && !cloud.session.kiosk && !cloud.session.expired) {
    toast('儲存中…');
    clearTimeout(cloud.timer); cloud.timer = null;
    await cloudSave(true);
    if (cloud.status === 'ok') { toast(`✓ 已儲存到雲端（${cloud.session.code}）`); stamp(`✓ ${hm} 已存到雲端`); }
    else { toast(okLocal ? '已存在這台，雲端還沒存到，連上網路後會自動上傳' : '儲存失敗', 4000); stamp(okLocal ? `${hm} 已存在這台` : ''); }
  } else if (okLocal) {
    toast('✓ 已儲存在這台電腦（建議偶爾按「💾 備份／搬移」備份）', 3500); stamp(`✓ ${hm} 已儲存`);
  } else toast('這個瀏覽器不能儲存（可能是無痕視窗），請用「💾 備份／搬移」', 4000);
}

// 關掉或重新整理網頁時，把還沒寫進去的修改馬上存好
window.addEventListener('pagehide', () => {
  if (!saveTimer) return;
  clearTimeout(saveTimer); saveTimer = null;
  try { store().setItem(storeKey(), JSON.stringify(state)); } catch { /* ignore */ }
});

const ui = { selected: null, selSeat: null, newGroup: 'auto', scale: 1, history: [] };

function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

function pushHistory() {
  ui.history.push(JSON.stringify({ seats: state.seats, assign: state.assign, pool: state.pool, locked: state.locked, layout: state.layout, custom: state.custom, maps: state.maps, secret: state.secret }));
  if (ui.history.length > 30) ui.history.shift();
}

function studentById(id) { return state.students.find((s) => s.id === id); }
function tagById(id) { return state.tags.find((t) => t.id === id); }
function tagColor(id) { const i = state.tags.findIndex((t) => t.id === id); return TAG_COLORS[(i < 0 ? 0 : i) % TAG_COLORS.length]; }
function sortedStudents() { return [...state.students].sort((a, b) => (Number(a.no) || 999) - (Number(b.no) || 999)); }

/* =========================================================
   座位產生（直排／分組／ㄇ字型）
   ========================================================= */

function generateSeats(n, layout) {
  const seats = [];
  const add = (x, y, group) => seats.push({ id: uid(), x: Math.round(x), y: Math.round(y), group: group ?? null });

  if (layout.type === 'rows') {
    const cols = clamp(layout.cols | 0, 3, 10);
    const rows = Math.ceil(n / cols);
    const gx = 14, gy = 26, aisle = 46;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let x, group = null;
        if (layout.paired) {
          x = c * DESK_W + Math.floor(c / 2) * aisle + (c % 2) * 4;
          group = `r${r}p${Math.floor(c / 2)}`;
        } else {
          x = c * (DESK_W + gx);
        }
        add(x, r * (DESK_H + gy), group);
      }
    }
  } else if (layout.type === 'groups') {
    const G = clamp(layout.groups | 0, 3, 10);
    const size = Math.ceil(n / G);
    const perRow = G <= 3 ? G : G === 4 ? 2 : G <= 6 ? 3 : G === 9 ? 3 : 4;
    const rr = Math.ceil(size / 2);
    const gw = 2 * DESK_W + 4;
    const gh = rr * (DESK_H + 4) - 4;
    for (let g = 0; g < G; g++) {
      const gx0 = (g % perRow) * (gw + 56);
      const gy0 = Math.floor(g / perRow) * (gh + 50);
      // 人數平均分配到各組（相差最多 1 人）
      const count = Math.floor(n / G) + (g < n % G ? 1 : 0);
      for (let k = 0; k < count; k++) {
        add(gx0 + (k % 2) * (DESK_W + 4), gy0 + Math.floor(k / 2) * (DESK_H + 4), 'G' + (g + 1));
      }
    }
  } else if (isTemplate(layout.type)) {
    const tpl = state.maps.find((m) => m.id === layout.mapId)?.seats || [];
    tpl.forEach((p) => add(p.x, p.y, p.group));
    // 學生比座位圖的座位多時，在最後面補一排桌子
    const maxY = tpl.length ? Math.max(...tpl.map((p) => p.y)) : -(DESK_H + 26);
    for (let i = 0; i < n - tpl.length; i++) {
      add((i % 8) * (DESK_W + 14), maxY + (DESK_H + 26) * (1 + Math.floor(i / 8)), null);
    }
  } else {
    return uShape(n);
  }
  return seats;
}

/** ㄇ字型：開口朝向講台；人數多時自動做成內外兩層 */
function uShape(n) {
  const g = 10, step = DESK_W + g, vstep = DESK_H + g;
  const dbl = n > 24;

  function build(S, B) {
    const pos = [];
    const W0 = B * step - g;
    for (let k = 0; k < S; k++) pos.push({ x: 0, y: k * vstep, side: true, inner: false });
    for (let k = 0; k < S; k++) pos.push({ x: W0 - DESK_W, y: k * vstep, side: true, inner: false });
    for (let k = 0; k < B; k++) pos.push({ x: k * step, y: S * vstep, side: false, inner: false });
    if (dbl) {
      const ix = DESK_W + 46;
      const Si = S - 2;
      const innerW = W0 - 2 * ix;
      const Bi = Math.floor((innerW + g) / step);
      if (Si < 1 || Bi < 2) return null;
      const x0 = ix + (innerW - (Bi * step - g)) / 2;
      for (let k = 0; k < Si; k++) pos.push({ x: x0, y: k * vstep, side: true, inner: true });
      for (let k = 0; k < Si; k++) pos.push({ x: x0 + (Bi - 1) * step, y: k * vstep, side: true, inner: true });
      for (let k = 0; k < Bi; k++) pos.push({ x: x0 + k * step, y: Si * vstep, side: false, inner: true });
    }
    return pos;
  }

  let best = null;
  for (let S = 3; S <= 14; S++) {
    for (let B = 3; B <= 12; B++) {
      const pos = build(S, B);
      if (!pos || pos.length < n) continue;
      const w = B * step, h = (S + 1) * vstep;
      const score = (pos.length - n) * 4 + Math.abs(w / h - 1.6) * 12;
      if (!best || score < best.score) best = { score, pos };
    }
  }
  let pos = best.pos;
  // 多出來的座位：從靠近講台的側邊（內圈優先）移除
  let extra = pos.length - n;
  if (extra > 0) {
    const removable = pos
      .map((p, i) => ({ p, i }))
      .filter((o) => o.p.side)
      .sort((a, b) => (b.p.inner - a.p.inner) || (a.p.y - b.p.y) || (a.p.x - b.p.x));
    const drop = new Set(removable.slice(0, extra).map((o) => o.i));
    pos = pos.filter((_, i) => !drop.has(i));
  }
  return pos.map((p) => ({ id: uid(), x: Math.round(p.x), y: Math.round(p.y), group: null }));
}

/** 依目前版型重建桌椅，學生依原本的前後順序放入新座位 */
function relayout() {
  const oldSeats = seatOrder(state.seats);
  const order = oldSeats.map((s) => state.assign[s.id]).filter(Boolean);
  const seen = new Set(order);
  for (const s of sortedStudents()) if (!seen.has(s.id)) order.push(s.id);
  state.seats = generateSeats(state.students.length, state.layout);
  state.assign = {};
  const newSeats = seatOrder(state.seats);
  newSeats.forEach((seat, i) => { if (order[i]) state.assign[seat.id] = order[i]; });
  // 暗中安排跟著座位順序搬到新座位
  const move = Object.fromEntries(oldSeats.map((s, i) => [s.id, newSeats[i]?.id]));
  const remap = (obj) => Object.fromEntries(Object.entries(obj).filter(([k]) => move[k]).map(([k, v]) => [move[k], v]));
  state.secret.fixed = remap(state.secret.fixed);
  state.secret.ban = remap(state.secret.ban);
  for (const [k, v] of Object.entries(state.secret.backup || {})) state.secret.backup[k] = v.map((x) => move[x]).filter(Boolean);
  state.custom = false;
}

/** 移除已不存在的學生／座位 */
function cleanupSecret() {
  const sec = state.secret;
  const sids = new Set(state.students.map((s) => s.id));
  const seatIds = new Set(state.seats.map((s) => s.id));
  for (const [k, v] of Object.entries(sec.fixed)) if (!seatIds.has(k) || !sids.has(v)) delete sec.fixed[k];
  for (const [k, v] of Object.entries(sec.ban)) {
    const keep = (v || []).filter((x) => sids.has(x));
    if (!seatIds.has(k) || !keep.length) delete sec.ban[k]; else sec.ban[k] = keep;
  }
  sec.apart = sec.apart.filter(([a, b]) => sids.has(a) && sids.has(b) && a !== b);
  sec.backup ||= {};
  for (const [k, v] of Object.entries(sec.backup)) {
    const keep = v.filter((x) => seatIds.has(x));
    if (!sids.has(k) || !keep.length) delete sec.backup[k]; else sec.backup[k] = keep;
  }
}

function seatOrder(seats) {
  return [...seats].sort((a, b) => (a.y - b.y) || (a.x - b.x));
}

/** 學生增減後，讓每位學生都有座位 */
function ensureSeating() {
  const ids = new Set(state.students.map((s) => s.id));
  for (const [seat, sid] of Object.entries(state.assign)) if (!ids.has(sid)) delete state.assign[seat];
  state.locked = state.locked.filter((id) => ids.has(id));
  const seatIds = new Set(state.seats.map((s) => s.id));
  for (const seat of Object.keys(state.assign)) if (!seatIds.has(seat)) delete state.assign[seat];

  if (!state.custom || !state.seats.length) {
    // 標準版型：人數一變就重新排列桌椅（保留前後順序）
    const expected = generateSeats(state.students.length, state.layout).length;
    if (state.seats.length !== expected || !state.seats.length) { relayout(); return; }
  }
  const seated = new Set(Object.values(state.assign));
  // 名條區：只留還在名單上、還沒坐下的人
  state.pool = [...new Set(state.pool || [])].filter((id) => ids.has(id) && !seated.has(id));
  const waiting = new Set(state.pool);
  const unseated = sortedStudents().filter((s) => !seated.has(s.id) && !waiting.has(s.id));
  if (!unseated.length) return;
  let empty = seatOrder(state.seats).filter((s) => !state.assign[s.id]);
  if (empty.length < unseated.length) {
    // 自訂桌椅時，在最後面加一排新桌子
    const maxY = Math.max(0, ...state.seats.map((s) => s.y));
    const minX = Math.min(0, ...state.seats.map((s) => s.x));
    const need = unseated.length - empty.length;
    for (let i = 0; i < need; i++) {
      state.seats.push({ id: uid(), x: minX + (i % 8) * (DESK_W + 14), y: maxY + (DESK_H + 26) * (1 + Math.floor(i / 8)), group: null });
    }
    empty = seatOrder(state.seats).filter((s) => !state.assign[s.id]);
  }
  unseated.forEach((st, i) => { state.assign[empty[i].id] = st.id; });
}

/* =========================================================
   幾何：前後位置、相鄰、同組
   ========================================================= */

function geometry(seats = state.seats) {
  const N = seats.length;
  const ys = seats.map((s) => s.y);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const front = seats.map((s) => (maxY === minY ? 0 : (s.y - minY) / (maxY - minY)));
  // 左右：0＝最中間，1＝最外側（左右兩邊）
  const xs = seats.map((s) => s.x);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const half = (Math.max(...xs) - Math.min(...xs)) / 2;
  const side = seats.map((s) => (half ? Math.abs(s.x - cx) / half : 0));
  // 左側 L／右側 R／中間 C（學生面向講台時的左右）
  const sideCat = seats.map((s) => (!half || Math.abs(s.x - cx) <= half * 0.15 ? 'C' : s.x < cx ? 'L' : 'R'));
  const adj = new Uint8Array(N * N);
  const adjPairs = [];
  const rowPairs = [];
  const isGroups = state.layout.type === 'groups' || (isTemplate() && seats.some((s) => s.group));
  const groupKeys = [...new Set(seats.map((s) => s.group).filter(Boolean))];
  const groupIdx = seats.map((s) => (s.group ? groupKeys.indexOf(s.group) : -1));
  // 「相鄰」的範圍：貼在一起／中間隔一點也算／同一組也算
  const range = state.conditions?.adjRange || 'gap';
  const fx = range === 'touch' ? 1.3 : 2.0, fy = range === 'touch' ? 1.6 : 2.3;
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const dx = Math.abs(seats[i].x - seats[j].x);
      const dy = Math.abs(seats[i].y - seats[j].y);
      const touch = dx < DESK_W * 1.3 && dy < DESK_H * 1.6;
      const near = dx < DESK_W * fx && dy < DESK_H * fy;
      const grp = range === 'group' && isGroups && groupIdx[i] >= 0 && groupIdx[i] === groupIdx[j];
      if (near || grp) {
        adj[i * N + j] = adj[j * N + i] = 1;
        adjPairs.push([i, j]);
      }
      if (touch && dy < DESK_H / 2) rowPairs.push([i, j]);
    }
  }
  const sameGroup = (a, b) =>
    (groupIdx[a] >= 0 && groupIdx[a] === groupIdx[b]) || (!isGroups && adj[a * N + b] === 1);
  return { N, front, side, sideCat, adj, adjPairs, rowPairs, isGroups, groupIdx, groupCount: groupKeys.length, sameGroup };
}

/* =========================================================
   自動排座：以成本函數 + 模擬退火搜尋
   ========================================================= */

function buildModel() {
  const seats = state.seats;
  const studs = state.students;
  const geo = geometry(seats);
  const idx = new Map(studs.map((s, i) => [s.id, i]));
  const c = state.conditions;
  const wM = c.myopia.on ? WEIGHT_MUL[c.myopia.weight] : 0;
  const wH = c.height.on ? WEIGHT_MUL[c.height.weight] : 0;
  const wG = c.gender.on ? WEIGHT_MUL[c.gender.weight] : 0;
  // 上次的座位：不坐同一個位子、左右換邊
  const prevMap = state.prev?.seats || {};
  const wPS = c.prevSeat?.on ? WEIGHT_MUL[c.prevSeat.weight] : 0;
  const wPD = c.prevSide?.on ? WEIGHT_MUL[c.prevSide.weight] : 0;
  const recs = prevRecords().slice(0, prevN());
  const prevSeatSets = studs.map((s) => new Set(recs.map((r) => prevSeatIndex(r.seats?.[s.id], seats)).filter((k) => k >= 0)));
  const prevSide = studs.map((s) => prevMap[s.id]?.side || '');

  // 身高百分位（矮→0，高→1）
  const withH = studs.map((s, i) => ({ i, h: parseFloat(s.height) })).filter((o) => o.h > 0).sort((a, b) => a.h - b.h);
  const hTarget = new Float64Array(studs.length).fill(-1);
  withH.forEach((o, r) => { hTarget[o.i] = withH.length > 1 ? r / (withH.length - 1) : 0.5; });
  // 只選了身高等級（矮～高）的同學，用對應的前後位置
  studs.forEach((s, i) => { if (hTarget[i] < 0 && HLEVEL_TARGET[s.hlevel] !== undefined) hTarget[i] = HLEVEL_TARGET[s.hlevel]; });

  const pairList = (key) => {
    const out = [];
    const seen = new Set();
    studs.forEach((s, i) => (s[key] || []).forEach((oid) => {
      const j = idx.get(oid);
      if (j === undefined || j === i) return;
      const k = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (!seen.has(k)) { seen.add(k); out.push([i, j]); }
    }));
    return out;
  };
  const avoidAdj = pairList('avoidAdj');
  const avoidGroup = pairList('avoidGroup');
  const preferGroup = pairList('preferGroup');

  // 每位學生的「前後」偏好權重（正值→希望前排，負值→希望後排）
  const frontPull = new Float64Array(studs.length);
  const spreadTags = [];
  state.tags.forEach((t) => {
    const w = WEIGHT_MUL[t.weight] || 1;
    if (t.strategy === 'spread') {
      const members = studs.map((s, i) => (s.tags.includes(t.id) ? i : -1)).filter((i) => i >= 0);
      if (members.length > 1) spreadTags.push({ w, set: new Set(members) });
    }
  });
  const sidePull = new Float64Array(studs.length);
  studs.forEach((s, i) => {
    let p = 0;
    if (s.pref === 'front') p += 5;
    if (s.pref === 'back') p -= 5;
    if (s.myopia) p += wM;
    for (const tid of s.tags) {
      const t = tagById(tid);
      if (!t) continue;
      const w = WEIGHT_MUL[t.weight] || 1;
      if (t.strategy === 'front') p += w;
      if (t.strategy === 'back') p -= w;
    }
    frontPull[i] = p;
    sidePull[i] = s.hpref === 'outer' ? 5 : s.hpref === 'center' ? -5 : 0;
  });
  const gender = studs.map((s) => s.gender || '');
  const hasBoth = gender.includes('M') && gender.includes('F');

  // 必須遵守的同學關係：不可相鄰、不可同組（隨機排也遵守）
  function hardCost(occ, pos) {
    let t = 0;
    const { adj, N, sameGroup } = geo;
    for (const [a, b] of avoidAdj) if (pos[a] >= 0 && pos[b] >= 0 && adj[pos[a] * N + pos[b]]) t += 1000;
    for (const [a, b] of avoidGroup) if (pos[a] >= 0 && pos[b] >= 0 && sameGroup(pos[a], pos[b])) t += 800;
    return t;
  }

  // 上次的座位：不坐同一個位子、左右換邊、上次同組的分開（隨機排也遵守）
  const wPG = c.prevGroup?.on ? WEIGHT_MUL[c.prevGroup.weight] : 0;
  const prevMates = wPG ? prevGroupMates().map(([a, b]) => [idx.get(a), idx.get(b)]) : [];
  const hasPrev = !!((wPS && prevSeatSets.some((x) => x.size)) || (wPD && prevSide.some((x) => x === 'L' || x === 'R')) || prevMates.length);
  function prevCost(occ, pos) {
    if (!hasPrev) return 0;
    let t = 0;
    for (const [a, b] of prevMates) if (pos[a] >= 0 && pos[b] >= 0 && geo.sameGroup(pos[a], pos[b])) t += wPG * 12;
    for (let i = 0; i < studs.length; i++) {
      if (pos[i] < 0) continue;
      if (wPS && prevSeatSets[i].has(pos[i])) t += wPS * 40;
      if (wPD && (prevSide[i] === 'L' || prevSide[i] === 'R') && geo.sideCat[pos[i]] === prevSide[i]) t += wPD * 10;
    }
    return t;
  }

  // 每一組都要有男有女（不能整組都是男生或都是女生）；隨機排也遵守
  function mixCost(occ) {
    const { isGroups, groupIdx, groupCount } = geo;
    if (!wG || !isGroups || !groupCount || !hasBoth) return 0;
    const m = new Int16Array(groupCount), f = new Int16Array(groupCount);
    for (let s = 0; s < occ.length; s++) {
      const st = occ[s], g = groupIdx[s];
      if (st < 0 || g < 0) continue;
      if (gender[st] === 'M') m[g]++; else if (gender[st] === 'F') f[g]++;
    }
    let t = 0;
    for (let g = 0; g < groupCount; g++) if (m[g] + f[g] >= 2 && (!m[g] || !f[g])) t += 600;
    return t;
  }

  function cost(occ, pos) {
    let t = 0;
    const { front, side, adj, N, sameGroup, adjPairs, rowPairs, isGroups, groupIdx, groupCount } = geo;
    for (let i = 0; i < studs.length; i++) {
      const f = front[pos[i]];
      const p = frontPull[i];
      const sp = sidePull[i];
      if (sp > 0) t += sp * 10 * (1 - side[pos[i]]);
      else if (sp < 0) t += -sp * 10 * side[pos[i]];
      if (p > 0) t += p * 10 * f;
      else if (p < 0) t += -p * 10 * (1 - f);
      if (wH && hTarget[i] >= 0) t += wH * 10 * Math.abs(f - hTarget[i]);
    }
    t += prevCost(occ, pos);
    t += hardCost(occ, pos);
    for (const [a, b] of preferGroup) if (!sameGroup(pos[a], pos[b])) t += 150;

    // 性別：男生左右兩旁盡量是女生（女生旁邊不限制）
    if (wG) {
      for (const [a, b] of rowPairs) {
        const sa = occ[a], sb = occ[b];
        if (sa < 0 || sb < 0) continue;
        if (gender[sa] === 'M' && gender[sb] === 'M') t += wG * 8;
      }
    }
    if (spreadTags.length) {
      for (const [a, b] of adjPairs) {
        const sa = occ[a], sb = occ[b];
        if (sa < 0 || sb < 0) continue;
        for (const st of spreadTags) if (st.set.has(sa) && st.set.has(sb)) t += st.w * 25;
      }
    }
    t += mixCost(occ);
    if (isGroups && groupCount && spreadTags.length) {
      const tagCnt = spreadTags.map(() => new Int16Array(groupCount));
      for (let s = 0; s < occ.length; s++) {
        const st = occ[s], g = groupIdx[s];
        if (st < 0 || g < 0) continue;
        spreadTags.forEach((tg, k) => { if (tg.set.has(st)) tagCnt[k][g]++; });
      }
      for (let g = 0; g < groupCount; g++) {
        spreadTags.forEach((tg, k) => { if (tagCnt[k][g] > 1) t += tg.w * 25 * (tagCnt[k][g] - 1); });
      }
    }
    return t;
  }

  // 老師暗中安排（一定不會抽到、不能坐隔壁）
  const seatIdx = new Map(seats.map((x, i) => [x.id, i]));
  const banList = Object.entries(state.secret.ban)
    .map(([k, v]) => [seatIdx.get(k), new Set(v.map((x) => idx.get(x)).filter((x) => x !== undefined))])
    .filter(([si, set]) => si !== undefined && set.size);
  const apart = state.secret.apart.map(([a, b]) => [idx.get(a), idx.get(b)]).filter(([a, b]) => a !== undefined && b !== undefined);
  function secretCost(occ, pos) {
    let t = 0;
    for (const [si, set] of banList) if (occ[si] >= 0 && set.has(occ[si])) t += 5000;
    for (const [a, b] of apart) if (geo.adj[pos[a] * geo.N + pos[b]]) t += 5000;
    return t;
  }

  return { geo, idx, cost, secretCost, mixCost, prevCost, hardCost, hasHard: avoidAdj.length + avoidGroup.length > 0, hasPrev, hasSecret: banList.length + apart.length > 0, hasMix: !!(wG && geo.isGroups && geo.groupCount && hasBoth) };
}

function optimize(useConditions = true, extraFixed = null, fixedOverride = null) {
  const seats = state.seats;
  const studs = state.students;
  const N = seats.length;
  const model = buildModel();
  const seatIndex = new Map(seats.map((s, i) => [s.id, i]));
  const locked = new Set(state.locked);

  const baseOcc = new Int32Array(N).fill(-1);
  const fixedSeats = new Set();
  const taken = new Set();
  // 抽籤中已揭曉／自選的座位最優先，其次是老師內定，再來才是鎖定的座位
  for (const [sid, stid] of Object.entries(extraFixed || {})) {
    const si = seatIndex.get(sid), st = model.idx.get(stid);
    if (si === undefined || st === undefined || taken.has(st)) continue;
    baseOcc[si] = st; fixedSeats.add(si); taken.add(st);
  }
  for (const [sid, stid] of Object.entries(fixedOverride || state.secret.fixed)) {
    if (fixedSeats.has(seatIndex.get(sid))) continue;
    const si = seatIndex.get(sid), st = model.idx.get(stid);
    if (si === undefined || st === undefined || taken.has(st)) continue;
    baseOcc[si] = st; fixedSeats.add(si); taken.add(st);
  }
  for (const [sid, stid] of Object.entries(state.assign)) {
    if (!locked.has(stid)) continue;
    const si = seatIndex.get(sid), st = model.idx.get(stid);
    if (si === undefined || st === undefined || fixedSeats.has(si) || taken.has(st)) continue;
    baseOcc[si] = st; fixedSeats.add(si); taken.add(st);
  }
  const movable = [];
  for (let i = 0; i < N; i++) if (!fixedSeats.has(i)) movable.push(i);
  const fixedStudents = new Set([...fixedSeats].map((si) => baseOcc[si]));
  const free = [];
  studs.forEach((_, i) => { if (!fixedStudents.has(i)) free.push(i); });

  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

  function initial() {
    const occ = Int32Array.from(baseOcc);
    const pos = new Int32Array(studs.length).fill(-1);
    for (const si of fixedSeats) pos[occ[si]] = si;
    const spots = shuffle([...movable]);
    shuffle([...free]).forEach((st, k) => { occ[spots[k]] = st; pos[st] = spots[k]; });
    return { occ, pos };
  }

  // 座位比學生多：空位盡量留在最後面（以「最理想的空位位置」為 0 分）
  const fr = geometry(seats).front;
  const nEmpty = movable.length - free.length;
  const emptyIdeal = nEmpty > 0 ? movable.map((i) => 1 - fr[i]).sort((x, y) => x - y).slice(0, nEmpty).reduce((x, y) => x + y, 0) : 0;
  const emptyCost = nEmpty > 0 ? (o) => {
    let t = 0;
    for (const i of movable) if (o[i] < 0) t += 1 - fr[i];
    return Math.max(0, t - emptyIdeal) * 30;
  } : () => 0;
  // 完全隨機時只看老師的暗中安排；依條件時兩者都看
  const costFn = useConditions ? (o, p) => model.cost(o, p) + model.secretCost(o, p) + emptyCost(o) : (o, p) => model.secretCost(o, p) + emptyCost(o) + model.mixCost(o) + model.prevCost(o, p) + model.hardCost(o, p);
  let best = initial();
  if ((useConditions || model.hasSecret || model.hasMix || model.hasPrev || model.hasHard || nEmpty > 0) && movable.length > 1) {
    let bestCost = costFn(best.occ, best.pos);
    const runs = useConditions ? 4 : 3, iters = useConditions ? 16000 : 8000;
    for (let r = 0; r < runs && !(bestCost === 0 && !useConditions); r++) {
      const { occ, pos } = initial();
      let cur = costFn(occ, pos);
      for (let it = 0; it < iters; it++) {
        const T = 60 * Math.pow(0.0008, it / iters);
        const a = movable[(Math.random() * movable.length) | 0];
        const b = movable[(Math.random() * movable.length) | 0];
        if (a === b) continue;
        const sa = occ[a], sb = occ[b];
        if (sa < 0 && sb < 0) continue;
        occ[a] = sb; occ[b] = sa;
        if (sa >= 0) pos[sa] = b;
        if (sb >= 0) pos[sb] = a;
        const nc = costFn(occ, pos);
        if (nc <= cur || Math.random() < Math.exp((cur - nc) / T)) {
          cur = nc;
          if (cur < bestCost) { bestCost = cur; best = { occ: Int32Array.from(occ), pos: Int32Array.from(pos) }; }
          if (bestCost === 0 && !useConditions) break;
        } else {
          occ[a] = sa; occ[b] = sb;
          if (sa >= 0) pos[sa] = a;
          if (sb >= 0) pos[sb] = b;
        }
      }
    }
  }
  state.assign = {};
  state.pool = [];
  best.occ.forEach((st, si) => { if (st >= 0) state.assign[seats[si].id] = studs[st].id; });
  state.autoHash = hashStr(JSON.stringify(state.assign));
  ui.secretStatus = secretViolations().length;
}

/** 暗中安排沒做到的項目（只在暗中安排模式顯示） */
function secretViolations() {
  const out = [];
  const sec = state.secret;
  const nm = (id) => studentById(id)?.name || '';
  const geo = geometry();
  const seatI = Object.fromEntries(state.seats.map((x, i) => [x.id, i]));
  const posOf = Object.fromEntries(Object.entries(state.assign).map(([k, v]) => [v, seatI[k]]));
  for (const [k, v] of Object.entries(sec.fixed)) if (state.assign[k] !== v) out.push({ seat: k, text: `#${seatNo(k)} 應該是 ${nm(v)}` });
  for (const [k, v] of Object.entries(sec.ban)) if (v.includes(state.assign[k])) out.push({ seat: k, text: `#${seatNo(k)} 不該是 ${nm(state.assign[k])}` });
  for (const [a, b] of sec.apart) {
    const pa = posOf[a], pb = posOf[b];
    if (pa !== undefined && pb !== undefined && geo.adj[pa * geo.N + pb]) out.push({ seat: state.seats[pa].id, seat2: state.seats[pb].id, text: `${nm(a)} 和 ${nm(b)} 坐在隔壁` });
  }
  return out;
}

/** 座位編號（依前後、左右順序） */
function seatNo(seatId) {
  return seatOrder(state.seats).findIndex((x) => x.id === seatId) + 1;
}

/* =========================================================
   檢查結果
   ========================================================= */

function evaluate() {
  const seats = state.seats;
  const geo = geometry(seats);
  const seatIdxOf = {};
  seats.forEach((s, i) => { const st = state.assign[s.id]; if (st) seatIdxOf[st] = i; });
  const items = [];
  const errSeats = new Set(), warnSeats = new Set();
  const name = (s) => s.name || `#${s.no}`;
  const done = new Set();
  const pairCheck = (key, test, level, text) => {
    for (const s of state.students) {
      for (const oid of s[key] || []) {
        const o = studentById(oid);
        if (!o) continue;
        const k = key + [s.id, oid].sort().join();
        if (done.has(k)) continue;
        done.add(k);
        const a = seatIdxOf[s.id], b = seatIdxOf[oid];
        if (a === undefined || b === undefined) continue;
        if (test(a, b)) {
          items.push({ level, text: `${name(s)} 與 ${name(o)} ${text}` });
          const set = level === 'err' ? errSeats : warnSeats;
          set.add(seats[a].id); set.add(seats[b].id);
        }
      }
    }
  };
  pairCheck('avoidAdj', (a, b) => geo.adj[a * geo.N + b], 'err', '坐在相鄰位置（設定為不可相鄰）');
  pairCheck('avoidGroup', (a, b) => geo.sameGroup(a, b), 'err', geo.isGroups ? '在同一組（設定為不可同組）' : '坐在一起（設定為不可同組）');
  pairCheck('preferGroup', (a, b) => !geo.sameGroup(a, b), 'warn', geo.isGroups ? '沒有同組（設定為盡量同組）' : '沒有坐在一起（設定為盡量同組）');

  // 剛記住、座位還沒換過時，不逐一提醒
  const prevSeats = state.prev?.seats || {};
  const prevSame = Object.keys(prevSeats).length > 0
    && state.students.every((st) => !prevSeats[st.id] || prevSeatIndex(prevSeats[st.id], seats) === seatIdxOf[st.id]);
  if (prevSame) items.push({ level: 'info', text: '📌 目前就是記住的「上次座位」；換座位後會提醒誰還坐在同一個位子或同一側' });
  const prevSameSeat = [], prevStillL = [], prevStillR = [];
  for (const s of state.students) {
    const i = seatIdxOf[s.id];
    if (i === undefined) continue;
    const f = geo.front[i];
    if (s.pref === 'front' && f > 0.5) { items.push({ level: 'warn', text: `${name(s)} 希望坐前排，目前在後半部` }); warnSeats.add(seats[i].id); }
    const sd = geo.side[i];
    if (s.hpref === 'outer' && sd < 0.5) { items.push({ level: 'warn', text: `${name(s)} 希望坐外側，目前偏中間` }); warnSeats.add(seats[i].id); }
    if (s.hpref === 'center' && sd > 0.5) { items.push({ level: 'warn', text: `${name(s)} 希望坐中間，目前偏外側` }); warnSeats.add(seats[i].id); }
    if (s.pref === 'back' && f < 0.5) { items.push({ level: 'warn', text: `${name(s)} 希望坐後排，目前在前半部` }); warnSeats.add(seats[i].id); }
    const pv = prevSame ? null : state.prev?.seats?.[s.id];
    if (pv) {
      if (state.conditions.prevSeat?.on && prevRecords().slice(0, prevN()).some((r) => prevSeatIndex(r.seats?.[s.id], seats) === i)) { prevSameSeat.push(name(s)); warnSeats.add(seats[i].id); }
      if (state.conditions.prevSide?.on && (pv.side === 'L' || pv.side === 'R') && geo.sideCat[i] === pv.side) {
        (pv.side === 'L' ? prevStillL : prevStillR).push(name(s));
        warnSeats.add(seats[i].id);
      }
    }
    if (state.conditions.myopia.on && s.myopia && f > 0.5) { items.push({ level: 'warn', text: `${name(s)} 近視，目前坐在後半部` }); warnSeats.add(seats[i].id); }
    for (const tid of s.tags) {
      const t = tagById(tid);
      if (!t) continue;
      if (t.strategy === 'front' && f > 0.5) { items.push({ level: 'warn', text: `${name(s)}（${t.name}）目前坐在後半部` }); warnSeats.add(seats[i].id); }
      if (t.strategy === 'back' && f < 0.5) { items.push({ level: 'warn', text: `${name(s)}（${t.name}）目前坐在前半部` }); warnSeats.add(seats[i].id); }
    }
  }
  const list = (a) => (a.length > 8 ? `${a.slice(0, 8).join('、')}…等 ${a.length} 人` : a.join('、'));
  if (state.conditions.prevGroup?.on && state.prev?.seats) {
    const again = prevGroupMates().filter(([a, b]) => seatIdxOf[a] !== undefined && seatIdxOf[b] !== undefined && geo.sameGroup(seatIdxOf[a], seatIdxOf[b]));
    if (again.length) {
      const nm2 = (id) => name(studentById(id));
      items.push({ level: 'warn', text: `上次同組、這次又同組${again.length > 6 ? `（${again.length} 對）` : ''}：${again.slice(0, 6).map(([a, b]) => `${nm2(a)}＆${nm2(b)}`).join('、')}${again.length > 6 ? '…' : ''}` });
      again.forEach(([a, b]) => { warnSeats.add(seats[seatIdxOf[a]].id); warnSeats.add(seats[seatIdxOf[b]].id); });
    }
  }
  if (prevSameSeat.length) items.push({ level: 'warn', text: `${prevN() > 1 ? `跟最近 ${prevN()} 次坐過的位子重複` : '跟上次坐同一個位子'}：${list(prevSameSeat)}` });
  if (prevStillL.length) items.push({ level: 'warn', text: `上次在左側、這次還在左側（建議換到右側）：${list(prevStillL)}` });
  if (prevStillR.length) items.push({ level: 'warn', text: `上次在右側、這次還在右側（建議換到左側）：${list(prevStillR)}` });
  // 座位疊在一起：下面那張桌子（和坐在上面的人）會被蓋住看不到
  for (let i = 0; i < seats.length; i++) {
    for (let j = i + 1; j < seats.length; j++) {
      if (overlaps(seats[i], seats[j])) {
        const hidden = studentById(state.assign[seats[i].id]);
        const top = studentById(state.assign[seats[j].id]);
        items.push({ level: 'err', text: `有兩個座位疊在一起${hidden ? `，${name(hidden)} 被${top ? ` ${name(top)} ` : '空位'}蓋住了` : ''}。按座位表上方的「🔧 把疊住的座位分開」，或在座位上按右鍵刪除多的座位`, seat: seats[j].id });
        errSeats.add(seats[j].id);
      }
    }
  }
  // 每一組都要有男有女
  if (state.conditions.gender.on && geo.isGroups && geo.groupCount) {
    const byG = {};
    state.seats.forEach((x, i) => {
      const st = studentById(state.assign[x.id]);
      if (!st || geo.groupIdx[i] < 0 || !st.gender) return;
      ((byG[x.group] ||= { M: 0, F: 0, seats: [] })[st.gender]++, byG[x.group].seats.push(x.id));
    });
    const both = state.students.some((x) => x.gender === 'M') && state.students.some((x) => x.gender === 'F');
    for (const [g, v] of Object.entries(byG)) {
      if (!both || v.M + v.F < 2 || (v.M && v.F)) continue;
      items.push({ level: 'warn', text: `第 ${groupNum(g) || '?'} 組都是${v.M ? '男生' : '女生'}，每組要有男有女` });
      v.seats.forEach((id) => warnSeats.add(id));
    }
  }
  for (const t of state.tags) {
    if (t.strategy !== 'spread') continue;
    const members = state.students.filter((s) => s.tags.includes(t.id) && seatIdxOf[s.id] !== undefined);
    for (let x = 0; x < members.length; x++) {
      for (let y = x + 1; y < members.length; y++) {
        const a = seatIdxOf[members[x].id], b = seatIdxOf[members[y].id];
        const together = geo.isGroups ? geo.sameGroup(a, b) : geo.adj[a * geo.N + b];
        if (together) {
          items.push({ level: 'warn', text: `${name(members[x])} 與 ${name(members[y])} 都是「${t.name}」，${geo.isGroups ? '在同一組' : '坐在相鄰位置'}` });
          warnSeats.add(seats[a].id); warnSeats.add(seats[b].id);
        }
      }
    }
  }
  if (ui.secretMode) {
    for (const v of secretViolations()) {
      items.push({ level: 'err', text: '🤫 ' + v.text });
      errSeats.add(v.seat); if (v.seat2) errSeats.add(v.seat2);
    }
  }
  const rank = { err: 0, warn: 1, info: 2 };
  items.sort((a, b) => rank[a.level] - rank[b.level]);
  return { items, errSeats, warnSeats };
}

/* =========================================================
   畫面：① 學生與條件
   ========================================================= */

function renderStudentsPanel() {
  $('#countInput').value = state.students.length;
  if (!$('#gbFrom').value) $('#gbFrom').value = 1;
  if (!$('#gbTo').value) $('#gbTo').value = Math.floor(state.students.length / 2);
  renderStats();
  renderConditions();
  renderTable();
}

function renderStats() {
  const s = state.students;
  const m = s.filter((x) => x.gender === 'M').length;
  const f = s.filter((x) => x.gender === 'F').length;
  const myo = s.filter((x) => x.myopia).length;
  const rules = s.reduce((n, x) => n + x.avoidAdj.length + x.avoidGroup.length + x.preferGroup.length, 0) / 2;
  $('#studentStats').textContent = `共 ${s.length} 人．男 ${m}．女 ${f}．未填性別 ${s.length - m - f}．近視 ${myo}．人際規則 ${rules} 條`;
  $('#btnAddStudent').disabled = s.length >= MAX_N;
}

function weightSelect(value, attrs) {
  return `<select class="w-sel" ${attrs} aria-label="重要程度" title="重要程度">${[1, 2, 3].map((w) => `<option value="${w}" ${+value === w ? 'selected' : ''}>重要：${WEIGHT_LABEL[w]}</option>`).join('')}</select>`;
}

function renderConditions() {
  const c = state.conditions;
  const defs = [
    ['myopia', '👓 視力', '近視坐前排', '近視的同學優先安排在前排'],
    ['height', '📏 身高', '矮前高後', '矮的同學坐前面、高的坐後面（填公分或選 矮／中矮／中／中高／高）'],
    ['gender', '⚥ 性別', '男生旁邊放女生、每組有男有女', '男生的左右兩旁盡量安排女生（女生旁邊不限制）；分組時每一組都要有男生也有女生'],
    ['prevSeat', '🔁 換位子', '不坐坐過的位子', '不要坐最近幾次坐過的位子（在座位安排按「📌 記住教室現在的座位」記錄，最多記 3 次）'],
    ['prevSide', '↔ 左右換邊', '上次左側→換右側', '上次坐左側的換到右側、右側的換到左側；中間的不限（以「📌 記住教室現在的座位」為準）'],
    ['prevGroup', '👥 換組員', '上次同組的盡量分開', '上次同一組的同學（不是分組時看上次坐在旁邊的），這次盡量不要再同組（以「📌 記住教室現在的座位」為準）'],
  ];
  $('#builtinConds').innerHTML = defs.map(([k, title, short, desc]) => `
    <div class="cond ${c[k].on ? '' : 'off'}" title="${desc}">
      <label class="cond-text">
        <input type="checkbox" data-cond="${k}" ${c[k].on ? 'checked' : ''}>
        <span class="cond-title">${title}</span>
        <span class="cond-desc">${short}</span>
      </label>
      ${k === 'prevSeat' ? `<select class="w-sel" data-prev-n aria-label="參考幾次">${[1, 2, 3].map((n) => `<option value="${n}" ${prevN() === n ? 'selected' : ''}>最近 ${n} 次</option>`).join('')}</select>` : ''}
      ${weightSelect(c[k].weight, `data-cond-w="${k}"`)}
    </div>`).join('') + `
    <div class="cond fixed" title="不可相鄰、不可同組最優先；其次是盡量同組與座位偏好（在學生的「規則」中設定）">
      <span class="cond-text"><span class="cond-title">🤝 個人規則</span><span class="cond-desc">一律優先</span></span>
    </div>
    <div class="cond fixed" title="「不可相鄰」「不能坐隔壁」要離多遠才算分開">
      <span class="cond-text"><span class="cond-title">📐 相鄰範圍</span><span class="cond-desc">多近算坐在旁邊</span></span>
      <select class="w-sel" data-adj-range aria-label="相鄰範圍">${[['touch', '只算貼在一起的'], ['gap', '中間隔一點也算'], ['group', '隔一點＋同一組都算']].map(([v, l]) => `<option value="${v}" ${(c.adjRange || 'gap') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <div class="cond fixed prev-info"><span class="cond-text"><span class="cond-desc">${prevInfoText()}</span>${state.prev ? '<button class="link-btn" data-clear-prev>清除紀錄</button>' : ''}</span></div>`;

  const box = $('#customConds');
  if (!state.tags.length) {
    box.innerHTML = '<p class="empty-note">尚未新增自訂條件，例如「需要關注」「容易聊天」「助教小老師」等。</p>';
    return;
  }
  box.innerHTML = state.tags.map((t) => `
    <div class="tag-row" data-tag="${t.id}">
      <span class="tag-dot" style="background:${tagColor(t.id)}"></span>
      <input type="text" value="${esc(t.name)}" data-tag-name placeholder="條件名稱" aria-label="條件名稱">
      <select data-tag-strategy aria-label="安排方式">
        ${Object.entries(STRATEGY_LABEL).map(([k, v]) => `<option value="${k}" ${t.strategy === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
      ${weightSelect(t.weight, 'data-tag-weight')}
      <span class="hint">${state.students.filter((s) => s.tags.includes(t.id)).length} 人</span>
      <button class="link-btn" data-tag-del title="刪除此條件">刪除</button>
    </div>`).join('');
}

function ruleCount(s) {
  return s.avoidAdj.length + s.avoidGroup.length + s.preferGroup.length + (s.pref !== 'any' ? 1 : 0) + (s.hpref && s.hpref !== 'any' ? 1 : 0) + s.tags.length;
}

const REL_TYPES = [
  { key: 'avoidAdj', icon: '🚫', label: '不可相鄰', short: '不相鄰' },
  { key: 'avoidGroup', icon: '⛔', label: '不可同組', short: '不同組' },
  { key: 'preferGroup', icon: '🤝', label: '盡量同組', short: '要同組' },
];
const POS_FRONT = [['any', '不限'], ['front', '⬆ 靠前'], ['back', '⬇ 靠後']];
const POS_SIDE = [['any', '不限'], ['outer', '↔ 靠外側'], ['center', '◎ 靠中間']];

/** 卡片下方的條件摘要 */
function summaryHtml(s) {
  const bits = [];
  for (const r of REL_TYPES) if (s[r.key].length) bits.push(`<span class="sum-chip rel-${r.key}">${r.icon} ${r.short} ${s[r.key].length}</span>`);
  if (s.pref !== 'any') bits.push(`<span class="sum-chip">${s.pref === 'front' ? '⬆ 靠前' : '⬇ 靠後'}</span>`);
  if (s.hpref && s.hpref !== 'any') bits.push(`<span class="sum-chip">${s.hpref === 'outer' ? '↔ 靠外側' : '◎ 靠中間'}</span>`);
  for (const tid of s.tags) {
    const t = tagById(tid);
    if (t) bits.push(`<span class="sum-chip tag" style="--c:${tagColor(tid)}">${esc(t.name)}</span>`);
  }
  return bits.length ? bits.join('') : '<span class="sum-none">尚未設定條件</span>';
}

function renderTable() {
  const minReached = state.students.length <= MIN_N;
  $('#stuGrid').innerHTML = state.students.map((s) => `
    <article class="stu-card ${s.gender ? 'g-' + s.gender : ''}" data-sid="${s.id}">
      <div class="sc-top">
        <label class="sc-no" title="座號"><span>No.</span><input type="number" min="1" value="${esc(s.no)}" data-f="no" aria-label="座號"></label>
        <input class="sc-name" type="text" value="${esc(s.name)}" data-f="name" placeholder="姓名" aria-label="姓名">
        <button class="sc-del" data-remove ${minReached ? 'disabled title="至少需要 26 人"' : 'title="移除這位學生"'} aria-label="移除">✕</button>
      </div>
      <div class="sc-attrs">
        <span class="sc-gender" role="group" aria-label="性別">
          <button data-gender="M" class="${s.gender === 'M' ? 'on' : ''}">男</button><button data-gender="F" class="${s.gender === 'F' ? 'on' : ''}">女</button>
        </span>
        <label class="sc-pill ${s.myopia ? 'on' : ''}"><input type="checkbox" data-f="myopia" ${s.myopia ? 'checked' : ''}>👓 近視</label>
      </div>
      <div class="sc-hrow">
        <span class="sc-hk">身高</span>
        <span class="sc-hseg" role="group" aria-label="身高等級">${Object.entries(HLEVEL_LABEL).map(([k, v]) =>
          `<button data-hlevel="${k}" class="${s.hlevel === k && !s.height ? 'on' : ''}">${v}</button>`).join('')}</span>
        <span class="sc-or">或</span>
        <label class="sc-height"><input type="number" min="80" max="220" placeholder="公分" value="${esc(s.height)}" data-f="height" aria-label="身高（公分）">cm</label>
      </div>
      <input class="sc-note" type="text" value="${esc(s.note)}" placeholder="備註…（也可以寫「不要跟24號坐」）" data-f="note" aria-label="備註">
      <div class="sc-foot">
        <div class="sc-sum">${summaryHtml(s)}</div>
        <button class="sc-edit" data-open-rules>條件設定 ›</button>
      </div>
    </article>`).join('');
}

/** 條件設定視窗內容 */
function ruleDialogHtml(s) {
  const brush = ui.relBrush || 'avoidAdj';
  const relOf = (oid) => REL_TYPES.find((r) => s[r.key].includes(oid))?.key || '';
  const pals = sortedStudents().filter((o) => o.id !== s.id).map((o) => {
    const r = relOf(o.id);
    const t = REL_TYPES.find((x) => x.key === r);
    return `<button class="pal ${r ? 'rel-' + r : ''}" data-other="${o.id}" title="${t ? t.label : '無'}"><span class="pal-no">${esc(o.no)}</span>${esc(o.name)}${t ? `<span class="pal-ic">${t.icon}</span>` : ''}</button>`;
  }).join('');
  const posRow = (key, opts, cur) => opts.map(([v, label]) =>
    `<button class="pos-opt ${cur === v ? 'on' : ''}" data-${key}="${v}">${label}</button>`).join('');
  const tags = state.tags.length
    ? state.tags.map((t) => {
      const on = s.tags.includes(t.id);
      return `<button class="tag-check ${on ? 'on' : ''}" data-tag-toggle="${t.id}" style="--c:${tagColor(t.id)}"><span class="box">${on ? '✓' : ''}</span>${esc(t.name)}<small>${STRATEGY_LABEL[t.strategy]}</small></button>`;
    }).join('')
    : '<span class="hint">尚未新增自訂條件，可在上方「排座條件」新增。</span>';
  return `
    <section class="rd-sec">
      <h3>與同學的關係</h3>
      <p class="hint">先選關係，再點同學的名字；再點一次可以取消。關係會同時套用到雙方。</p>
      <div class="brush" role="radiogroup">${REL_TYPES.map((r) =>
        `<button class="brush-btn rel-${r.key} ${brush === r.key ? 'on' : ''}" data-brush="${r.key}">${r.icon} ${r.label}<span class="cnt">${s[r.key].length}</span></button>`).join('')}</div>
      <div class="pals">${pals}</div>
    </section>
    <section class="rd-sec">
      <h3>座位位置</h3>
      <div class="pos-grid">
        <span class="pos-k">前後</span><div class="pos-row">${posRow('pref', POS_FRONT, s.pref)}</div>
        <span class="pos-k">左右</span><div class="pos-row">${posRow('hpref', POS_SIDE, s.hpref || 'any')}</div>
      </div>
    </section>
    <section class="rd-sec">
      <h3>自訂條件</h3>
      <div class="tag-checks">${tags}</div>
    </section>`;
}

function openRuleDialog(id) {
  ui.ruleFor = id;
  renderRuleDialog();
  $('#ruleDialog').showModal();
}

function renderRuleDialog() {
  const s = studentById(ui.ruleFor);
  if (!s) return;
  $('#rdTitle').textContent = `${s.no}. ${s.name} 的條件`;
  const body = $('#rdBody');
  const top = body.scrollTop;
  body.innerHTML = ruleDialogHtml(s);
  body.scrollTop = top;
}

/**
 * 一段「同學關係」的寫法 → [[key, 對象], …]；看不懂回傳 null
 *   不要跟24坐、不要跟王小明同組、不要跟24同組附近、跟5號同組、不相鄰:3/7
 */
const NEAR_WORDS = '坐|相鄰|坐隔壁|隔壁|坐一起|坐在一起|附近|旁邊|靠近|坐附近|坐旁邊|前後左右|坐近';
function matchRelation(tk) {
  let m;
  if ((m = tk.match(/^(?:不相鄰|不可相鄰|不要相鄰)[:：](.+)$/))) return [['avoidAdj', m[1]]];
  if ((m = tk.match(/^(?:不同組|不可同組|不要同組)[:：](.+)$/))) return [['avoidGroup', m[1]]];
  if ((m = tk.match(/^(?:同組|盡量同組|要同組)[:：](.+)$/))) return [['preferGroup', m[1]]];
  // 不要跟24同組附近／同組或附近／同組也不要坐旁邊 → 不可同組＋不可相鄰
  if ((m = tk.match(new RegExp(`^不(?:要|可|能|可以)?(?:跟|和|與)(.+?)同組(?:或|和|也不要|也不能|、)?(?:${NEAR_WORDS})$`)))) return [['avoidGroup', m[1]], ['avoidAdj', m[1]]];
  if ((m = tk.match(new RegExp(`^不(?:要|可|能|可以)?(?:跟|和|與)(.+?)(?:${NEAR_WORDS})(?:或|和|也不要|也不能|、)?同組$`)))) return [['avoidGroup', m[1]], ['avoidAdj', m[1]]];
  if ((m = tk.match(/^不(?:要|可|能|可以)?(?:跟|和|與)(.+?)同組$/))) return [['avoidGroup', m[1]]];
  if ((m = tk.match(new RegExp(`^不(?:要|可|能|可以)?(?:跟|和|與)(.+?)(?:${NEAR_WORDS})$`)))) return [['avoidAdj', m[1]]];
  if ((m = tk.match(/^(?:要|想|盡量)?(?:跟|和|與)(.+?)(?:同組|一組|坐一起|坐在一起)$/))) return [['preferGroup', m[1]]];
  return null;
}

/** 名字或座號 → 學生 */
function findStudentRef(q, list = state.students) {
  const t = q.replace(/號$/, '').trim();
  return list.find((x) => x.name === t) || (/^\d+$/.test(t) ? list.find((x) => String(x.no) === t) : null) || list.find((x) => x.name.includes(t) && t.length >= 2);
}

const REL_LABEL = { avoidAdj: '不可相鄰', avoidGroup: '不可同組', preferGroup: '盡量同組' };

/** 學生卡片的備註裡寫了同學關係，就直接設定好，並從備註拿掉 */
function applyNoteRelations(s) {
  const parts = String(s.note || '').split(/([\s,，、;；。]+)/);
  const done = [], warn = [];
  const keep = parts.map((p) => {
    const rels = p.trim() && matchRelation(p.trim());
    if (!rels) return p;
    const hits = [];
    let bad = false;
    for (const [key, whoStr] of rels) {
      for (const w of whoStr.split(/[\/／+＋]/).map((x) => x.trim()).filter(Boolean)) {
        const o = findStudentRef(w);
        if (!o || o.id === s.id) { bad = true; warn.push(w); continue; }
        hits.push([key, o]);
      }
    }
    if (bad) return p;
    hits.forEach(([key, o]) => { setRelation(s.id, o.id, key, true); done.push(`${REL_LABEL[key]} ${o.no}.${o.name}`); });
    return '';
  });
  if (done.length) s.note = keep.join('').replace(/^[\s,，、;；。]+|[\s,，、;；。]+$/g, '').replace(/([\s,，、;；。])[\s,，、;；。]+/g, '$1');
  return { done, warn: [...new Set(warn)] };
}

/**
 * 解析批次貼上的一行，可以寫：
 *   開頭的數字＝座號；第一個看不懂的詞＝姓名，之後看不懂的詞放進備註
 *   男／女、近視、身高（公分或 矮／中矮／中／中高／高）
 *   前排／後排、外側／中間（座位偏好）
 *   自訂條件名稱（例如 需要關注），或「#新條件」
 *   不要跟王小明坐、不可同組:李小華、跟陳大同同組（對象可寫名字或座號，多位用 / 隔開）
 *   備註:xxx 或 （xxx）
 */
function parseStudentLine(line, defaultNo, newTags = []) {
  const st = newStudent(defaultNo);
  const rels = [];
  const notes = [];
  let named = false;
  // 括號裡的文字整段當備註（可以有空白）
  line = line.replace(/[（(]([^）)]*)[）)]/g, (m, x) => { if (x.trim()) notes.push(x.trim()); return ' '; });
  const tokens = line.split(/[\s,，、\t]+/).filter(Boolean);
  const addRel = (key, who) => who.split(/[\/／+＋]/).map((x) => x.trim()).filter(Boolean).forEach((w) => rels.push([key, w]));
  const findTag = (name) => state.tags.find((t) => t.name === name);
  tokens.forEach((tk, k) => {
    let m;
    if (k === 0 && /^\d{1,2}[.、:：號]?$/.test(tk) && tokens.length > 1) st.no = Number(tk.replace(/\D/g, ''));
    else if (/^(男|男生|M|m|boy)$/.test(tk)) st.gender = 'M';
    else if (/^(女|女生|F|f|girl)$/.test(tk)) st.gender = 'F';
    else if (/^近視$/.test(tk)) st.myopia = true;
    else if (/^(高|中高|普|中|中矮|矮)$/.test(tk)) st.hlevel = { 高: 'tall', 中高: 'midtall', 普: 'mid', 中: 'mid', 中矮: 'midshort', 矮: 'short' }[tk];
    else if ((m = tk.match(/^(\d{2,3}(?:\.\d+)?)(?:cm|公分)?$/i)) && Number(m[1]) >= 80 && Number(m[1]) <= 220) st.height = Number(m[1]);
    else if (/^(前排|坐前排|坐前面|靠前|盡量前排|前面)$/.test(tk)) st.pref = 'front';
    else if (/^(後排|坐後排|坐後面|靠後|盡量後排|後面)$/.test(tk)) st.pref = 'back';
    else if (/^(外側|靠外側|靠窗|靠邊|盡量外側)$/.test(tk)) st.hpref = 'outer';
    else if (/^(中間|靠中間|盡量中間)$/.test(tk)) st.hpref = 'center';
    else if ((m = matchRelation(tk))) m.forEach(([key, who]) => addRel(key, who));
    else if ((m = tk.match(/^備註[:：](.+)$/))) notes.push(m[1]);
    else if ((m = tk.match(/^[#＃](.+)$/)) || findTag(tk)) {
      const name = m ? m[1] : tk;
      let t = findTag(name);
      if (!t) { t = { id: uid(), name, strategy: 'none', weight: 2 }; state.tags.push(t); newTags.push(name); }
      if (!st.tags.includes(t.id)) st.tags.push(t.id);
    } else if (!named) { st.name = tk; named = true; }
    else notes.push(tk);
  });
  if (notes.length) st.note = notes.join('，');
  return { st, rels };
}

function setStudentCount(n) {
  n = clamp(n | 0, MIN_N, MAX_N);
  const cur = state.students.length;
  if (n === cur) return;
  if (n < cur) {
    const removed = sortedStudents().slice(n);
    if (!confirm(`將移除座號最後的 ${cur - n} 位學生（${removed.map((s) => s.name).join('、')}），確定嗎？`)) {
      $('#countInput').value = cur;
      return;
    }
    removed.forEach((s) => removeStudent(s.id, true));
  } else {
    for (let i = cur; i < n; i++) addStudent(true);
  }
  afterStudentsChanged();
}

function addStudent(silent) {
  if (state.students.length >= MAX_N) return;
  const no = Math.max(0, ...state.students.map((s) => Number(s.no) || 0)) + 1;
  state.students.push(newStudent(no));
  if (!silent) afterStudentsChanged();
}

function removeStudent(id, silent) {
  if (state.students.length <= MIN_N) return;
  state.students = state.students.filter((s) => s.id !== id);
  for (const s of state.students) {
    for (const k of ['avoidAdj', 'avoidGroup', 'preferGroup']) s[k] = s[k].filter((x) => x !== id);
  }
  if (ui.selected === id) ui.selected = null;
  if (!silent) afterStudentsChanged();
}

function afterStudentsChanged() {
  ensureSeating();
  renderStudentsPanel();
  save();
}

function setRelation(aId, bId, key, on) {
  const a = studentById(aId), b = studentById(bId);
  if (!a || !b) return;
  const upd = (s, other) => {
    s[key] = s[key].filter((x) => x !== other);
    if (on) s[key].push(other);
  };
  upd(a, bId); upd(b, aId);
  if (on) {
    // 互斥：不可相鄰／不可同組 與 盡量同組 不能同時成立
    const conflicts = key === 'preferGroup' ? ['avoidAdj', 'avoidGroup'] : ['preferGroup'];
    for (const k of conflicts) {
      if (a[k].includes(bId)) { a[k] = a[k].filter((x) => x !== bId); b[k] = b[k].filter((x) => x !== aId); }
    }
  }
}

function bindStudentsPanel() {
  const grid = $('#stuGrid');
  const cardOf = (el) => el.closest('.stu-card[data-sid]');

  grid.addEventListener('input', (e) => {
    const card = cardOf(e.target);
    const f = e.target.dataset.f;
    if (!card || !f || f === 'myopia') return;
    const s = studentById(card.dataset.sid);
    s[f] = f === 'no' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value;
    if (f === 'height' && s.height) {
      // 填了公分就以公分為準
      s.hlevel = '';
      $$('[data-hlevel]', card).forEach((b) => b.classList.remove('on'));
    }
    save();
  });
  grid.addEventListener('change', (e) => {
    const card = cardOf(e.target);
    if (card && e.target.dataset.f === 'note') {
      const s = studentById(card.dataset.sid);
      const { done, warn } = applyNoteRelations(s);
      if (done.length) { afterStudentsChanged(); toast(`${s.name}：已設定 ${done.join('、')}`, 4000); }
      if (warn.length) toast(`${s.name}：找不到「${warn.join('、')}」，請寫名字或座號`, 4000);
      return;
    }
    if (!card || e.target.dataset.f !== 'myopia') return;
    studentById(card.dataset.sid).myopia = e.target.checked;
    e.target.closest('.sc-pill').classList.toggle('on', e.target.checked);
    renderStats(); save();
  });
  grid.addEventListener('click', (e) => {
    const card = cardOf(e.target);
    const btn = e.target.closest('button');
    if (!card || !btn) return;
    const s = studentById(card.dataset.sid);
    if (btn.dataset.gender) {
      s.gender = s.gender === btn.dataset.gender ? '' : btn.dataset.gender;
      card.classList.remove('g-M', 'g-F');
      if (s.gender) card.classList.add('g-' + s.gender);
      $$('[data-gender]', card).forEach((b) => b.classList.toggle('on', s.gender === b.dataset.gender));
      renderStats(); save();
    } else if (btn.dataset.hlevel) {
      s.hlevel = s.hlevel === btn.dataset.hlevel && !s.height ? '' : btn.dataset.hlevel;
      s.height = '';
      $('[data-f="height"]', card).value = '';
      $$('[data-hlevel]', card).forEach((b) => b.classList.toggle('on', s.hlevel === b.dataset.hlevel));
      save();
    } else if ('openRules' in btn.dataset) {
      openRuleDialog(s.id);
    } else if ('remove' in btn.dataset) {
      if (confirm(`確定移除「${s.name}」？`)) removeStudent(s.id);
    }
  });

  // 條件設定視窗
  $('#rdClose').addEventListener('click', () => { $('#ruleDialog').close(); saveNow(); });
  $('#btnSaveNow').addEventListener('click', () => saveNow());
  $('#ruleDialog').addEventListener('close', () => { renderTable(); renderStats(); renderConditions(); });
  $('#rdBody').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    const s = studentById(ui.ruleFor);
    if (!btn || !s) return;
    if (btn.dataset.brush) {
      ui.relBrush = btn.dataset.brush;
    } else if (btn.dataset.other) {
      const brush = ui.relBrush || 'avoidAdj';
      const had = s[brush].includes(btn.dataset.other);
      for (const r of REL_TYPES) setRelation(s.id, btn.dataset.other, r.key, false);
      if (!had) setRelation(s.id, btn.dataset.other, brush, true);
    } else if (btn.dataset.pref) {
      s.pref = btn.dataset.pref;
    } else if (btn.dataset.hpref) {
      s.hpref = btn.dataset.hpref;
    } else if (btn.dataset.tagToggle) {
      const t = btn.dataset.tagToggle;
      s.tags = s.tags.includes(t) ? s.tags.filter((x) => x !== t) : [...s.tags, t];
    } else {
      return;
    }
    renderRuleDialog();
    save();
  });

  $('#builtinConds').addEventListener('change', (e) => {
    const k = e.target.dataset.cond, kw = e.target.dataset.condW;
    if (k) state.conditions[k].on = e.target.checked;
    if (kw) state.conditions[kw].weight = Number(e.target.value);
    if ('prevN' in e.target.dataset) state.conditions.prevSeat.n = Number(e.target.value);
    if ('adjRange' in e.target.dataset) state.conditions.adjRange = e.target.value;
    renderConditions(); save();
  });
  $('#builtinConds').addEventListener('click', (e) => {
    if (!e.target.closest('[data-clear-prev]')) return;
    if (!confirm('清除所有「記住的座位」紀錄？')) return;
    state.prev = null;
    state.prevHistory = [];
    renderConditions(); save();
  });

  const tagBox = $('#customConds');
  tagBox.addEventListener('input', (e) => {
    const row = e.target.closest('[data-tag]');
    if (row && 'tagName' in e.target.dataset) { tagById(row.dataset.tag).name = e.target.value; save(); }
  });
  tagBox.addEventListener('change', (e) => {
    const row = e.target.closest('[data-tag]');
    if (!row) return;
    const t = tagById(row.dataset.tag);
    if ('tagStrategy' in e.target.dataset) t.strategy = e.target.value;
    if ('tagWeight' in e.target.dataset) t.weight = Number(e.target.value);
    if ('tagName' in e.target.dataset) renderTable();
    save();
  });
  tagBox.addEventListener('click', (e) => {
    const row = e.target.closest('[data-tag]');
    if (!row || !e.target.closest('[data-tag-del]')) return;
    const t = tagById(row.dataset.tag);
    if (!confirm(`刪除條件「${t.name}」？已勾選的學生也會一併取消。`)) return;
    state.tags = state.tags.filter((x) => x.id !== t.id);
    state.students.forEach((s) => { s.tags = s.tags.filter((x) => x !== t.id); });
    renderConditions(); renderTable(); save();
  });
  $('#btnAddTag').addEventListener('click', () => {
    state.tags.push({ id: uid(), name: '新條件', strategy: 'front', weight: 2 });
    renderConditions();
    const inputs = $$('#customConds [data-tag-name]');
    inputs[inputs.length - 1]?.select();
    save();
  });

  $('#countMinus').addEventListener('click', () => { $('#countInput').value = clamp(+$('#countInput').value - 1, MIN_N, MAX_N); });
  $('#countPlus').addEventListener('click', () => { $('#countInput').value = clamp(+$('#countInput').value + 1, MIN_N, MAX_N); });
  $('#countApply').addEventListener('click', () => {
    const v = Number($('#countInput').value);
    if (v < MIN_N || v > MAX_N) toast(`人數需介於 ${MIN_N}～${MAX_N} 人`);
    setStudentCount(v);
  });
  $('#btnAddStudent').addEventListener('click', () => addStudent());
  $('#btnSortNo').addEventListener('click', () => { state.students = sortedStudents(); renderTable(); save(); });

  // 批次設定性別：座號範圍，或依單雙號一鍵設定
  const applyGender = (pick, msg) => {
    let n = 0;
    for (const st of state.students) {
      const g = pick(Number(st.no));
      if (g === undefined) continue;
      st.gender = g;
      n++;
    }
    renderTable(); renderStats(); save();
    toast(msg(n));
  };
  $('.gender-batch').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.gbQuick) {
      const q = btn.dataset.gbQuick;
      if (q === 'clear') {
        if (!confirm('清除所有學生的性別？')) return;
        applyGender(() => '', () => '已清除全部性別');
      } else {
        const odd = q === 'oddM' ? 'M' : 'F', even = odd === 'M' ? 'F' : 'M';
        applyGender((no) => (no > 0 ? (no % 2 ? odd : even) : undefined), (n) => `已設定 ${n} 人：單號${odd === 'M' ? '男' : '女'}、雙號${even === 'M' ? '男' : '女'}`);
      }
      return;
    }
    if (!('gb' in btn.dataset)) return;
    const from = Number($('#gbFrom').value), to = Number($('#gbTo').value);
    if (!from || !to) { toast('請填寫座號範圍'); return; }
    const lo = Math.min(from, to), hi = Math.max(from, to);
    const g = btn.dataset.gb;
    applyGender((no) => (no >= lo && no <= hi ? g : undefined),
      (n) => `${lo}～${hi} 號共 ${n} 人${g ? `設為${g === 'M' ? '男' : '女'}` : '已清除性別'}`);
    // 方便接著設定下一段：起始座號跳到下一號
    const maxNo = Math.max(0, ...state.students.map((st) => Number(st.no) || 0));
    if (hi < maxNo) { $('#gbFrom').value = hi + 1; $('#gbTo').value = maxNo; }
  });

  $('#btnBatch').addEventListener('click', () => { $('#batchText').value = ''; $('#batchDialog').showModal(); });
  $('#batchDialog').addEventListener('close', () => {
    if ($('#batchDialog').returnValue !== 'ok') return;
    const lines = $('#batchText').value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const newTags = [];
    const parsed = lines.slice(0, MAX_N).map((line, i) => parseStudentLine(line, i + 1, newTags));
    const list = parsed.map((x) => x.st);
    while (list.length < MIN_N) list.push(newStudent(list.length + 1));
    state.students = list;
    // 第二輪：把「不要跟誰坐」「跟誰同組」對到名單上的同學（名字或座號）
    const warn = [];
    const findStu = (q) => findStudentRef(q, list);
    let ruleN = 0;
    parsed.forEach(({ st, rels }) => {
      for (const [key, who] of rels) {
        const o = findStu(who);
        if (!o || o.id === st.id) { warn.push(`${st.name}：找不到「${who}」`); continue; }
        setRelation(st.id, o.id, key, true);
        ruleN++;
      }
    });
    state.assign = {};
    state.pool = [];
    state.locked = [];
    ui.selected = null;
    relayout();
    afterStudentsChanged();
    toast(`已匯入 ${Math.min(lines.length, MAX_N)} 位學生${ruleN ? `、${ruleN} 條同學關係` : ''}${newTags.length ? `，新增條件「${newTags.join('、')}」（請到排座條件設定安排方式）` : ''}${lines.length > MAX_N ? '（超過 40 人的部分已略過）' : ''}`, 5000);
    if (warn.length) alert(`有些同學關係對不到名單上的人，請到學生卡片的「條件設定」手動設定：\n\n${warn.slice(0, 12).join('\n')}${warn.length > 12 ? `\n…等 ${warn.length} 項` : ''}`);
  });
}

/* =========================================================
   畫面：② 座位安排
   ========================================================= */

function renderSeatsPanel() {
  renderLayoutSeg();
  $$('#modeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
  $('#editTools').hidden = !canEditDesks();
  if (ui.newGroup !== 'auto' && ui.newGroup !== 'new' && ui.newGroup !== 'none' && !groupKeys().includes(ui.newGroup)) ui.newGroup = 'auto';
  $('#newDeskGroup').innerHTML = groupOptions(ui.newGroup, true);
  if (ui.groupBrush && ui.groupBrush !== 'new' && !groupKeys().includes(ui.groupBrush)) ui.groupBrush = null;
  if (!canEditDesks()) ui.groupBrush = null;
  $('#groupBrush').innerHTML = `<option value="">關</option>${groupKeys().map((k) => `<option value="${k}" ${ui.groupBrush === k ? 'selected' : ''}>第 ${groupNum(k)} 組</option>`).join('')}<option value="new" ${ui.groupBrush === 'new' ? 'selected' : ''}>＋ 新的一組</option><option value="none" ${ui.groupBrush === 'none' ? 'selected' : ''}>不分組</option>`;
  $('#groupBrushLabel').classList.toggle('on', !!ui.groupBrush);
  $('#room').classList.toggle('brush-mode', !!ui.groupBrush);
  $('#btnResetDesks').hidden = isTemplate();
  $('#btnFlip').textContent = state.flipped ? '視角：講台在下（老師）' : '視角：講台在上（學生）';
  $('#btnUndo').disabled = !ui.history.length;
  $('#btnUnlockAll').disabled = !state.locked.length;
  $('#btnRemember').title = prevInfoText().replace('📌 ', '');
  renderLayoutOpts();
  // 保險：有同學沒有座位、也不在名條區，就放進名條區讓老師看得到，不會默默不見
  if (!ui.drawing && !document.body.classList.contains('big-screen')) {
    const seated = new Set(Object.values(state.assign));
    const inPool = new Set(state.pool || []);
    const lost = sortedStudents().filter((x) => !seated.has(x.id) && !inPool.has(x.id));
    if (lost.length) {
      state.pool = [...(state.pool || []), ...lost.map((x) => x.id)];
      save();
      setTimeout(() => toast(`${lost.map((x) => x.no + '.' + x.name).join('、')} 還沒有座位，名條放在左邊`, 5000), 50);
    }
  }
  renderPool(); // 先決定名條區在不在，教室才算得出可用寬度
  renderRoomSummary();
  renderRoom();
  renderLegend();
  $('#btnSecret').classList.toggle('on', !!ui.secretMode);
  $('#secretCard').hidden = !ui.secretMode;
  if (ui.secretMode) renderSecret();
}

function renderLayoutOpts() {
  const L = state.layout;
  const n = state.students.length;
  let html = '';
  if (L.type === 'rows') {
    html = `<label>每排 <input type="number" min="3" max="10" value="${L.cols}" data-lo="cols"> 張桌子</label>
      <label><input type="checkbox" data-lo="paired" ${L.paired ? 'checked' : ''}> 兩兩併桌</label>
      <span class="hint">共 ${Math.ceil(n / L.cols)} 排</span>`;
  } else if (L.type === 'groups') {
    html = `<label>分成 <input type="number" min="3" max="10" value="${L.groups}" data-lo="groups"> 組</label>
      <span class="hint">每組 ${Math.ceil(n / L.groups)} 人以內</span>`;
  } else if (L.type === 'map') {
    const m = currentMap();
    html = `<label>名稱 <input type="text" class="map-name" value="${esc(m?.name)}" data-map-name aria-label="座位圖名稱"></label>
      <button class="btn small" data-auto-group title="把靠在一起的桌子自動分成同一組">依位置自動分組</button>
      <span class="hint">${m?.seats.length || 0} 個座位、${groupKeys().length} 組；可新增、刪除、拖動座位，會自動記住</span>`;
  } else {
    html = `<span class="hint">${n > 24 ? '內外雙層 ㄇ 字型' : '單層 ㄇ 字型'}，開口朝向講台</span>`;
  }
  if (state.custom) html += '<button class="btn small" data-save-custom>存成新的座位圖</button>';
  $('#layoutOpts').innerHTML = html;
}

function renderLayoutSeg() {
  const L = state.layout;
  const builtin = Object.entries(LAYOUT_LABEL).map(([k, v]) =>
    `<button data-layout="${k}" class="${L.type === k ? 'active' : ''}">${v}</button>`).join('');
  const maps = state.maps.map((m) =>
    `<button data-map="${m.id}" class="map-btn ${L.type === 'map' && L.mapId === m.id ? 'active' : ''}">${esc(m.name || '未命名')}<span class="map-del" data-del-map="${m.id}" title="刪除這張座位圖" role="button" aria-label="刪除">×</span></button>`).join('');
  $('#layoutSeg').innerHTML = `${builtin}<span class="seg-sep"></span>${maps}<button data-new-map class="new-map">＋ 新增座位圖</button>`;
}

function openMapDialog(start = 'groups') {
  const dlg = $('#mapDialog');
  $('#mapName').value = `座位圖 ${state.maps.length + 1}`;
  $('#mapGroups').value = state.layout.groups;
  $('#mapCols').value = state.layout.cols;
  $$('input[name="mapStart"]', dlg).forEach((r) => { r.checked = r.value === start; });
  $('#mapCount').textContent = state.students.length;
  dlg.showModal();
  $('#mapName').select();
}

function createMap() {
  const start = $('input[name="mapStart"]:checked')?.value || 'groups';
  const n = state.students.length;
  let seats;
  if (start === 'copy') {
    seats = templateFrom(state.seats);
  } else {
    const L = {
      ...state.layout,
      type: start,
      groups: clamp(Number($('#mapGroups').value) || 6, 3, 10),
      cols: clamp(Number($('#mapCols').value) || 6, 3, 10),
    };
    seats = templateFrom(generateSeats(n, L));
  }
  const map = { id: uid(), name: $('#mapName').value.trim() || `座位圖 ${state.maps.length + 1}`, seats };
  pushHistory();
  state.maps.push(map);
  state.layout.type = 'map';
  state.layout.mapId = map.id;
  relayout();
  save();
  renderSeatsPanel();
  toast(`已新增座位圖「${map.name}」`);
}

function deleteMap(id) {
  const m = state.maps.find((x) => x.id === id);
  if (!m || !confirm(`刪除座位圖「${m.name}」？`)) return;
  pushHistory();
  state.maps = state.maps.filter((x) => x.id !== id);
  if (state.layout.type === 'map' && state.layout.mapId === id) {
    if (state.maps.length) state.layout.mapId = state.maps[0].id;
    else state.layout.type = 'groups';
    relayout();
  }
  save();
  renderSeatsPanel();
  toast(`已刪除「${m.name}」`);
}

function renderLegend() {
  const tags = state.tags.map((t) => `<div><span class="sw" style="background:${tagColor(t.id)}"></span>${esc(t.name)}（${STRATEGY_LABEL[t.strategy]}）</div>`).join('');
  $('#legend').innerHTML = `
    <div><span class="sw" style="background:var(--boy)"></span>男生</div>
    <div><span class="sw" style="background:var(--girl)"></span>女生</div>
    <div>👓 近視　🔒 鎖定座位（自動排座時不移動）</div>
    <div><span class="sw" style="background:var(--danger)"></span>違反「不可相鄰／不可同組」</div>
    <div><span class="sw" style="background:#e5b93a"></span>其他條件未完全滿足</div>
    ${tags}`;
}

function roomBounds() {
  const xs = state.seats.map((s) => s.x), ys = state.seats.map((s) => s.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY };
}

/** 資料座標 → 畫面座標（考慮翻轉視角） */
function toView(x, y, b, pad) {
  if (state.flipped) return { x: b.maxX - x + pad, y: b.maxY - y + pad };
  return { x: x - b.minX + pad, y: y - b.minY + pad + PODIUM_SPACE };
}

function renderRoom() {
  const room = $('#room');
  if (!state.seats.length) ensureSeating();
  const pad = 30;
  const b = roomBounds();
  // 可編輯桌椅時，在右邊與下方多留一些空白，方便把桌子拖過去或新增
  const edit = canEditDesks();
  const slack = edit ? { x: DESK_W, y: DESK_H * 2 } : { x: 0, y: 0 };
  // 可編輯時教室至少撐滿卡片寬度，多出來的都是可放桌子的空白
  const W = Math.max(b.maxX - b.minX + DESK_W + pad * 2 + slack.x, edit ? $('#roomWrap').clientWidth : 0);
  const H = b.maxY - b.minY + DESK_H + pad * 2 + PODIUM_SPACE + slack.y;
  ui.view = { b, pad };
  room.style.width = W + 'px';
  room.style.height = H + 'px';
  room.classList.toggle('move-mode', state.mode === 'move');
  room.classList.toggle('secret-mode', !!ui.secretMode);
  cleanupSecret();

  const ev = evaluate();
  const lockedSet = new Set(state.locked);
  const sel = ui.selected ? studentById(ui.selected) : null;
  if (sel) ui.selSeat = state.seats.find((x) => state.assign[x.id] === sel.id)?.id || null;
  if (ui.selSeat && !state.seats.some((x) => x.id === ui.selSeat)) ui.selSeat = null;
  const bad = new Set(sel ? [...sel.avoidAdj, ...sel.avoidGroup] : []);
  const good = new Set(sel ? sel.preferGroup : []);

  const pw = Math.min(260, W - 40);
  const podiumY = state.flipped ? H - pad - 40 : pad - 10;
  let html = `<div class="podium" style="left:${(W - pw) / 2}px;top:${podiumY}px;width:${pw}px">講 台</div>`;

  if (state.layout.type === 'groups' || isTemplate()) {
    const members = {};
    state.seats.forEach((s) => { if (groupNum(s.group)) (members[s.group] ||= []).push(toView(s.x, s.y, b, pad)); });
    const groups = {};
    for (const [k, vs] of Object.entries(members)) {
      // 標籤放在這組主要聚集處（離中位數最近的座位群），避免被零星座位拉走
      const med = (arr) => arr.slice().sort((p, q) => p - q)[Math.floor(arr.length / 2)];
      const mx = med(vs.map((v) => v.x)), my = med(vs.map((v) => v.y));
      const core = vs.filter((v) => Math.abs(v.x - mx) <= DESK_W * 2.2 && Math.abs(v.y - my) <= DESK_H * 2.5);
      const use = core.length ? core : vs;
      groups[k] = { x: Math.min(...use.map((v) => v.x)), y: Math.min(...use.map((v) => v.y)), maxY: Math.max(...use.map((v) => v.y)) };
    }
    for (const [k, g] of Object.entries(groups)) {
      const y = state.flipped ? g.maxY + DESK_H + 3 : g.y - 18;
      html += `<div class="group-label" style="left:${g.x}px;top:${y}px">第 ${groupNum(k)} 組</div>`;
    }
  }

  const seatNoMap = Object.fromEntries(seatOrder(state.seats).map((x, i) => [x.id, i + 1]));
  const preDraw = document.body.classList.contains('big-screen') && !ui.drawing && !ui.revealed;
  for (const seat of state.seats) {
    const v = toView(seat.x, seat.y, b, pad);
    const st = studentById(state.assign[seat.id]);
    const cls = ['desk'];
    const clean = isClean();
    if (preDraw) {
      // 大屏還沒抽籤：座位一律顯示「？」，不顯示任何名字，不會先看到結果
      html += st ? `<div class="desk draw-hidden" data-seat="${seat.id}" style="left:${v.x}px;top:${v.y}px"><span class="d-name">？</span></div>` : `<div class="desk empty" data-seat="${seat.id}" style="left:${v.x}px;top:${v.y}px"><span class="d-empty">空位</span></div>`;
      continue;
    }
    if (ui.drawing && st && !ui.drawing.done.has(st.id)) {
      // 還沒抽到：先藏起來
      html += `<div class="desk draw-hidden" data-seat="${seat.id}" style="left:${v.x}px;top:${v.y}px"><span class="d-name">？</span></div>`;
      continue;
    }
    if (clean) {
      if (!st) cls.push('empty'); else if (st.gender) cls.push('g-' + st.gender);
      if (ui.drawing && st && ui.drawing.last === st.id) cls.push('draw-pop', 'draw-just');
      const inner = st ? `<span class="d-no">${esc(st.no)}</span><span class="d-name">${esc(st.name)}</span>` : '<span class="d-empty">空位</span>';
      html += `<div class="${cls.join(' ')}" data-seat="${seat.id}" style="left:${v.x}px;top:${v.y}px">${inner}</div>`;
      continue;
    }
    if (seat.id === ui.selSeat) cls.push('selected');
    if (!st) cls.push('empty');
    else {
      if (st.gender) cls.push('g-' + st.gender);
      if (lockedSet.has(st.id)) cls.push('locked');
      if (ev.errSeats.has(seat.id)) cls.push('conflict');
      else if (ev.warnSeats.has(seat.id)) cls.push('warnd');
      if (sel && st.id === sel.id) { /* 已標示 */ } else if (bad.has(st.id)) cls.push('rel-bad');
      else if (good.has(st.id)) cls.push('rel-good');
    }
    let inner;
    if (st) {
      const tags = st.tags.map((tid) => { const t = tagById(tid); return t ? `<span class="d-tag" style="background:${tagColor(tid)}" title="${esc(t.name)}">${esc(t.name.slice(0, 1))}</span>` : ''; }).join('');
      const badges = `${st.myopia ? '<span title="近視">👓</span>' : ''}${heightText(st) ? `<span>${esc(heightText(st))}</span>` : ''}${tags}`;
      inner = `<span class="d-no">${esc(st.no)}</span><span class="d-name">${esc(st.name)}</span>
        ${badges ? `<div class="d-badges">${badges}</div>` : ''}
        <button class="lock" data-lock title="${lockedSet.has(st.id) ? '解除鎖定' : '鎖定此座位'}">${lockedSet.has(st.id) ? '🔒' : '🔓'}</button>`;
    } else {
      inner = '<span class="d-empty">空位</span>';
    }
    if (canEditDesks()) {
      inner += '<button class="del" data-del-desk title="刪除這個座位">×</button>';
      if (groupNum(seat.group)) inner += `<span class="d-grp">${groupNum(seat.group)}組</span>`;
    }
    if (ui.secretMode) {
      inner += `<span class="d-seatno">#${seatNoMap[seat.id]}</span>`;
      const fx = state.secret.fixed[seat.id], bn = state.secret.ban[seat.id];
      if (fx) { cls.push('sec-fixed'); inner += `<span class="d-sec" title="內定：${esc(studentById(fx)?.name)}">🤫 ${esc(studentById(fx)?.name)}</span>`; }
      else if (bn?.length) { cls.push('sec-ban'); inner += `<span class="d-sec ban" title="不會抽到 ${bn.length} 人">🚫 ${bn.length}</span>`; }
    }
    html += `<div class="${cls.join(' ')}" data-seat="${seat.id}" style="left:${v.x}px;top:${v.y}px">${inner}</div>`;
  }
  room.innerHTML = html;
  fitNames();
  fitRoom();

  const empties = state.seats.length - Object.keys(state.assign).length;
  const tips = state.mode === 'swap'
    ? ['拖到另一個座位＝互換', '拖到空白處＝移動座位', '點一下學生可查看條件，🔓 可鎖定']
    : ['拖曳桌子可自由調整位置'];
  if (canEditDesks()) tips.push('在空白處點兩下＝新增座位', '桌子左上角 × ＝刪除座位');
  $('#roomHint').textContent = tips.join('；') + `。（${state.seats.length} 個座位、${state.students.length} 位學生、${empties} 個空位${state.pool?.length ? `、${state.pool.length} 位還在名條區` : ''}）`;

  renderChecks(ev);
  renderSelInfo();
  $('#printTitle').textContent = `${state.className || ''} 座位表`.trim();
}

/* ---------- 老師暗中安排 ---------- */
function renderSecret() {
  const sec = state.secret;
  const nm = (id) => esc(studentById(id)?.name || '');
  const fixedOf = Object.fromEntries(Object.entries(sec.fixed).map(([k, v]) => [v, k]));
  const studOpts = (exclude = new Set(), note = false) => sortedStudents().filter((x) => !exclude.has(x.id))
    .map((x) => `<option value="${x.id}">${esc(x.no)}. ${esc(x.name)}${note && fixedOf[x.id] ? `（已內定 #${seatNo(fixedOf[x.id])}）` : ''}</option>`).join('');
  const seat = state.seats.find((x) => x.id === ui.selSeat);
  let seatHtml = '<p class="hint">點一下座位，設定這個座位「一定抽到」或「一定不會抽到」誰。</p>';
  if (seat) {
    const fx = sec.fixed[seat.id] || '';
    const bans = sec.ban[seat.id] || [];
    const now = state.assign[seat.id];
    seatHtml = `<div class="sec-seat">
      <div class="sec-title">座位 #${seatNo(seat.id)}${groupNum(seat.group) ? `（第 ${groupNum(seat.group)} 組）` : ''}<span class="hint">目前：${now ? nm(now) : '空位'}</span></div>
      <label class="sec-row"><span>一定抽到</span><select data-sec-fixed><option value="">不指定</option>${studOpts(new Set(), true)}</select></label>
      ${fx ? `<div class="sec-row"><span>備案位置：這個位子被別人自選走時，${nm(fx)} 依序改坐</span><div class="sec-chips">${(sec.backup?.[fx] || []).map((k) => `<span class="sec-chip">#${seatNo(k)}<button data-sec-unbackup="${k}" aria-label="移除">×</button></span>`).join('')}
        <select data-sec-backup><option value="">＋ 加入座位…</option>${seatOrder(state.seats).filter((x) => x.id !== seat.id && !(sec.backup?.[fx] || []).includes(x.id)).map((x) => `<option value="${x.id}">#${seatNo(x.id)}${state.assign[x.id] ? `（目前：${nm(state.assign[x.id])}）` : '（空位）'}</option>`).join('')}</select></div>
        <span class="hint">沒有備案（或備案也被選走）時，依抽籤設定重新安排。</span></div>` : ''}
      <div class="sec-row"><span>一定不會抽到</span><div class="sec-chips">${bans.map((id) => `<span class="sec-chip">${nm(id)}<button data-sec-unban="${id}" aria-label="移除">×</button></span>`).join('')}
        <select data-sec-ban><option value="">＋ 加入…</option>${studOpts(new Set([...bans, fx]))}</select></div></div>
    </div>`;
    queueMicrotask(() => { const el = $('[data-sec-fixed]'); if (el) el.value = fx; });
  }
  queueMicrotask(() => { const el = $('[data-sec-apart-who]'); if (el) el.value = ui.apartWho || ''; });
  // 不能坐隔壁：依人分組顯示（同一個人的放一起）
  const apartRows = [];
  {
    let rest = sec.apart.map(([a, b2]) => [a, b2]);
    while (rest.length) {
      const cnt = {};
      rest.forEach(([a, b2]) => { cnt[a] = (cnt[a] || 0) + 1; cnt[b2] = (cnt[b2] || 0) + 1; });
      const p = Object.keys(cnt).sort((x, y) => cnt[y] - cnt[x] || (Number(studentById(x)?.no) || 0) - (Number(studentById(y)?.no) || 0))[0];
      const others = rest.filter(([a, b2]) => a === p || b2 === p).map(([a, b2]) => (a === p ? b2 : a));
      rest = rest.filter(([a, b2]) => a !== p && b2 !== p);
      apartRows.push({ p, others });
    }
  }
  const apartWho = ui.apartWho && studentById(ui.apartWho) ? ui.apartWho : '';
  const apartSet = new Set(sec.apart.filter(([a, b2]) => a === apartWho || b2 === apartWho).map(([a, b2]) => (a === apartWho ? b2 : a)));
  const apartHtml = (apartRows.map(({ p, others }) => `<div class="apart-row"><button class="apart-who" data-sec-apart-pick="${p}" title="編輯 ${nm(p)}">${nm(p)}</button><span class="apart-x">✕</span>
      <span class="sec-chips">${others.map((o) => `<span class="sec-chip">${nm(o)}<button data-sec-unapart-pair="${p}|${o}" aria-label="移除">×</button></span>`).join('')}</span></div>`).join('')
    || '<span class="hint">尚未設定</span>');
  const apartEditor = `<div class="sec-pair"><select data-sec-apart-who><option value="">選一位同學…</option>${studOpts()}</select></div>
    ${apartWho ? `<p class="hint"><b>${nm(apartWho)}</b> 旁邊不能坐誰？點名字就加入或取消（紫色＝不能坐隔壁）</p>
      <div class="apart-grid">${sortedStudents().filter((x) => x.id !== apartWho).map((x) => `<button class="${apartSet.has(x.id) ? 'on' : ''}" data-sec-apart-toggle="${x.id}">${esc(x.no)}. ${esc(x.name)}</button>`).join('')}</div>
      <div class="sec-pair"><button class="btn small" data-sec-apart-done>完成</button></div>` : ''}`;
  const list = [
    ...Object.entries(sec.fixed).map(([k, v]) => ({ k, t: `#${seatNo(k)} 一定是 ${nm(v)}` })),
    ...Object.entries(sec.ban).map(([k, v]) => ({ k, t: `#${seatNo(k)} 不會是 ${v.map(nm).join('、')}` })),
    ...Object.entries(sec.backup || {}).map(([who, v]) => ({ k: Object.keys(sec.fixed).find((kk) => sec.fixed[kk] === who) || v[0], t: `${nm(who)} 的備案：${v.map((k) => '#' + seatNo(k)).join(' → ')}` })),
  ].sort((x, y) => seatNo(x.k) - seatNo(y.k));
  const status = ui.secretStatus === undefined ? ''
    : ui.secretStatus ? `<p class="sec-status warn">⚠ 上次排座有 ${ui.secretStatus} 項安排無法同時做到</p>`
      : '<p class="sec-status ok">✓ 上次排座全部照安排</p>';
  const fixedCount = Object.keys(sec.fixed).length;
  const freeCount = Math.max(0, state.students.length - fixedCount);
  const o = state.drawOpts;
  const optRow = (key, opts) => `<div class="sec-opts">${opts.map(([v, label]) =>
    `<button class="${o[key] === v ? 'on' : ''}" data-draw-opt="${key}" data-val="${v}">${label}</button>`).join('')}</div>`;
  $('#secretBody').innerHTML = `
    <p class="hint">只有按工具列的「說明」開啟時看得到，座位表、學生名單和抽籤畫面都不會顯示。下一次 🎰 抽籤、🎲 隨機或自動排座時生效。</p>
    <div class="sec-block first">
      <div class="sec-title">🎰 抽籤設定</div>
      <div class="sec-row"><span>怎麼抽</span>${optRow('mode', [['cond', '依條件'], ['random', '完全隨機']])}</div>
      <div class="sec-row"><span>搖籤時間</span>${optRow('speed', [['fast', '短'], ['mid', '普通'], ['slow', '長']])}</div>
      <div class="sec-row"><span>音效</span>${optRow('sound', [['on', '開'], ['off', '關']])}</div>
      <p class="hint">「依條件」會遵守所有排座條件（身高、視力、偏好…）；「完全隨機」只遵守不可相鄰、不可同組、換位子、每組男女和下面的安排，其他隨機。按「抽籤」後，學生選自己的座號、搖籤筒，就會抽到照這些設定安排好的座位。</p>
    </div>
    ${status}
    <div class="sec-block">
      ${sec.usedAt && fixedCount ? `<div class="sec-status warn">⚠ 這些內定已在 ${fmtTime(sec.usedAt)} 的抽籤用過了。要重新排，請先按「取消全部內定」。</div>` : ''}
      <div class="sec-title">📋 整份座位內定</div>
      <p class="hint">把畫面上「目前的座位」全部設成一定抽到，學生抽籤時就會抽出一模一樣的結果。想留幾個位子讓學生真的隨機抽，點那個座位，把「一定抽到」改成「不指定」就好。</p>
      <div class="sec-pair"><button class="btn small" data-sec-fixall>照目前座位全部內定</button>
        ${fixedCount ? `<button class="btn small" data-sec-unfixall>取消全部內定</button>` : ''}</div>
      <div class="sec-fixsum">${fixedCount ? `目前內定 ${fixedCount} 個座位，${freeCount} 位同學會隨機抽` : '目前沒有內定的座位'}</div>
    </div>
    ${seatHtml}
    <div class="sec-block">
      <div class="sec-title">不能坐隔壁</div>
      <div class="apart-list">${apartHtml}</div>
      ${apartEditor}
    </div>
    <div class="sec-block">
      <div class="sec-title">全部安排（${list.length + sec.apart.length}）${list.length + sec.apart.length ? '<button class="link-btn" data-sec-clear>全部清除</button>' : ''}</div>
      ${list.length ? `<details ${list.length <= 8 ? 'open' : ''}><summary>展開清單</summary><ul class="sec-list">${list.map((x) => `<li><button class="link-btn" data-sec-pick="${x.k}">${x.t}</button></li>`).join('')}</ul></details>` : ''}
    </div>`;
}

function bindSecret() {
  $('#btnSecret').addEventListener('click', () => { ui.secretMode = !ui.secretMode; renderSeatsPanel(); });
  $('#secretClose').addEventListener('click', () => { ui.secretMode = false; renderSeatsPanel(); });
  $('#btnGuide').addEventListener('click', () => $('#guideDialog').showModal());
  $('#guideClose').addEventListener('click', () => $('#guideDialog').close());
  const box = $('#secretBody');
  const sec = () => state.secret;
  const done = () => { save(); renderSeatsPanel(); };
  box.addEventListener('change', (e) => {
    const seatId = ui.selSeat;
    const v = e.target.value;
    if ('secApartWho' in e.target.dataset) {
      ui.apartWho = v || null;
      renderSecret();
      return;
    }
    if ('secFixed' in e.target.dataset && seatId) {
      delete sec().usedAt;
      for (const [k, x] of Object.entries(sec().fixed)) if (x === v) delete sec().fixed[k];
      if (v) {
        sec().fixed[seatId] = v;
        if (sec().ban[seatId]) sec().ban[seatId] = sec().ban[seatId].filter((x) => x !== v);
      } else delete sec().fixed[seatId];
      done();
    } else if ('secBackup' in e.target.dataset && seatId && v) {
      const who = sec().fixed[seatId];
      if (!who) return;
      sec().backup ||= {};
      sec().backup[who] = [...new Set([...(sec().backup[who] || []), v])];
      done();
    } else if ('secBan' in e.target.dataset && seatId && v) {
      sec().ban[seatId] = [...new Set([...(sec().ban[seatId] || []), v])];
      if (sec().fixed[seatId] === v) delete sec().fixed[seatId];
      done();
    }
  });
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const d = btn.dataset;
    if (d.secUnbackup) {
      const who = sec().fixed[ui.selSeat];
      if (who && sec().backup?.[who]) {
        sec().backup[who] = sec().backup[who].filter((x) => x !== d.secUnbackup);
        if (!sec().backup[who].length) delete sec().backup[who];
      }
      done();
      return;
    }
    if (d.secUnban) {
      const list = (sec().ban[ui.selSeat] || []).filter((x) => x !== d.secUnban);
      if (list.length) sec().ban[ui.selSeat] = list; else delete sec().ban[ui.selSeat];
      done();
    } else if (d.secUnapartPair) {
      const [a, b] = d.secUnapartPair.split('|');
      sec().apart = sec().apart.filter(([x, y]) => !((x === a && y === b) || (x === b && y === a)));
      done();
    } else if (d.secApartPick) {
      ui.apartWho = d.secApartPick;
      renderSecret();
    } else if (d.secApartToggle) {
      const a = ui.apartWho, b = d.secApartToggle;
      if (!a || a === b) return;
      const has = sec().apart.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
      if (has) sec().apart = sec().apart.filter(([x, y]) => !((x === a && y === b) || (x === b && y === a)));
      else sec().apart.push([a, b]);
      done();
    } else if ('secApartDone' in d) {
      ui.apartWho = null;
      renderSecret();
    } else if ('secAddapart' in d) {
      const a = $('[data-sec-a]').value, b = $('[data-sec-b]').value;
      if (!a || !b || a === b) { toast('請選兩位不同的同學'); return; }
      if (!sec().apart.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) sec().apart.push([a, b]);
      done();
    } else if (d.drawOpt) {
      state.drawOpts[d.drawOpt] = d.val;
      done();
    } else if (d.secPick) {
      ui.selSeat = d.secPick;
      ui.selected = state.assign[d.secPick] || null;
      renderSeatsPanel();
    } else if ('secFixall' in d) {
      delete sec().usedAt;
      const n = Object.keys(state.assign).length;
      if (Object.keys(sec().fixed).length && !confirm('用目前的座位取代所有內定？')) return;
      sec().fixed = { ...state.assign };
      // 和內定衝突的「不會抽到」一併移除
      for (const [k, v] of Object.entries(sec().ban)) {
        const keep = v.filter((x) => x !== sec().fixed[k]);
        if (keep.length) sec().ban[k] = keep; else delete sec().ban[k];
      }
      ui.secretStatus = undefined;
      done();
      toast(`已把目前 ${n} 個座位全部內定`);
    } else if ('secUnfixall' in d) {
      if (!confirm('取消全部內定？（「不會抽到」和「不能坐隔壁」會保留）')) return;
      sec().fixed = {};
      sec().backup = {};
      delete sec().usedAt;
      ui.secretStatus = undefined;
      done();
    } else if ('secClear' in d) {
      if (!confirm('清除全部的暗中安排？')) return;
      state.secret = { fixed: {}, ban: {}, apart: [], backup: {} };
      ui.secretStatus = undefined;
      done();
    }
  });
}

/** 上次抽籤用過的內定還在時，老師重排前先問要不要清空（只在老師端操作時問，不在抽籤畫面問） */
function askClearUsedFixed() {
  const n = Object.keys(state.secret.fixed).length;
  if (!state.secret.usedAt || !n) return;
  if (confirm('上次抽籤用的座位說明還在，要先清空嗎？')) {
    state.secret.fixed = {};
    state.secret.backup = {};
    toast('已清空');
  }
  delete state.secret.usedAt;
  save();
}

/* ---------- 抽籤（學生一個一個上台搖籤筒） ---------- */
const SHAKE_MS = { fast: 700, mid: 1500, slow: 2600 };
const isClean = () => document.body.classList.contains('big-screen') || !!ui.drawing;

function startDraw() {
  if (ui.drawing) return;
  // 老師畫面上按抽籤＝測試：設定面板留著；給學生抽（大屏、抽籤專用連結）才藏起老師的東西
  const test = !document.body.classList.contains('big-screen') && !cloud.session?.kiosk;
  if (!test) askRememberCurrent();
  if (!test) ui.secretMode = false; // 學生看得到的畫面：一定藏起老師的安排
  ui.selSeat = null; ui.selected = null;
  pushHistory();
  ui.drawTestHistory = test ? ui.history.length : 0;
  // 結果先依老師的設定排好、藏起來，學生抽到時才揭曉
  const sessionFixed = { ...state.secret.fixed };
  optimize(state.drawOpts.mode !== 'random', null, sessionFixed);
  save();
  const locked = new Set(state.locked);
  ui.drawing = { done: new Set(state.students.filter((x) => locked.has(x.id)).map((x) => x.id)), current: null, last: null, busy: false, mode: 'draw', fixed: sessionFixed };
  ui.drawing.test = test;
  document.body.classList.add('is-drawing');
  document.body.classList.toggle('draw-test', test);
  $('#drawTestNote').hidden = !test;
  $('#drawBanner').hidden = false;
  $('#drawStick').classList.remove('rise');
  setDrawLabel('請選擇座號');
  renderSeatsPanel();
  renderDrawPad();
}

function setDrawLabel(t) { $('#drawLabel').textContent = t; }

/* ---------- 自選座位（抽籤前讓表現好的同學先挑） ---------- */
function setDrawMode(mode) {
  const d = ui.drawing;
  if (!d || d.busy) return;
  d.mode = mode;
  d.current = null;
  document.body.classList.toggle('pick-mode', mode === 'pick');
  setDrawLabel(mode === 'pick' ? '自選座位：先選座號，再點想坐的位子' : '請選擇座號');
  renderDrawPad();
}

/**
 * 學生自由選位：選了就坐（只有已經有人揭曉的位子不能選）。
 * 老師的內定只在這次抽籤中跟著調整：被選走位子的同學改坐「備案位置」，沒有備案就依條件重新排。
 */
function pickSeat(seatId) {
  const d = ui.drawing;
  if (!d || d.mode !== 'pick' || d.busy) return;
  if (!d.current) { toast('先選座號'); return; }
  const occ = state.assign[seatId];
  if (occ && d.done.has(occ)) { toast('這個位子已經有人了'); return; }
  const sid = d.current;
  const fx = d.fixed;
  const takenByDone = (k) => { const o = state.assign[k]; return o && d.done.has(o); };
  // 自己原本被內定在別的位子：那個位子空出來
  for (const k of Object.keys(fx)) if (fx[k] === sid && k !== seatId) delete fx[k];
  const displaced = [];
  if (fx[seatId] && fx[seatId] !== sid) displaced.push(fx[seatId]);
  delete fx[seatId];
  // 「不能坐隔壁」的對象如果被內定在旁邊、還沒揭曉，也一起改到備案位置
  const geo = geometry();
  const idxOf = Object.fromEntries(state.seats.map((x, i) => [x.id, i]));
  for (const [x, y] of state.secret.apart) {
    const other = x === sid ? y : y === sid ? x : null;
    if (!other || d.done.has(other)) continue;
    const k = Object.keys(fx).find((kk) => fx[kk] === other);
    if (k && geo.adj[idxOf[k] * geo.N + idxOf[seatId]]) { delete fx[k]; displaced.push(other); }
  }
  for (const who of displaced) {
    const backup = (state.secret.backup?.[who] || []).find((k) => k !== seatId && !fx[k] && !takenByDone(k));
    if (backup) fx[backup] = who;
  }
  // 已揭曉的同學和這次自選的位子固定，其他人照（調整後的）老師設定重新排
  const extra = { [seatId]: sid };
  for (const [k, v] of Object.entries(state.assign)) if (d.done.has(v) && v !== sid && k !== seatId) extra[k] = v;
  optimize(state.drawOpts.mode !== 'random', extra, fx);
  save();
  const st = studentById(sid);
  d.done.add(sid);
  d.last = sid;
  d.current = null;
  playDing();
  renderRoom();
  setDrawLabel(`${st.no} 號 ${st.name} 選好了！`);
  renderDrawPad();
}

function renderDrawPad() {
  const d = ui.drawing;
  if (!d) return;
  $('#drawPad').innerHTML = sortedStudents().map((st) => {
    const done = d.done.has(st.id);
    return `<button class="pad-no ${done ? 'done' : ''} ${d.current === st.id ? 'sel' : ''}" data-draw-no="${st.id}" ${done || d.busy ? 'disabled' : ''}>
      <b>${esc(st.no)}</b><small>${esc(st.name)}</small></button>`;
  }).join('');
  const left = state.students.filter((x) => !d.done.has(x.id)).length;
  $$('#drawModes [data-dmode]').forEach((b) => b.classList.toggle('on', b.dataset.dmode === d.mode));
  $('#drawShake').hidden = d.mode === 'pick';
  const shakeBtn = $('#drawShake');
  shakeBtn.disabled = d.busy || !d.current;
  shakeBtn.textContent = d.busy ? '搖籤中…' : d.current ? `🙏 ${studentById(d.current)?.no} 號，搖籤筒！` : '先選座號';
  $('#drawLeft').textContent = left ? `還有 ${left} 人` : '全部抽完 🎉';
  $('#drawRemember').hidden = !!left;
}

async function drawShake() {
  const d = ui.drawing;
  if (!d || d.busy || !d.current) return;
  const st = studentById(d.current);
  d.busy = true;
  renderDrawPad();
  setDrawLabel(`${st.no} 號 ${st.name} 搖籤中…`);
  const stick = $('#drawStick');
  stick.classList.remove('rise');
  $('#drawTube').classList.add('shake');
  const shakeMs = SHAKE_MS[state.drawOpts.speed] || SHAKE_MS.mid;
  playRattle(shakeMs);
  await new Promise((r) => setTimeout(r, shakeMs));
  $('#drawTube').classList.remove('shake');
  // 跳出寫著名字的籤（直書：一個字一行）
  const chars = [...st.name];
  $('#drawName').innerHTML = chars.map((ch) => `<span>${esc(ch)}</span>`).join('');
  $('#drawName').style.fontSize = (chars.length <= 4 ? 22 : chars.length <= 6 ? 16 : 11) + 'px';
  $('#drawNo').textContent = `${st.no}號`;
  void stick.offsetWidth;
  stick.classList.add('rise');
  playDing();
  d.done.add(st.id);
  if (state.students.every((x) => d.done.has(x.id))) setTimeout(playFanfare, 700);
  d.last = st.id;
  d.current = null;
  d.busy = false;
  renderRoom();
  setDrawLabel(`${st.name}，請看亮起來的座位！`);
  renderDrawPad();
}

function revealAll() {
  const d = ui.drawing;
  if (!d) return;
  state.students.forEach((x) => d.done.add(x.id));
  d.current = null; d.last = null;
  renderRoom();
  renderDrawPad();
  setDrawLabel('全部揭曉');
}

function endDraw() {
  if (!ui.drawing) return;
  const left = state.students.filter((x) => !ui.drawing.done.has(x.id)).length;
  if (left && !confirm(`還有 ${left} 人沒抽，結束後會直接顯示全部座位。確定結束？`)) return;
  const test = ui.drawing.test;
  ui.drawing = null;
  ui.revealed = true;
  // 記下這份內定已經用過（下次老師重排時會提醒清空）；老師測試的不算
  if (!test && Object.keys(state.secret.fixed).length) { state.secret.usedAt = Date.now(); save(); }
  $('#drawBanner').hidden = true;
  document.body.classList.remove('is-drawing', 'pick-mode', 'draw-test');
  // 測試抽籤：問要不要回到抽籤前的座位
  if (test && ui.history.length >= ui.drawTestHistory && ui.drawTestHistory && confirm('測試抽籤結束。\n要把座位恢復成抽籤前的樣子嗎？\n\n確定＝恢復　取消＝保留抽出來的座位')) {
    ui.history.length = ui.drawTestHistory;
    Object.assign(state, JSON.parse(ui.history.pop()));
    ensureSeating(); save();
    renderSeatsPanel();
    toast('已恢復成抽籤前的座位');
    return;
  }
  renderSeatsPanel();
  toast('抽籤結束');
}

/* ---------- 大屏模式（投影給學生看） ---------- */
function setBigScreen(on) {
  ui.revealed = false; // 進大屏時先不顯示新的座位，抽完籤才揭曉
  document.body.classList.toggle('big-screen', on);
  $('#bigBar').hidden = !on;
  if (on) {
    ui.secretMode = false; ui.selSeat = null; ui.selected = null;
    if (state.tab !== 'seats') showTab('seats');
    try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch { /* 不支援全螢幕 */ }
  } else if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
  renderSeatsPanel();
}

/** 名字字體依桌子寬度自動放大／縮小 */
function fitNames() {
  const els = $$('#room .d-name');
  const MAX = 24, MIN = 11;
  els.forEach((el) => { el.style.fontSize = MAX + 'px'; });
  const sizes = els.map((el) => (el.clientWidth && el.scrollWidth > el.clientWidth
    ? Math.max(MIN, Math.floor((MAX * el.clientWidth) / el.scrollWidth))
    : MAX));
  els.forEach((el, i) => { el.style.fontSize = sizes[i] + 'px'; });
}

/** 畫面座標（桌子左上角）→ 資料座標 */
function fromView(vx, vy) {
  const { b, pad } = ui.view;
  const p = state.flipped
    ? { x: b.maxX + pad - vx, y: b.maxY + pad - vy }
    : { x: vx + b.minX - pad, y: vy + b.minY - pad - PODIUM_SPACE };
  return { x: Math.round(p.x / 8) * 8, y: Math.round(p.y / 8) * 8 };
}

function canEditDesks() {
  return state.mode === 'move' || isTemplate();
}

/* ---------- 上次的座位 ---------- */
const SIDE_LABEL = { L: '左側', R: '右側', C: '中間' };

/** 找出「上次座位」在目前座位中的位置：同一張桌子，或位置幾乎一樣的桌子 */
function prevSeatIndex(pv, seats) {
  if (!pv) return -1;
  const k = seats.findIndex((x) => x.id === pv.seatId);
  if (k >= 0) return k;
  return seats.findIndex((x) => Math.abs(x.x - pv.x) < DESK_W / 2 && Math.abs(x.y - pv.y) < DESK_H / 2);
}

/** 記住的座位：最新在前，最多 3 次 */
const MAX_RECORDS = 10;
/** 全部記住過的座位（最新在前，最多 10 次） */
const allRecords = () => [state.prev, ...(state.prevHistory || [])].filter((r) => r && r.seats).slice(0, MAX_RECORDS);
const prevRecords = () => [state.prev, ...(state.prevHistory || [])].filter((r) => r && r.seats).slice(0, 3);
const prevN = () => clamp(Number(state.conditions.prevSeat?.n) || 1, 1, 3);
const fmtTime = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function prevInfoText() {
  if (!state.prev?.at) return '📌 尚未記住上次座位';
  const n = prevRecords().length;
  return `📌 上次座位：${fmtTime(state.prev.at)} 記錄${n > 1 ? `（共記住 ${n} 次）` : ''}`;
}

/** 上次同一組的同學（記錄裡有組別就看組別，沒有就看是不是坐在旁邊）→ [[學生id, 學生id], …] */
function prevGroupMates() {
  const pv = state.prev?.seats;
  if (!pv) return [];
  const ids = new Set(state.students.map((x) => x.id));
  const ent = Object.entries(pv).filter(([sid]) => ids.has(sid));
  const grp = (v) => v.group ?? state.seats.find((x) => x.id === v.seatId)?.group ?? null;
  const out = [];
  for (let i = 0; i < ent.length; i++) {
    for (let j = i + 1; j < ent.length; j++) {
      const [a, va] = ent[i], [b, vb] = ent[j];
      const ga = grp(va), gb = grp(vb);
      const same = ga && gb ? ga === gb : (Math.abs(va.x - vb.x) < DESK_W * 1.3 && Math.abs(va.y - vb.y) < DESK_H * 1.6);
      if (same) out.push([a, b]);
    }
  }
  return out;
}

/** 💾 存下新排的座位：存成「我的方案」，不會變成教室現在的座位 */
function saveNewSeating() {
  const def = `新排的座位 ${fmtTime(Date.now())}`;
  const name = prompt('幫這份新排的座位取個名字（之後可以在「📚 紀錄／方案 → 我的方案」一鍵載入）', def);
  if (name === null) return;
  state.plans = [...(state.plans || []), { id: uid(), name: name.trim() || def, ...currentPlanData(true) }];
  save();
  toast(`已存成方案「${name.trim() || def}」，在「📚 紀錄／方案 → 我的方案」。學生照這份坐好之後，再按「📌 記住教室現在的座位」`, 5000);
}

/** 目前畫面上的座位跟「上次記住的」一樣嗎 */
function sameAsPrev() {
  const p = state.prev?.seats;
  if (!p) return false;
  const cur = Object.entries(state.assign);
  return cur.length === Object.keys(p).length && cur.every(([seat, sid]) => p[sid]?.seatId === seat);
}
/**
 * 按自動排座／隨機／抽籤之前：目前的座位是老師自己排的（不是剛剛自動排出來的）、還沒記住，
 * 而且有開「換位子」或「左右換邊」→ 問一下要不要先記成目前座位，這次才會以它為準
 */
function askRememberCurrent() {
  const c = state.conditions;
  if (!(c.prevSeat?.on || c.prevSide?.on || c.prevGroup?.on)) return;
  if (cloud.session?.kiosk || document.body.classList.contains('big-screen')) return;
  if ((state.pool || []).length || Object.keys(state.assign).length < state.students.length) return;
  if (hashStr(JSON.stringify(state.assign)) === state.autoHash || sameAsPrev()) return;
  if (confirm('畫面上的座位還沒記住。\n這是學生「現在在坐」的座位嗎？\n\n確定＝記成教室現在的座位，這次換位子、換邊、換組員會以它為準\n取消＝不記（只是試排的）')) rememberSeating({ quiet: true });
}

function rememberSeating({ quiet = false } = {}) {
  const g = geometry();
  const seats = {};
  state.seats.forEach((s, i) => {
    const st = state.assign[s.id];
    if (st) seats[st] = { seatId: s.id, x: s.x, y: s.y, side: g.sideCat[i], group: s.group || null };
  });
  const same = state.prev?.seats && Object.keys(seats).length === Object.keys(state.prev.seats).length
    && Object.entries(seats).every(([k, v]) => state.prev.seats[k]?.seatId === v.seatId);
  // 舊的往後推，最多保留 3 次；同一份座位重複按只更新時間
  if (!same && state.prev?.seats) state.prevHistory = [state.prev, ...(state.prevHistory || [])].slice(0, MAX_RECORDS - 1);
  state.prev = { at: Date.now(), seats };
  state.autoHash = '';
  save();
  // 有登入雲端就不用每次下載備份檔
  const backup = !quiet && !cloud.session;
  if (backup) exportData();
  renderSeatsPanel();
  toast(cloud.session?.kiosk ? '已記住這次座位' : `已記住教室現在的座位（可在「📚 紀錄／方案」查看）${backup ? '，備份檔也下載到「下載」資料夾了' : ''}`, 4000);
}

/** 下載資料備份（JSON） */
function exportData() {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  state.lastBackup = Date.now();
  save();
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.className || '班級'}-座位資料-${ymd}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- 雲端同步（Firebase Auth＋Firestore） ---------- */
const FB_VERSION = '10.12.2';
const FB_CLASSES = 'classseat_classes';   // 每個班級一份文件
const FB_DRAWS = 'classseat_draws';       // 抽籤專用連結（文件代碼就是連結代碼）
const fbConfig = () => { try { return JSON.parse(localStorage.getItem(FB_CONFIG_KEY) || 'null') || FIREBASE_CONFIG; } catch { return FIREBASE_CONFIG; } };
const cloudEnabled = () => !!fbConfig()?.apiKey || !!cloud.session?.kiosk;
const classEmail = (code) => `${code.toLowerCase()}@classseat.local`;
const CODE_RE = /^[A-Za-z0-9_-]{2,20}$/;
const CLOUD_ERR = {
  code: '班級代碼要 2～20 個英文字母、數字、- 或 _（例如 302、class-3b）', key: '老師密碼至少 6 個字', exists: '這個班級代碼已經有人用了，請換一個',
  notfound: '找不到這個班級代碼', wrongpass: '老師密碼不對', invalid: '班級代碼或老師密碼不對', locked: '嘗試太多次了，請過幾分鐘再試',
  session: '這台裝置的登入已失效（可能在別台改了密碼），請重新登入',
  kiosk: '這個抽籤連結已經失效或過期了，請老師重新產生一個',
  noemail: 'Firebase 還沒開啟「電子郵件／密碼」登入（Authentication → 登入方式 → 新增供應商）',
  badrescue: '班級代碼或救援碼不對', rescuestale: '這組救援碼已經失效，請找管理 Firebase 的老師協助',
  toolarge: '資料太大，無法存到雲端', server: '雲端發生錯誤', action: '雲端設定不正確', offline: '連不上雲端，請檢查網路',
};
const cloudErrText = (r) => CLOUD_ERR[r.error] || '連線失敗';

const FB_RESCUE = 'classseat_rescue';     // 救援碼（文件代碼＝班級代碼＋救援碼的雜湊）
const fbApps = {};
function loadScript(src) {
  return new Promise((res, rej) => { const el = document.createElement('script'); el.src = src; el.onload = res; el.onerror = rej; document.head.appendChild(el); });
}
/** 需要時才載入 Firebase（沒用雲端的老師不會載入任何東西） */
async function fbApp(name) {
  if (fbApps[name]) return fbApps[name];
  const cfg = fbConfig();
  if (!cfg?.apiKey) throw new Error('雲端還沒設定');
  if (!window.firebase?.firestore) {
    for (const m of ['app', 'auth', 'firestore']) await loadScript(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-${m}-compat.js`);
  }
  const app = firebase.apps.find((x) => x.name === name) || firebase.initializeApp(cfg, name);
  const auth = app.auth(), db = app.firestore();
  if (localStorage.getItem('classseat-fb-emulator')) { auth.useEmulator('http://127.0.0.1:9099'); db.useEmulator('127.0.0.1', 8080); }
  // 等 Firebase 從瀏覽器讀回登入狀態
  await new Promise((res) => { const off = auth.onAuthStateChanged(() => { off(); res(); }); });
  fbApps[name] = { app, auth, db, FieldValue: firebase.firestore.FieldValue, Timestamp: firebase.firestore.Timestamp, Persistence: firebase.auth.Auth.Persistence };
  return fbApps[name];
}
/** 需要時才載入 Firebase。每個班級用自己的 app，登入狀態分開記，切換班級不用重新輸入密碼 */
async function fbInit(code = '') {
  const shared = await fbApp('classseat');
  if (!code) return shared;
  // 舊版只有一個 app：已經在裡面登入這個班的就繼續用
  if (shared.auth.currentUser?.email === classEmail(code)) return shared;
  return fbApp('cs-' + code);
}

/* ---------- 救援碼：忘記老師密碼時用來重設 ----------
 * 雲端只放加密過的資料：救援碼 → 解開鑰匙 K → 解開老師密碼；文件代碼是雜湊，猜不到
 */
const RC_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newRescueCode = () => [...crypto.getRandomValues(new Uint8Array(12))].map((x) => RC_ALPHA[x % 32]).join('').match(/.{4}/g).join('-');
const normRescue = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const b64 = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8)));
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
async function rescueDocId(code, norm) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`classseat-rescue:${code}:${norm}`));
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
async function rescueWrapKey(norm, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(norm), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const aesKey = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
async function aesEnc(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return b64(out);
}
async function aesDec(key, str) {
  const u = unb64(str);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, key, u.slice(12)));
}
/** 產生新的救援碼（舊的會失效），回傳救援碼 */
async function makeRescue(db, classRef, uid, code, pass) {
  const rc = newRescueCode();
  const norm = normRescue(rc);
  const id = await rescueDocId(code, norm);
  const K = crypto.getRandomValues(new Uint8Array(32));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const old = (await classRef.get()).data()?.rescue?.id;
  await db.collection(FB_RESCUE).doc(id).set({
    owner: uid, code, salt: b64(salt), createdAt: Date.now(),
    wrapped: await aesEnc(await rescueWrapKey(norm, salt), K),
    encPass: await aesEnc(await aesKey(K), new TextEncoder().encode(pass)),
  });
  const at = Date.now();
  await classRef.update({ rescue: { id, k: b64(K), at } });
  if (old && old !== id) await db.collection(FB_RESCUE).doc(old).delete().catch(() => {});
  return { rescueCode: rc, rescueAt: at };
}
const fbErr = (e) => {
  const c = e?.code || '';
  if (/email-already-in-use/.test(c)) return 'exists';
  if (/user-not-found/.test(c)) return 'notfound';
  if (/wrong-password/.test(c)) return 'wrongpass';
  if (/invalid-credential|invalid-login|invalid-email/.test(c)) return 'invalid';
  if (/too-many-requests/.test(c)) return 'locked';
  if (/operation-not-allowed/.test(c)) return 'noemail';
  if (/weak-password/.test(c)) return 'key';
  if (/permission-denied|not-found/.test(c)) return 'session';
  if (/unavailable|network/.test(c)) return 'offline';
  return 'server';
};
const randomId = () => [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, '0')).join('');

/**
 * 與雲端溝通（介面和原本一樣：回傳 { ok, ... } 或 { ok:false, error }）
 * 老師：Firebase 帳號（班級代碼@classseat.local）；抽籤連結：classseat_draws/{連結代碼}
 */
async function cloudCall(action, p = {}) {
  try {
    const code = String(p.code || '').toLowerCase();
    const fx = await fbInit(p.token && p.token !== 'fb' ? '' : code);
    const { auth, db, Timestamp, Persistence } = fx;
    const classRef = db.collection(FB_CLASSES).doc(code);
    const me = auth.currentUser;
    const isMe = () => me && me.email === classEmail(code);

    // ---- 抽籤連結（不需要登入）
    if (p.token && p.token !== 'fb') {
      const ref = db.collection(FB_DRAWS).doc(p.token);
      if (action === 'load') {
        const d = await ref.get();
        if (!d.exists || d.data().code !== code || d.data().expiresAt.toMillis() < Date.now()) return { ok: false, error: 'session' };
        return { ok: true, role: 'draw', data: d.data().data, updatedAt: d.data().updatedAt, name: d.data().name || '' };
      }
      if (action === 'save') {
        const now = Date.now();
        await ref.update({ data: p.data, updatedAt: now, kioskAt: now });
        return { ok: true, updatedAt: now };
      }
      return { ok: false, error: 'action' };
    }

    if (action === 'create' || action === 'login') {
      await auth.setPersistence(p.remember ? Persistence.LOCAL : Persistence.SESSION);
      if (action === 'create') {
        const cred = await auth.createUserWithEmailAndPassword(classEmail(code), p.pass);
        const now = Date.now();
        await classRef.set({ owner: cred.user.uid, name: p.name || '', data: p.data, updatedAt: now, passwdAt: 0 });
        let rescue = {};
        try { rescue = await makeRescue(db, classRef, cred.user.uid, code, p.pass); } catch { /* 之後可以在雲端視窗再產生 */ }
        return { ok: true, token: 'fb', updatedAt: now, ...rescue };
      }
      await auth.signInWithEmailAndPassword(classEmail(code), p.pass);
      const r = await loadClass(fx, classRef, code);
      return { ...r, token: 'fb' };
    }

    // ---- 忘記密碼：用救援碼重設（不需要登入）
    if (action === 'rescue') {
      const norm = normRescue(p.rescue);
      const ref = db.collection(FB_RESCUE).doc(await rescueDocId(code, norm));
      let d;
      try { d = await ref.get(); } catch (e) { if (/permission/.test(e.code)) return { ok: false, error: 'badrescue' }; throw e; }
      if (!d.exists || d.data().code !== code) return { ok: false, error: 'badrescue' };
      let K, oldPass;
      try {
        K = await aesDec(await rescueWrapKey(norm, unb64(d.data().salt)), d.data().wrapped);
        oldPass = new TextDecoder().decode(await aesDec(await aesKey(K), d.data().encPass));
      } catch { return { ok: false, error: 'badrescue' }; }
      await auth.setPersistence(p.remember ? Persistence.LOCAL : Persistence.SESSION);
      try { await auth.signInWithEmailAndPassword(classEmail(code), oldPass); } catch (e) { return { ok: false, error: /too-many/.test(e.code) ? 'locked' : 'rescuestale' }; }
      await auth.currentUser.updatePassword(p.newPass);
      await ref.update({ encPass: await aesEnc(await aesKey(K), new TextEncoder().encode(p.newPass)) });
      const now = Date.now();
      await classRef.update({ passwdAt: now });
      await revokeDraws(db, auth.currentUser.uid, code);
      const r = await loadClass(fx, classRef, code);
      return { ...r, token: 'fb', loginAt: now };
    }

    if (!isMe()) return { ok: false, error: 'session' };
    if (action === 'load') {
      const r = await loadClass(fx, classRef, code);
      if (r.ok && r.passwdAt > (p.loginAt || 0)) { await auth.signOut(); return { ok: false, error: 'session' }; }
      return r;
    }
    if (action === 'save') {
      const res = await db.runTransaction(async (tx) => {
        const d = await tx.get(classRef);
        const cur = d.exists ? d.data().updatedAt || 0 : 0;
        if (!p.force && p.base && cur > p.base) return { ok: false, error: 'conflict', updatedAt: cur };
        const t = Math.max(Date.now(), cur + 1);
        tx.set(classRef, { owner: me.uid, name: p.name || '', data: p.data, updatedAt: t }, { merge: true });
        return { ok: true, updatedAt: t };
      });
      // 有效的抽籤連結也一起換成最新資料
      if (res.ok) {
        const draws = await db.collection(FB_DRAWS).where('owner', '==', me.uid).where('code', '==', code).get();
        // 學校抽完還沒合併回來的結果不要蓋掉（下次讀取時會合併）
        await Promise.all(draws.docs.filter((x) => x.data().expiresAt.toMillis() > Date.now() && (x.data().kioskAt || 0) <= (x.data().mergedAt || 0))
          .map((x) => x.ref.update({ data: p.data, name: p.name || '', updatedAt: res.updatedAt })));
      }
      return res;
    }
    if (action === 'passwd') {
      try {
        await me.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(me.email, p.oldPass));
      } catch (e) { return { ok: false, error: /too-many/.test(e.code) ? 'locked' : 'wrongpass' }; }
      await me.updatePassword(p.newPass);
      const now = Date.now();
      await classRef.update({ passwdAt: now });
      // 救援碼跟著換成新密碼（救援碼本身不變）
      const rs = (await classRef.get()).data()?.rescue;
      if (rs?.id && rs.k) await db.collection(FB_RESCUE).doc(rs.id).update({ encPass: await aesEnc(await aesKey(unb64(rs.k)), new TextEncoder().encode(p.newPass)) }).catch(() => {});
      await revokeDraws(db, me.uid, code);
      return { ok: true, loginAt: now };
    }
    if (action === 'logout') { await auth.signOut(); return { ok: true }; }
    if (action === 'rescuenew') {
      try {
        await me.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(me.email, p.pass));
      } catch (e) { return { ok: false, error: /too-many/.test(e.code) ? 'locked' : 'wrongpass' }; }
      return { ok: true, ...(await makeRescue(db, classRef, me.uid, code, p.pass)) };
    }
    if (action === 'drawlink') {
      const hours = Math.min(168, Math.max(1, Number(p.hours) || 24));
      const id = randomId();
      const d = await classRef.get();
      const exp = Date.now() + hours * 3600e3;
      await db.collection(FB_DRAWS).doc(id).set({
        owner: me.uid, code, name: d.data().name || '', data: d.data().data, updatedAt: d.data().updatedAt,
        createdAt: Date.now(), expiresAt: Timestamp.fromMillis(exp), kioskAt: 0, mergedAt: 0,
      });
      return { ok: true, drawToken: id, expiresAt: exp };
    }
    if (action === 'drawrevoke') { await revokeDraws(db, me.uid, code); return { ok: true }; }
    return { ok: false, error: 'action' };
  } catch (e) {
    if (e?.message === '雲端還沒設定') throw e;
    return { ok: false, error: fbErr(e), message: String(e?.message || e) };
  }
}

/** 讀班級；如果學校的抽籤連結有新的抽籤結果，先合併回班級 */
async function loadClass({ auth, db }, classRef, code) {
  const d = await classRef.get();
  if (!d.exists) return { ok: false, error: 'notfound' };
  let { data, updatedAt, name, passwdAt } = d.data();
  const rescueAt = d.data().rescue?.at || 0;
  const draws = await db.collection(FB_DRAWS).where('owner', '==', auth.currentUser.uid).where('code', '==', code).get();
  const fresh = draws.docs.map((x) => ({ ref: x.ref, ...x.data() }))
    .filter((x) => (x.kioskAt || 0) > (x.mergedAt || 0))
    .sort((x, y) => y.kioskAt - x.kioskAt)[0];
  if (fresh) {
    const t = Math.max(Date.now(), updatedAt + 1);
    await classRef.update({ data: fresh.data, updatedAt: t });
    await fresh.ref.update({ mergedAt: fresh.kioskAt });
    data = fresh.data; updatedAt = t;
  }
  return { ok: true, data, updatedAt, name, passwdAt: passwdAt || 0, merged: !!fresh, rescueAt };
}

async function revokeDraws(db, uid, code) {
  const draws = await db.collection(FB_DRAWS).where('owner', '==', uid).where('code', '==', code).get();
  await Promise.all(draws.docs.map((x) => x.ref.delete()));
}

function setCloudStatus(st, msg = '') {
  cloud.status = st;
  cloud.msg = msg;
  renderCloudButton();
}

function renderCloudButton() {
  const b = $('#btnCloud');
  if (!b) return;
  const s = cloud.session;
  const label = {
    idle: '', ok: '✓ 已同步', dirty: '● 稍後同步', saving: '同步中…', offline: '⚠ 離線，稍後同步', conflict: '⚠ 有衝突', error: '⚠ 未同步',
  }[cloud.status] || '';
  b.textContent = s ? `☁️ ${s.code} ${s.expired ? '⚠ 請重新登入' : label}`.trim() : '☁️ 雲端';
  b.classList.toggle('warn', !!s && (s.expired || ['offline', 'conflict', 'error'].includes(cloud.status)));
  b.classList.toggle('on', !!s);
  b.title = s ? `雲端班級：${s.code}${cloud.msg ? '（' + cloud.msg + '）' : ''}` : '用班級代碼＋老師密碼存到雲端';
}

// 自動同步的間隔：5 分鐘（按「💾 儲存」、切到別的視窗或關掉網頁時會馬上上傳）
const SYNC_MS = 5 * 60 * 1000;
function scheduleCloudSave() {
  // 抽籤專用連結：結果要盡快回到雲端
  if (cloud.session?.kiosk) { clearTimeout(cloud.timer); cloud.timer = setTimeout(() => cloudSave(), 2500); return; }
  if (cloud.status === 'ok' || cloud.status === 'idle') setCloudStatus('dirty');
  if (cloud.timer) return; // 已經排好了，不用每改一次就重新計時
  cloud.timer = setTimeout(() => { cloud.timer = null; cloudSave(); }, SYNC_MS);
}
/** 有還沒上傳的修改就馬上上傳 */
function flushCloudSave() {
  const sess = cloud.session;
  if (!sess || sess.expired || sess.kiosk) return;
  if (hashStr(JSON.stringify(state)) === sess.syncedHash) return;
  clearTimeout(cloud.timer); cloud.timer = null;
  cloudSave();
}

async function cloudSave(force = false) {
  const sess = cloud.session;
  if (!sess || sess.expired) return;
  if (cloud.busy) { cloud.pending = true; return; }
  const json = JSON.stringify(state);
  const h = hashStr(json);
  if (!force && h === sess.syncedHash) { setCloudStatus('ok'); return; }
  cloud.busy = true;
  setCloudStatus('saving');
  try {
    const r = await cloudCall('save', { code: sess.code, token: sess.token, data: await makeDataCode(), base: sess.updatedAt, name: state.className || '', force });
    if (r.ok) {
      sess.updatedAt = r.updatedAt;
      sess.syncedHash = h;
      setSession(sess);
      setCloudStatus('ok');
    } else if (r.error === 'conflict') {
      setCloudStatus('conflict');
      openConflict(r.updatedAt);
    } else if (r.error === 'session') {
      sessionExpired();
    } else if (r.error === 'offline') {
      setCloudStatus('offline');
    } else {
      setCloudStatus('error', cloudErrText(r));
    }
  } catch {
    setCloudStatus('offline');
  } finally {
    cloud.busy = false;
    if (cloud.pending) { cloud.pending = false; scheduleCloudSave(); }
  }
}

/** 換成雲端上的資料（同時更新這台的暫存） */
function applyCloudState(newState, updatedAt) {
  state = newState;
  ui.history = []; ui.selected = null; ui.selSeat = null;
  $('#className').value = state.className || '';
  ensureSeating();
  showTab(state.tab === 'seats' ? 'seats' : 'students');
  const json = JSON.stringify(state);
  try { store().setItem(storeKey(), json); } catch { /* ignore */ }
  cloud.session.updatedAt = updatedAt;
  cloud.session.syncedHash = hashStr(json);
  setSession(cloud.session);
  clearTimeout(cloud.timer); cloud.timer = null;
  setCloudStatus('ok');
}

/** 看看雲端有沒有其他裝置存的新資料 */
async function cloudPull({ quiet = false } = {}) {
  const sess = cloud.session;
  if (!sess || sess.expired || cloud.busy || ui.drawing) return;
  cloud.pulledAt = Date.now();
  try {
    const r = await cloudCall('load', { code: sess.code, token: sess.token, loginAt: sess.loginAt });
    if (!r.ok) { if (r.error === 'session') sessionExpired(); else setCloudStatus(r.error === 'offline' ? 'offline' : 'error', cloudErrText(r)); return; }
    if (r.rescueAt !== undefined && sess.rescueAt !== r.rescueAt) { sess.rescueAt = r.rescueAt; setSession(sess); }
    const localDirty = hashStr(JSON.stringify(state)) !== sess.syncedHash;
    if (r.updatedAt > (sess.updatedAt || 0)) {
      if (localDirty) { setCloudStatus('conflict'); openConflict(r.updatedAt, r.data); return; }
      const data = normalize(await readDataCode(r.data));
      if (data) { applyCloudState(data, r.updatedAt); if (!quiet || r.merged) toast(r.merged ? '已收到學校抽籤的結果' : '已從雲端更新成最新資料', 4000); }
    } else if (localDirty) {
      cloudSave();
    } else {
      setCloudStatus('ok');
    }
  } catch {
    setCloudStatus('offline');
  }
}

/** 登入失效（別台改了密碼或登出）：保留這台的資料，請老師重新登入 */
function sessionExpired() {
  if (cloud.session?.kiosk) { kioskMessage(CLOUD_ERR.kiosk); return; }
  const code = cloud.session?.code;
  cloud.session.expired = true;
  setSession(cloud.session);
  setCloudStatus('error', CLOUD_ERR.session);
  toast(CLOUD_ERR.session, 5000);
  renderCloudDialog();
  if (!$('#cloudDialog').open) $('#cloudDialog').showModal();
  if ($('#clCode')) $('#clCode').value = code || '';
}

function openConflict(updatedAt, remoteData) {
  cloud.conflict = { updatedAt, remoteData };
  $('#conflictText').textContent = `雲端上有其他裝置在 ${fmtTime(updatedAt)} 存的資料，比這台的還新。這台也有還沒上傳的修改。要用哪一份？`;
  if (!$('#conflictDialog').open) $('#conflictDialog').showModal();
}

async function resolveConflict(useCloud) {
  $('#conflictDialog').close();
  const sess = cloud.session;
  if (!sess) return;
  if (useCloud) {
    try {
      let { remoteData, updatedAt } = cloud.conflict || {};
      if (!remoteData) {
        const r = await cloudCall('load', { code: sess.code, token: sess.token, loginAt: sess.loginAt });
        if (!r.ok) { toast(cloudErrText(r)); return; }
        remoteData = r.data; updatedAt = r.updatedAt;
      }
      applyCloudState(normalize(await readDataCode(remoteData)), updatedAt);
      toast('已換成雲端的資料');
    } catch { setCloudStatus('offline'); }
  } else {
    await cloudSave(true);
    toast('已用這台的資料覆蓋雲端');
  }
}

/* ---------- 雲端視窗 ---------- */
/** 登入另一個班之前，把目前的班收進「其他班級」（不登出，之後可以直接切回來） */
async function stashCurrent(nextCode) {
  const cur = cloud.session;
  const others = getOthers();
  delete others[nextCode];
  if (cur && !cur.kiosk && !cur.expired && cur.code !== nextCode) {
    clearTimeout(saveTimer); saveTimer = null;
    try { localStorage.setItem(classKey(cur.code), JSON.stringify(state)); } catch { /* ignore */ }
    if (hashStr(JSON.stringify(state)) !== cur.syncedHash) { clearTimeout(cloud.timer); cloud.timer = null; await cloudSave(); }
    others[cur.code] = cloud.session;
  }
  setOthers(others);
}

/** 切換到這台已經登入過的另一個班級 */
async function switchClass(code, { quietStash = false } = {}) {
  const others = getOthers();
  const target = others[code];
  if (!target) return;
  if (!quietStash) await stashCurrent(code);
  else { delete others[code]; setOthers(others); }
  const left = getOthers(); delete left[code]; setOthers(left);
  cloud.session = target;
  setSession(target);
  const local = load();
  state = local || defaultState();
  if (!local) { target.updatedAt = 0; target.syncedHash = hashStr(JSON.stringify(state)); setSession(target); }
  ui.history = []; ui.selected = null; ui.selSeat = null; ui.poolPick = null;
  $('#className').value = state.className || '';
  ensureSeating();
  showTab(state.tab === 'seats' ? 'seats' : 'students');
  setCloudStatus('idle');
  renderClassSwitch();
  if ($('#cloudDialog').open) $('#cloudDialog').close();
  toast(`已切換到 ${code}`);
  await cloudPull({ quiet: true });
}

/** 在這台登出某個「其他班級」 */
async function forgetClass(code) {
  const others = getOthers();
  if (!others[code]) return;
  if (!confirm(`在這台登出 ${code}？（雲端資料不會刪掉）`)) return;
  try { const f = await fbInit(code); await f.auth.signOut(); } catch { /* ignore */ }
  try { localStorage.removeItem(classKey(code)); } catch { /* ignore */ }
  delete others[code];
  setOthers(others);
  renderClassSwitch();
}

/** 右上角的快速切換（登入兩個班以上才出現） */
function renderClassSwitch() {
  const sel = $('#classSwitch');
  if (!sel) return;
  const sess = cloud.session;
  const others = Object.keys(getOthers()).filter((c) => c !== sess?.code);
  sel.hidden = !sess || sess.kiosk || !others.length;
  if (sel.hidden) return;
  sel.innerHTML = `<option value="">${esc(sess.code)}</option>${others.map((c) => `<option value="${esc(c)}">切換到 ${esc(c)}</option>`).join('')}<option value="+">＋ 其他班級…</option>`;
  sel.value = '';
}

/** 雲端視窗；mode：'welcome' 第一次打開、'add' 再登入／建立另一個班級 */
function renderCloudDialog(mode = '') {
  const sess = cloud.session;
  let html = '';
  $('#cloudBody').after($('#cloudMsg'));
  cloud.welcome = mode === 'welcome' && !sess;
  const others = Object.keys(getOthers()).filter((c) => c !== sess?.code);
  const forgot = `<details class="cl-forgot"><summary>忘記老師密碼？用救援碼重設</summary>
      <div class="cl-form">
        <label>班級代碼<input type="text" id="rsCode" maxlength="20" autocomplete="username"></label>
        <label>救援碼<input type="text" id="rsRescue" placeholder="XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters"></label>
        <label>新的老師密碼<input type="password" id="rsPass" placeholder="至少 6 個字" autocomplete="new-password"></label>
        <label>確認新密碼<input type="password" id="rsPass2" autocomplete="new-password"></label>
      </div>
      <div class="tf-row"><button class="btn" data-cl="rescue">重設密碼並登入</button></div>
      <p class="hint">救援碼是建立班級時出現的那串字。沒有救援碼的話，請找管理 Firebase 的老師協助。重設後，其他裝置要用新密碼重新登入。</p>
    </details>`;
  if (cloud.showRescue) {
    const { code, rc } = cloud.showRescue;
    html = `<div class="cl-box ok">✓ 班級 <b>${esc(code)}</b> 已經可以用了</div>
      <h3 class="sub">🔑 你的救援碼</h3>
      <div class="rescue-code" id="rescueCode">${esc(rc)}</div>
      <p class="hint"><b>忘記老師密碼時，要靠它重設。</b>這組碼只會顯示這一次，請<b>截圖</b>或抄下來，收在自己的地方，不要給學生看。</p>
      <div class="tf-row"><button class="btn" data-cl="rescuecopy">複製救援碼</button><button class="btn primary" data-cl="rescuedone">我存好了</button></div>`;
  } else if (mode === 'welcome' && !sess) {
    html = `<div class="cl-box ok"><b>👋 歡迎使用！</b>先幫你們班建立一個雲端班級，之後在任何電腦、手機登入都是同一份資料。每個班級各自獨立，不會看到或改到別班的資料。</div>
      <div class="cl-form">
        <label>班級代碼<input type="text" id="clCode" placeholder="自己取，例如 302、class3b" autocomplete="username" maxlength="20"></label>
        <label>老師密碼<input type="password" id="clPass" placeholder="至少 6 個字" autocomplete="new-password"></label>
        <label>確認密碼<input type="password" id="clPass2" placeholder="再輸入一次老師密碼" autocomplete="new-password"></label>
        <label class="cl-check"><input type="checkbox" id="clRemember" checked> 記住這台裝置（自己的電腦或手機才勾）</label>
        <input type="radio" name="clSrc" value="blank" checked hidden>
      </div>
      <div class="tf-row"><button class="btn primary" data-cl="create">建立我的班級</button></div>
      <h3 class="sub">已經建立過班級了？</h3>
      <p class="hint">上面填好班級代碼和密碼（確認密碼不用填），按登入。</p>
      <div class="tf-row"><button class="btn" data-cl="login">登入</button></div>
      <h3 class="sub">先試用看看</h3>
      <div class="tf-row"><button class="btn small" data-cl="skip">先不用雲端（資料只存在這台）</button></div>
      <p class="hint">之後隨時可以按左上角「☁️ 雲端」建立班級。</p>${forgot}`;
  } else if (mode !== 'add' && sess && !sess.expired) {
    html = `<div class="cl-box ok">
        <div>目前登入：<b>${esc(sess.code)}</b>${state.className ? `（${esc(state.className)}）` : ''}</div>
        <div class="hint">${cloud.status === 'ok' ? `✓ 已同步${sess.updatedAt ? '（' + fmtTime(sess.updatedAt) + '）' : ''}` : esc(renderStatusText())}</div>
      </div>
      <p class="hint">修改會自動存到雲端。在其他電腦或手機打開網頁、用同一組班級代碼和老師密碼登入，就是同一份資料。</p>
      <div class="tf-row"><button class="btn primary" data-cl="sync">立即同步</button><button class="btn" data-cl="pull">從雲端重新載入</button></div>
      <h3 class="sub">📺 抽籤專用連結</h3>
      <p class="hint">產生一個連結，用 LINE 傳給自己。到學校在大屏的電腦點開，直接就是抽籤畫面，不會出現後台；抽籤結果會自動存回雲端，學校電腦不會留下資料。</p>
      <div class="tf-row"><select id="clDrawHours" aria-label="有效期限"><option value="12">12 小時內有效</option><option value="24" selected>1 天內有效</option><option value="72">3 天內有效</option><option value="168">7 天內有效</option></select>
        <button class="btn primary" data-cl="drawlink">產生抽籤連結</button><button class="btn small" data-cl="drawrevoke">停用所有抽籤連結</button></div>
      <div class="tf-row" id="clDrawOut" hidden><input type="text" id="clDrawLink" readonly><button class="btn small" data-cl="drawcopy">複製</button></div>
      <h3 class="sub">更改老師密碼</h3>
      <div class="cl-form"><input type="password" id="clOldPass" placeholder="目前的密碼" autocomplete="current-password">
        <div class="tf-row"><input type="password" id="clNewPass" placeholder="新密碼（至少 6 個字）" autocomplete="new-password"><button class="btn" data-cl="passwd">更改</button></div></div>
      <p class="hint">改密碼後，其他已登入的裝置和所有抽籤連結都會失效，要用新密碼重新登入。</p>
      <h3 class="sub">🔑 救援碼（忘記密碼時用）</h3>
      ${sess.rescueAt ? `<p class="hint">✓ 已經有救援碼（${fmtTime(sess.rescueAt)} 產生）。找不到的話可以產生新的，舊的就會失效。</p>` : '<div class="cl-box warn">⚠ 這個班還沒有救援碼。忘記密碼就救不回來，建議現在產生一組。</div>'}
      <div class="tf-row"><input type="password" id="clRescuePass" placeholder="目前的老師密碼" autocomplete="current-password"><button class="btn${sess.rescueAt ? '' : ' primary'}" data-cl="rescuenew">產生${sess.rescueAt ? '新的' : ''}救援碼</button></div>
      <h3 class="sub">切換班級</h3>
      ${others.length ? `<div class="cl-classes">${others.map((c) => `<span class="cl-class"><button class="btn small" data-cl="switch" data-code="${esc(c)}">切換到 ${esc(c)}</button><button class="link-btn" data-cl="forget" data-code="${esc(c)}" title="在這台登出 ${esc(c)}">✕</button></span>`).join('')}</div>` : '<p class="hint">教好幾個班的話，可以在這台再登入其他班級，之後一鍵切換，不用重打密碼。</p>'}
      <div class="tf-row"><button class="btn" data-cl="add">＋ 登入或建立另一個班級</button></div>
      <h3 class="sub">登出</h3>
      <div class="tf-row"><button class="btn" data-cl="logout">登出 ${esc(sess.code)}</button><button class="btn danger-text" data-cl="logout-clear">登出並清除這台的資料</button></div>
      <p class="hint">在學校或別人的電腦用完，建議按「登出並清除這台的資料」。資料都還在雲端。</p>`;
  } else {
    const adding = mode === 'add' && sess && !sess.expired;
    html = `${sess?.expired ? `<div class="cl-box warn">⚠ ${CLOUD_ERR.session}</div>` : ''}${adding ? `<div class="cl-box ok">目前的班級 <b>${esc(sess.code)}</b> 會保留，之後可以一鍵切回來。</div><div class="tf-row"><button class="btn small" data-cl="back">← 回到 ${esc(sess.code)}</button></div>` : ''}<p class="hint">用「班級代碼＋老師密碼」登入，資料會存在雲端，任何電腦、手機都能打開同一個班。</p>
      <div class="cl-form">
        <label>班級代碼<input type="text" id="clCode" placeholder="例如 302" autocomplete="username" maxlength="20"></label>
        <label>老師密碼<input type="password" id="clPass" placeholder="至少 6 個字" autocomplete="current-password"></label>
        <label class="cl-check"><input type="checkbox" id="clRemember"> 記住這台裝置（自己的電腦或手機才勾）</label>
      </div>
      <div class="tf-row"><button class="btn primary" data-cl="login">登入</button></div>
      <h3 class="sub">還沒有班級？建立新班級</h3>
      <div class="cl-form">
        <label>確認密碼<input type="password" id="clPass2" placeholder="再輸入一次老師密碼" autocomplete="new-password"></label>
        <label class="cl-check"><input type="radio" name="clSrc" value="current" ${adding ? '' : 'checked'}> 用目前畫面上的資料建立</label>
        <label class="cl-check"><input type="radio" name="clSrc" value="blank" ${adding ? 'checked' : ''}> 建立空白的新班級</label>
      </div>
      <div class="tf-row"><button class="btn" data-cl="create">建立新班級</button></div>
      <p class="hint">班級代碼由你自己決定（英文字母或數字，例如 302、class3b），之後在其他電腦用同一組代碼和密碼登入。</p>${forgot}`;
  }
  $('#cloudBody').innerHTML = html;
  $('#cloudMsg').textContent = '';
  renderClassSwitch();
}

const renderStatusText = () => ({ saving: '同步中…', offline: '⚠ 目前離線，連上網路後會自動同步', conflict: '⚠ 有衝突，請選擇要用哪一份', error: '⚠ ' + (cloud.msg || '還沒同步') }[cloud.status] || '');

function cloudMsg(t, bad = true) {
  const el = $('#cloudMsg');
  // 訊息放在剛剛按的按鈕旁邊，才看得到
  const row = cloud.lastBtn?.isConnected && cloud.lastBtn.closest('.tf-row');
  if (row) row.after(el); else $('#cloudBody').after(el);
  el.textContent = t;
  el.classList.toggle('bad', bad);
}

async function cloudAction(act) {
  const val = (id) => ($(id)?.value || '').trim();
  if (act === 'skip') {
    try { localStorage.setItem('classseat-welcomed', '1'); } catch { /* ignore */ }
    $('#cloudDialog').close();
    return;
  }
  if (act === 'add') { renderCloudDialog('add'); return; }
  if (act === 'back') { renderCloudDialog(); return; }
  if (act === 'rescuedone') { cloud.showRescue = null; $('#cloudDialog').close(); return; }
  if (act === 'rescuecopy') {
    let ok = false;
    try { await navigator.clipboard.writeText(cloud.showRescue?.rc || ''); ok = true; } catch { /* ignore */ }
    cloudMsg(ok ? '✓ 已複製，記得貼到自己的地方存好' : '請直接截圖', !ok);
    return;
  }
  if (act === 'switch') { await switchClass(cloud.lastBtn?.dataset.code); return; }
  if (act === 'forget') { await forgetClass(cloud.lastBtn?.dataset.code); renderCloudDialog(); return; }
  try {
    if (act === 'login' || act === 'create') {
      const code = val('#clCode').toLowerCase(), pass = $('#clPass').value;
      if (!CODE_RE.test(code)) { cloudMsg(CLOUD_ERR.code); return; }
      if (pass.length < 6) { cloudMsg(CLOUD_ERR.key); return; }
      if (act === 'create' && pass !== $('#clPass2').value) { cloudMsg('兩次輸入的密碼不一樣'); return; }
      const remember = $('#clRemember').checked;
      const url = '';
      cloudMsg(act === 'login' ? '登入中…' : '建立中…', false);
      if (act === 'login') {
        const r = await cloudCall('login', { code, pass, remember });
        if (!r.ok) { cloudMsg(cloudErrText(r)); return; }
        const data = normalize(await readDataCode(r.data));
        if (!data) { cloudMsg('雲端資料格式不正確'); return; }
        // 重新登入同一個班、而這台還有沒上傳的修改：先問要用哪一份
        const old = cloud.session;
        if (old?.expired && old.code === code && hashStr(JSON.stringify(state)) !== old.syncedHash) {
          cloud.session = { url, code, token: r.token, remember, loginAt: Date.now(), updatedAt: old.updatedAt, syncedHash: old.syncedHash };
          setSession(cloud.session);
          $('#cloudDialog').close();
          openConflict(r.updatedAt, r.data);
          return;
        }
        await stashCurrent(code);
        cloud.session = { url, code, token: r.token, remember, loginAt: Date.now(), updatedAt: r.updatedAt, syncedHash: '', rescueAt: r.rescueAt || 0 };
        applyCloudState(data, r.updatedAt);
        toast(r.rescueAt ? `已登入 ${code}` : `已登入 ${code}。這個班還沒有救援碼，建議到「☁️ 雲端」產生一組`, r.rescueAt ? 2200 : 5000);
      } else {
        const src = $('input[name="clSrc"]:checked')?.value || 'current';
        const newState = src === 'blank' ? defaultState() : JSON.parse(JSON.stringify(state));
        const keep = state;
        state = newState;
        const data = await makeDataCode();
        state = keep;
        const r = await cloudCall('create', { code, pass, remember, name: newState.className || '', data });
        if (!r.ok) { cloudMsg(cloudErrText(r)); return; }
        await stashCurrent(code);
        cloud.session = { url, code, token: r.token, remember, loginAt: Date.now(), updatedAt: r.updatedAt, syncedHash: '', rescueAt: r.rescueAt || 0 };
        applyCloudState(normalize(newState), r.updatedAt);
        toast(`已建立班級 ${code}，之後會自動存到雲端`);
        if (r.rescueCode) { cloud.showRescue = { code, rc: r.rescueCode }; renderCloudDialog(); return; }
      }
      $('#cloudDialog').close();
      return;
    }
    if (act === 'rescue') {
      const code = val('#rsCode').toLowerCase(), rc = val('#rsRescue'), np = $('#rsPass').value;
      if (!CODE_RE.test(code)) { cloudMsg(CLOUD_ERR.code); return; }
      if (normRescue(rc).length !== 12) { cloudMsg('救援碼是 12 個英文字母和數字（例如 ABCD-EFGH-JK23）'); return; }
      if (np.length < 6) { cloudMsg('新密碼至少 6 個字'); return; }
      if (np !== $('#rsPass2').value) { cloudMsg('兩次輸入的新密碼不一樣'); return; }
      cloudMsg('重設中…', false);
      const r = await cloudCall('rescue', { code, rescue: rc, newPass: np, remember: true });
      if (!r.ok) { cloudMsg(cloudErrText(r)); return; }
      const data = normalize(await readDataCode(r.data));
      if (!data) { cloudMsg('雲端資料格式不正確'); return; }
      await stashCurrent(code);
      cloud.session = { url: '', code, token: r.token, remember: true, loginAt: r.loginAt + 1, updatedAt: r.updatedAt, syncedHash: '', rescueAt: r.rescueAt || 0 };
      applyCloudState(data, r.updatedAt);
      $('#cloudDialog').close();
      toast(`✓ 已重設 ${code} 的老師密碼並登入。其他裝置要用新密碼重新登入`, 5000);
      return;
    }
    if (act === 'rescuenew') {
      const pass = $('#clRescuePass').value;
      if (!pass) { cloudMsg('請輸入目前的老師密碼'); return; }
      if (cloud.session.rescueAt && !confirm('產生新的救援碼之後，舊的救援碼就不能用了。確定嗎？')) return;
      cloudMsg('產生中…', false);
      const sess = cloud.session;
      const r = await cloudCall('rescuenew', { code: sess.code, token: sess.token, pass });
      if (!r.ok) { cloudMsg(r.error === 'wrongpass' ? '目前的密碼不對' : cloudErrText(r)); return; }
      sess.rescueAt = r.rescueAt; setSession(sess);
      cloud.showRescue = { code: sess.code, rc: r.rescueCode };
      renderCloudDialog();
      return;
    }
    if (act === 'drawlink') {
      const sess = cloud.session;
      await cloudSave();
      const r = await cloudCall('drawlink', { code: sess.code, token: sess.token, hours: Number($('#clDrawHours').value) || 24 });
      if (!r.ok) { cloudMsg(cloudErrText(r)); return; }
      const link = `${location.origin + location.pathname}#draw=${encodeURIComponent(sess.code)}&t=${r.drawToken}`;
      $('#clDrawOut').hidden = false;
      $('#clDrawLink').value = link;
      let copied = false;
      try { await navigator.clipboard.writeText(link); copied = true; } catch { /* ignore */ }
      cloudMsg(`${copied ? '✓ 已複製抽籤連結' : '✓ 已產生抽籤連結（請按「複製」）'}，${fmtTime(r.expiresAt)} 前有效。連結等於抽籤用的鑰匙，請只傳給自己。`, false);
      return;
    }
    if (act === 'drawcopy') {
      const el = $('#clDrawLink');
      let copied = false;
      try { await navigator.clipboard.writeText(el.value); copied = true; } catch { el.select(); try { copied = document.execCommand('copy'); } catch { /* ignore */ } }
      cloudMsg(copied ? '✓ 已複製' : '請長按文字框全選後拷貝', !copied);
      return;
    }
    if (act === 'drawrevoke') {
      if (!confirm('停用所有已產生的抽籤連結？')) return;
      const sess = cloud.session;
      const r = await cloudCall('drawrevoke', { code: sess.code, token: sess.token });
      cloudMsg(r.ok ? '✓ 所有抽籤連結都已停用' : cloudErrText(r), !r.ok);
      return;
    }
    if (act === 'sync') { await cloudSave(true); renderCloudDialog(); return; }
    if (act === 'pull') { await cloudPull(); renderCloudDialog(); return; }
    if (act === 'passwd') {
      const np = $('#clNewPass').value, op = $('#clOldPass').value;
      if (!op) { cloudMsg('請輸入目前的密碼'); return; }
      if (np.length < 6) { cloudMsg('新密碼至少 6 個字'); return; }
      const sess = cloud.session;
      const r = await cloudCall('passwd', { code: sess.code, token: sess.token, oldPass: op, newPass: np });
      if (!r.ok) { cloudMsg(r.error === 'wrongpass' ? '目前的密碼不對' : cloudErrText(r)); return; }
      sess.loginAt = r.loginAt + 1; setSession(sess);
      $('#clNewPass').value = ''; $('#clOldPass').value = '';
      cloudMsg('✓ 已更改老師密碼', false);
      return;
    }
    if (act === 'logout' || act === 'logout-clear') {
      const sess = cloud.session;
      if (!sess.expired && hashStr(JSON.stringify(state)) !== sess.syncedHash) {
        await cloudSave();
        if (hashStr(JSON.stringify(state)) !== cloud.session?.syncedHash && !confirm('還有修改沒有存到雲端，確定要登出嗎？')) return;
      }
      if (act === 'logout-clear') { try { localStorage.removeItem(classKey(sess.code)); } catch { /* ignore */ } }
      if (!sess.expired) await cloudCall('logout', { code: sess.code, token: sess.token }).catch(() => {});
      clearTimeout(cloud.timer); cloud.timer = null;
      // 這台還有登入其他班級：切到其中一個
      const others = getOthers();
      const next = Object.keys(others).find((c) => c !== sess.code);
      if (next) {
        cloud.session = null;
        await switchClass(next, { quietStash: true });
        $('#cloudDialog').close();
        toast(`已登出 ${sess.code}，切換到 ${next}`);
        return;
      }
      cloud.session = null;
      setSession(null);
      state = load() || defaultState();
      ui.history = []; ui.selected = null; ui.selSeat = null;
      $('#className').value = state.className || '';
      ensureSeating();
      showTab('students');
      setCloudStatus('idle');
      $('#cloudDialog').close();
      toast(act === 'logout-clear' ? '已登出，並清除這台裝置上的班級資料' : '已登出');
    }
  } catch (err) {
    cloudMsg(err.message && !/fetch|network|JSON|load/i.test(err.message) ? err.message : '連不上雲端，請檢查網路');
  }
}

function bindCloud() {
  $('#btnCloud').addEventListener('click', () => { renderCloudDialog(); $('#cloudDialog').showModal(); });
  $('#cloudClose').addEventListener('click', () => $('#cloudDialog').close());
  // 新老師的歡迎視窗關掉後（建立班級、先試用或按關閉），接著打開使用說明；登入舊班級的就不用
  $('#cloudDialog').addEventListener('close', () => {
    if (!cloud.welcome) { cloud.showRescue = null; return; }
    cloud.welcome = false;
    cloud.showRescue = null;
    if (cloud.lastBtn?.dataset.cl === 'login' && cloud.session) return;
    $('#guideDialog').showModal();
  });
  $('#cloudBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cl]');
    if (b) { cloud.lastBtn = b; cloudAction(b.dataset.cl); }
  });
  $('#cloudBody').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target.id === 'clPass' || e.target.id === 'clCode' || e.target.id === 'clPass2')) {
      const act = e.target.id === 'clPass2' || $('#cloudBody [data-cl="create"].primary') ? 'create' : 'login';
      cloud.lastBtn = $(`#cloudBody [data-cl="${act}"]`);
      cloudAction(act);
    }
  });
  $('#conflictCloud').addEventListener('click', () => resolveConflict(true));
  $('#conflictLocal').addEventListener('click', () => resolveConflict(false));
  window.addEventListener('online', () => cloudSave());
  // 切回這個分頁時，看看其他裝置有沒有新資料
  // 切回來時，超過 5 分鐘沒檢查才去看；切走時把還沒上傳的修改送出去
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { if (Date.now() - (cloud.pulledAt || 0) > SYNC_MS) cloudPull({ quiet: false }); }
    else flushCloudSave();
  });
  window.addEventListener('pagehide', flushCloudSave);
  document.body.classList.toggle('no-cloud', !cloudEnabled());
  renderCloudButton();
  if (cloud.session?.kiosk) startKiosk();
  else if (cloud.session && cloudEnabled()) cloudPull({ quiet: true });
  else if (FIRST_VISIT && cloudEnabled()) { renderCloudDialog('welcome'); $('#cloudDialog').showModal(); }
  renderClassSwitch();
  $('#classSwitch').addEventListener('change', (e) => {
    const v = e.target.value;
    e.target.value = '';
    if (v === '+') { renderCloudDialog('add'); $('#cloudDialog').showModal(); } else if (v) switchClass(v);
  });
  // 開著的時候每 5 分鐘看一次其他裝置有沒有新資料
  setInterval(() => { if (document.visibilityState === 'visible' && cloud.session && !cloud.session.kiosk && Date.now() - (cloud.pulledAt || 0) >= SYNC_MS - 1000) cloudPull({ quiet: false }); }, 60000);
}

/* ---------- 抽籤專用模式（給學校大屏） ---------- */
function kioskMessage(text) {
  const el = $('#kioskCover');
  el.hidden = false;
  $('#kioskText').textContent = text;
}

async function startKiosk() {
  document.body.classList.add('kiosk');
  kioskMessage('載入中…');
  const sess = cloud.session;
  try {
    const r = await cloudCall('load', { code: sess.code, token: sess.token });
    if (!r.ok) { kioskMessage(r.error === 'session' ? CLOUD_ERR.kiosk : cloudErrText(r)); return; }
    // 抽籤連結只顯示畫面，不需要 Firebase 設定以外的東西
    const data = normalize(await readDataCode(r.data));
    if (!data) { kioskMessage('雲端資料格式不正確'); return; }
    data.tab = 'seats';
    applyCloudState(data, r.updatedAt);
    $('#kioskCover').hidden = true;
    setBigScreen(true);
    // 抽籤連結一打開就是籤筒畫面
    startDraw();
  } catch {
    kioskMessage('連不上雲端，請確認網路後重新整理');
  }
}

/* ---------- 資料碼（壓縮後的文字，方便用 LINE／Email 搬到其他裝置） ---------- */
const CODE_PREFIX = 'CLASSSEAT1:';
const toB64 = (bytes) => { let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };
const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
async function makeDataCode() {
  const json = JSON.stringify(state);
  if (typeof CompressionStream === 'undefined') return json;
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  return CODE_PREFIX + toB64(buf);
}
async function readDataCode(text) {
  const t = text.trim().replace(/\s+/g, '');
  if (t.startsWith(CODE_PREFIX)) {
    if (typeof DecompressionStream === 'undefined') throw new Error('bad');
    const stream = new Blob([fromB64(t.slice(CODE_PREFIX.length))]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }
  return JSON.parse(text);
}

/* ---------- 下載座位表圖片 ---------- */
/** 把一份座位畫成圖片（seats：[{id,x,y,group}]、assign：座位→學生） */
function drawSeatCanvas(seats, assign, { title = `${state.className || ''} 座位表`.trim(), sub = fmtTime(Date.now()), scale = 2 } = {}) {
  const pad = 30, titleH = 56, S = scale;
  const xs = seats.map((x) => x.x), ys = seats.map((x) => x.y);
  const b = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  const W = b.maxX - b.minX + DESK_W + pad * 2;
  const RH = b.maxY - b.minY + DESK_H + pad * 2 + PODIUM_SPACE;
  const H = RH + titleH;
  const cv = document.createElement('canvas');
  cv.width = W * S; cv.height = H * S;
  const ctx = cv.getContext('2d');
  ctx.scale(S, S);
  const font = getComputedStyle(document.body).fontFamily;
  const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1f2328'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 22px ${font}`;
  ctx.fillText(title, W / 2, 26);
  ctx.font = `12px ${font}`; ctx.fillStyle = '#6b7280';
  ctx.fillText(sub, W / 2, 46);
  ctx.translate(0, titleH);
  const pw = Math.min(260, W - 40), py = state.flipped ? RH - pad - 40 : pad - 10;
  ctx.fillStyle = '#3d4a45'; rr((W - pw) / 2, py, pw, 40, 6); ctx.fill();
  ctx.fillStyle = '#e9efe9'; ctx.font = `14px ${font}`; ctx.fillText('講　台', W / 2, py + 20);
  const groups = {};
  seats.forEach((st) => {
    if (!groupNum(st.group)) return;
    const v = toView(st.x, st.y, b, pad);
    const g = groups[st.group] || (groups[st.group] = { x: Infinity, y: Infinity, maxY: -Infinity });
    g.x = Math.min(g.x, v.x); g.y = Math.min(g.y, v.y); g.maxY = Math.max(g.maxY, v.y);
  });
  ctx.textAlign = 'left'; ctx.fillStyle = '#6b7280'; ctx.font = `600 12px ${font}`;
  for (const [k, g] of Object.entries(groups)) ctx.fillText(`第 ${groupNum(k)} 組`, g.x, state.flipped ? g.maxY + DESK_H + 10 : g.y - 9);
  for (const seat of seats) {
    const v = toView(seat.x, seat.y, b, pad);
    const st = studentById(assign[seat.id]);
    ctx.fillStyle = st ? '#fffdf7' : '#f5f5f5'; ctx.strokeStyle = '#d6cfbf'; ctx.lineWidth = 1.5;
    rr(v.x, v.y, DESK_W, DESK_H, 7); ctx.fill(); ctx.stroke();
    if (!st) { ctx.fillStyle = '#9ca3af'; ctx.textAlign = 'center'; ctx.font = `13px ${font}`; ctx.fillText('空位', v.x + DESK_W / 2, v.y + DESK_H / 2); continue; }
    ctx.fillStyle = st.gender === 'M' ? '#3b82c4' : st.gender === 'F' ? '#d0578f' : '#d6cfbf';
    ctx.save(); rr(v.x, v.y, DESK_W, DESK_H, 7); ctx.clip(); ctx.fillRect(v.x, v.y, 5, DESK_H); ctx.restore();
    ctx.fillStyle = '#6b7280'; ctx.textAlign = 'left'; ctx.font = `11px ${font}`; ctx.fillText(String(st.no), v.x + 9, v.y + 10);
    let fs = 24;
    ctx.font = `700 ${fs}px ${font}`;
    while (fs > 11 && ctx.measureText(st.name).width > DESK_W - 16) { fs--; ctx.font = `700 ${fs}px ${font}`; }
    ctx.fillStyle = '#1f2328'; ctx.textAlign = 'center';
    ctx.fillText(st.name, v.x + DESK_W / 2 + 2, v.y + DESK_H / 2 + 5);
  }
  return cv;
}

function downloadCanvas(cv, filename) {
  cv.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
}

function downloadSeatImage() {
  downloadCanvas(drawSeatCanvas(state.seats, state.assign), `${state.className || '班級'}-座位表.png`);
}

/* ---------- 📄 PDF：座位表＋學生名單 ---------- */
/** 學生名單畫成一張 A4 直式的圖（只有座號、姓名、性別、組別、座位，不含任何條件或老師的安排） */
function drawRosterCanvas() {
  const W = 1240, H = 1754; // A4 150dpi
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const font = getComputedStyle(document.body).fontFamily;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1f2328'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 44px ${font}`;
  ctx.fillText(`${state.className || ''} 學生名單`.trim(), W / 2, 90);
  ctx.font = `24px ${font}`; ctx.fillStyle = '#6b7280';
  ctx.fillText(fmtTime(Date.now()), W / 2, 140);
  const order = seatOrder(state.seats);
  const seatOf = {};
  order.forEach((x, i) => { const sid = state.assign[x.id]; if (sid) seatOf[sid] = { no: i + 1, g: groupNum(x.group) }; });
  const list = sortedStudents();
  const anyGroup = Object.values(seatOf).some((x) => x.g);
  const cols = list.length > 22 ? 2 : 1;
  const per = Math.ceil(list.length / cols);
  const top = 200, rowH = Math.min(64, Math.floor((H - top - 90) / (per + 1)));
  const colW = cols === 2 ? 540 : 760;
  const gap = cols === 2 ? 60 : 0;
  const left0 = (W - (colW * cols + gap * (cols - 1))) / 2;
  const fields = anyGroup ? [['座號', 0.18], ['姓名', 0.44], ['性別', 0.16], ['組別', 0.22]] : [['座號', 0.22], ['姓名', 0.56], ['性別', 0.22]];
  for (let c = 0; c < cols; c++) {
    const left = left0 + c * (colW + gap);
    const rows = list.slice(c * per, (c + 1) * per);
    if (!rows.length) continue;
    // 表頭
    ctx.fillStyle = '#e8f1ef'; ctx.fillRect(left, top, colW, rowH);
    ctx.fillStyle = '#1f2328'; ctx.font = `700 ${Math.round(rowH * 0.42)}px ${font}`;
    let x = left;
    for (const [label, w] of fields) { ctx.fillText(label, x + (colW * w) / 2, top + rowH / 2); x += colW * w; }
    rows.forEach((st, r) => {
      const y = top + rowH * (r + 1);
      if (r % 2) { ctx.fillStyle = '#fafaf7'; ctx.fillRect(left, y, colW, rowH); }
      const where = seatOf[st.id];
      const vals = [String(st.no), st.name, st.gender === 'M' ? '男' : st.gender === 'F' ? '女' : '', ...(anyGroup ? [where?.g ? `第 ${where.g} 組` : (where ? '' : '還沒排')] : [])];
      let xx = left;
      vals.forEach((v, k) => {
        const w = colW * fields[k][1];
        let fs = Math.round(rowH * (k === 1 ? 0.48 : 0.4));
        ctx.font = `${k === 1 ? 700 : 400} ${fs}px ${font}`;
        while (fs > 12 && ctx.measureText(v).width > w - 12) { fs--; ctx.font = `${k === 1 ? 700 : 400} ${fs}px ${font}`; }
        ctx.fillStyle = k === 2 && st.gender ? (st.gender === 'M' ? '#2f6fb0' : '#b8437a') : '#1f2328';
        ctx.fillText(v, xx + w / 2, y + rowH / 2);
        xx += w;
      });
    });
    ctx.strokeStyle = '#cfd8d5'; ctx.lineWidth = 2;
    ctx.strokeRect(left, top, colW, rowH * (rows.length + 1));
    ctx.lineWidth = 1;
    for (let r = 1; r <= rows.length; r++) { ctx.beginPath(); ctx.moveTo(left, top + rowH * r); ctx.lineTo(left + colW, top + rowH * r); ctx.stroke(); }
  }
  return cv;
}

let jsPdfLoading = null;
async function exportPDF() {
  toast('正在製作 PDF…');
  try {
    if (!window.jspdf) {
      jsPdfLoading ||= loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
      await jsPdfLoading;
    }
    const { jsPDF } = window.jspdf;
    const seat = drawSeatCanvas(state.seats, state.assign);
    const land = seat.width >= seat.height;
    const doc = new jsPDF({ orientation: land ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
    const fit = (cv, pw, ph, m = 10) => {
      const r = Math.min((pw - m * 2) / cv.width, (ph - m * 2) / cv.height);
      const w = cv.width * r, h = cv.height * r;
      return [(pw - w) / 2, (ph - h) / 2, w, h];
    };
    doc.addImage(seat.toDataURL('image/png'), 'PNG', ...fit(seat, land ? 297 : 210, land ? 210 : 297), undefined, 'FAST');
    doc.addPage('a4', 'portrait');
    const roster = drawRosterCanvas();
    doc.addImage(roster.toDataURL('image/png'), 'PNG', ...fit(roster, 210, 297, 0), undefined, 'FAST');
    doc.save(`${state.className || '班級'}-座位表與名單.pdf`);
    toast('✓ PDF 已下載（第 1 頁座位表、第 2 頁名單）', 3500);
  } catch {
    toast('PDF 做不出來（可能是網路擋住了），可以改按「🖨 列印」→ 目的地選「另存為 PDF」', 6000);
  }
}

/* ---------- 📚 紀錄／方案 ---------- */
/** 記住的座位 → 可以畫圖的座位清單 */
function recordToSeats(rec) {
  const seats = [], assign = {};
  Object.entries(rec.seats).forEach(([sid, v], i) => {
    const cur = state.seats.find((x) => x.id === v.seatId);
    const id = 'r' + i;
    seats.push({ id, x: v.x, y: v.y, group: cur?.group || null });
    assign[id] = sid;
  });
  return { seats, assign };
}

const planSummary = (p) => {
  const sec = p.secret;
  if (!sec) return '只有座位';
  const bits = [];
  const f = Object.keys(sec.fixed || {}).length, bn = Object.keys(sec.ban || {}).length, ap = (sec.apart || []).length;
  if (f) bits.push(`內定 ${f}`);
  if (bn) bits.push(`不會抽到 ${bn}`);
  if (ap) bits.push(`不能坐隔壁 ${ap}`);
  return bits.length ? `含老師的安排：${bits.join('、')}` : '含老師的安排（目前沒有設定）';
};

function renderRecords() {
  const tab = ui.recTab || 'hist';
  $$('#recTabs [data-rtab]').forEach((b) => b.classList.toggle('active', b.dataset.rtab === tab));
  const thumb = (seats, assign, title, sub) => drawSeatCanvas(seats, assign, { title, sub, scale: 1 }).toDataURL('image/png');
  let html = '';
  if (tab === 'hist') {
    const recs = allRecords();
    html = `<p class="hint">每按一次「📌 記住教室現在的座位」就會存一筆在這裡（存在這台裝置的瀏覽器，最多 ${MAX_RECORDS} 次；用「💾 備份／搬移」可以帶到其他裝置）。排座條件「🔁 換位子」會參考最近 ${prevN()} 次。</p>`
      + (recs.length ? recs.map((r, i) => {
        const { seats, assign } = recordToSeats(r);
        const label = i === 0 ? '最近一次' : `前 ${i + 1} 次`;
        return `<div class="rec-item">
          <img class="rec-thumb" src="${thumb(seats, assign, `${label}的座位`, fmtTime(r.at))}" alt="" data-rec-zoom="${i}">
          <div class="rec-info"><b>${label}</b><span class="hint">${fmtTime(r.at)}・${Object.keys(r.seats).length} 人</span>
            <div class="rec-actions"><button class="btn small" data-rec-zoom="${i}">放大看</button><button class="btn small" data-rec-apply="${i}">套用到座位表</button><button class="link-btn" data-rec-del="${i}">刪除</button></div></div>
        </div>`;
      }).join('') : '<p class="empty-note">還沒有紀錄。座位排好或抽完籤後，按工具列的「📌 記住教室現在的座位」。</p>');
  } else {
    const plans = state.plans || [];
    html = `<p class="hint">把目前的座位存成方案，之後一鍵載入（例如「段考版」「分組討論版」）。勾選「連同老師的安排」會一起存下內定、不會抽到、不能坐隔壁的設定。</p>
      <div class="rec-save"><input type="text" id="planName" placeholder="方案名稱，例如：段考版" value="方案 ${plans.length + 1}">
        <label><input type="checkbox" id="planWithSecret" checked> 連同老師的安排</label>
        <button class="btn primary small" data-plan-save>＋ 存成新方案</button></div>`
      + (plans.length ? plans.map((p, i) => `<div class="rec-item">
          <img class="rec-thumb" src="${thumb(p.seats, p.assign, p.name, fmtTime(p.at))}" alt="" data-plan-zoom="${i}">
          <div class="rec-info"><b>${esc(p.name)}</b><span class="hint">${fmtTime(p.at)}・${planSummary(p)}</span>
            <div class="rec-actions"><button class="btn small" data-plan-zoom="${i}">放大看</button><button class="btn small" data-plan-load="${i}">載入</button><button class="btn small" data-plan-update="${i}">用目前覆蓋</button><button class="link-btn" data-plan-del="${i}">刪除</button></div></div>
        </div>`).join('') : '<p class="empty-note">還沒有方案。</p>');
  }
  $('#recBody').innerHTML = html;
}

function zoomImage(src) {
  $('#recZoomImg').src = src;
  $('#recZoom').hidden = false;
}

function currentPlanData(withSecret) {
  return {
    at: Date.now(),
    layout: JSON.parse(JSON.stringify(state.layout)),
    seats: templateFrom(state.seats).map((x, i) => ({ ...x, id: state.seats[i].id })),
    assign: { ...state.assign },
    secret: withSecret ? JSON.parse(JSON.stringify(state.secret)) : null,
  };
}

function bindRecords() {
  $('#btnRecords').addEventListener('click', () => { ui.recTab ||= 'hist'; $('#recZoom').hidden = true; renderRecords(); $('#recDialog').showModal(); });
  $('#recClose').addEventListener('click', () => $('#recDialog').close());
  $('#recTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-rtab]'); if (b) { ui.recTab = b.dataset.rtab; renderRecords(); } });
  $('#recZoom').addEventListener('click', () => { $('#recZoom').hidden = true; });
  $('#recBody').addEventListener('click', (e) => {
    const el = e.target.closest('[data-rec-zoom],[data-rec-apply],[data-rec-del],[data-plan-save],[data-plan-zoom],[data-plan-load],[data-plan-update],[data-plan-del]');
    if (!el) return;
    const d = el.dataset;
    const recs = allRecords();
    if (d.recZoom !== undefined) {
      const r = recs[+d.recZoom];
      const { seats, assign } = recordToSeats(r);
      zoomImage(drawSeatCanvas(seats, assign, { title: `${+d.recZoom === 0 ? '最近一次' : `前 ${+d.recZoom + 1} 次`}的座位`, sub: fmtTime(r.at) }).toDataURL('image/png'));
    } else if (d.recApply !== undefined) {
      const r = recs[+d.recApply];
      if (!confirm(`把 ${fmtTime(r.at)} 的座位套用到目前的座位表？（可按「復原」）`)) return;
      pushHistory();
      const assign = {};
      for (const [sid, v] of Object.entries(r.seats)) {
        if (!studentById(sid)) continue;
        const k = prevSeatIndex(v, state.seats);
        if (k >= 0 && !assign[state.seats[k].id]) assign[state.seats[k].id] = sid;
      }
      state.assign = assign;
      ensureSeating();
      save(); renderSeatsPanel();
      $('#recDialog').close();
      toast('已套用');
    } else if (d.recDel !== undefined) {
      if (!confirm('刪除這筆座位紀錄？')) return;
      const all = allRecords();
      all.splice(+d.recDel, 1);
      state.prev = all[0] || null;
      state.prevHistory = all.slice(1);
      save(); renderRecords(); renderConditions();
    } else if ('planSave' in d) {
      const name = $('#planName').value.trim() || `方案 ${(state.plans || []).length + 1}`;
      state.plans = [...(state.plans || []), { id: uid(), name, ...currentPlanData($('#planWithSecret').checked) }];
      save(); renderRecords();
      toast(`已存成方案「${name}」`);
    } else if (d.planZoom !== undefined) {
      const p = state.plans[+d.planZoom];
      zoomImage(drawSeatCanvas(p.seats, p.assign, { title: p.name, sub: fmtTime(p.at) }).toDataURL('image/png'));
    } else if (d.planLoad !== undefined) {
      const p = state.plans[+d.planLoad];
      if (!confirm(`載入方案「${p.name}」？目前的座位${p.secret ? '和老師的安排' : ''}會被取代（可按「復原」）。`)) return;
      pushHistory();
      state.layout = JSON.parse(JSON.stringify(p.layout));
      if (state.layout.type === 'map' && !state.maps.some((m) => m.id === state.layout.mapId)) state.layout.type = 'groups';
      state.seats = p.seats.map((x) => ({ ...x }));
      state.custom = true;
      state.assign = Object.fromEntries(Object.entries(p.assign).filter(([, v]) => studentById(v)));
      if (p.secret) state.secret = JSON.parse(JSON.stringify(p.secret));
      ensureSeating();
      cleanupSecret();
      save(); renderSeatsPanel();
      $('#recDialog').close();
      toast(`已載入「${p.name}」`);
    } else if (d.planUpdate !== undefined) {
      const p = state.plans[+d.planUpdate];
      if (!confirm(`用目前的座位${p.secret ? '和老師的安排' : ''}覆蓋方案「${p.name}」？`)) return;
      Object.assign(p, currentPlanData(!!p.secret));
      save(); renderRecords();
      toast('已更新方案');
    } else if (d.planDel !== undefined) {
      const p = state.plans[+d.planDel];
      if (!confirm(`刪除方案「${p.name}」？`)) return;
      state.plans.splice(+d.planDel, 1);
      save(); renderRecords();
    }
  });
}

/* ---------- 抽籤音效（不需要音檔，用瀏覽器合成） ---------- */
let audioCtx = null;
function sfx() {
  if (state.drawOpts.sound === 'off') return null;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  } catch { return null; }
}
function playRattle(ms) {
  const ac = sfx(); if (!ac) return;
  const len = Math.floor(ac.sampleRate * 0.05);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const t0 = ac.currentTime;
  for (let t = 0; t < ms / 1000; t += 0.07 + Math.random() * 0.05) {
    const src = ac.createBufferSource(); src.buffer = buf;
    const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800 + Math.random() * 1500; f.Q.value = 3;
    const g = ac.createGain(); g.gain.value = 0.5;
    src.connect(f).connect(g).connect(ac.destination);
    src.start(t0 + t);
  }
}
function playTone(freqs, gap = 0, dur = 0.6, vol = 0.25) {
  const ac = sfx(); if (!ac) return;
  const t0 = ac.currentTime;
  freqs.forEach((fr, i) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.value = fr;
    const st = t0 + i * gap;
    g.gain.setValueAtTime(0.0001, st);
    g.gain.exponentialRampToValueAtTime(vol, st + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, st + dur);
    o.connect(g).connect(ac.destination);
    o.start(st); o.stop(st + dur + 0.05);
  });
}
const playDing = () => playTone([1046.5, 1568], 0, 0.9, 0.18);
const playFanfare = () => playTone([523.25, 659.25, 783.99, 1046.5], 0.14, 0.7, 0.2);

/* ---------- 組別 ---------- */
/** 依位置自動分組：桌子邊緣相距很近（含斜角）就算同一組；單獨一張桌子不分組 */
function autoGroup() {
  const seats = state.seats;
  if (groupKeys().length && !confirm('依桌子位置重新分組？目前的組別會被取代。')) return;
  const GAP = 32;
  const parent = seats.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < seats.length; i++) {
    for (let j = i + 1; j < seats.length; j++) {
      const gx = Math.abs(seats[i].x - seats[j].x) - DESK_W;
      const gy = Math.abs(seats[i].y - seats[j].y) - DESK_H;
      if (gx <= GAP && gy <= GAP) parent[find(i)] = find(j);
    }
  }
  const members = {};
  seats.forEach((s, i) => { (members[find(i)] ||= []).push(s); });
  // 組號依前到後、左到右（以每組最前面的桌子為準）
  const clusters = Object.values(members).filter((m) => m.length > 1)
    .map((m) => ({ m, top: seatOrder(m)[0] }))
    .sort((a, b) => (a.top.y - b.top.y) || (a.top.x - b.top.x));
  pushHistory();
  seats.forEach((s) => { s.group = null; });
  clusters.forEach((c, k) => c.m.forEach((s) => { s.group = 'G' + (k + 1); }));
  markDesksEdited();
  save();
  renderSeatsPanel();
  const single = seats.length - clusters.reduce((n, c) => n + c.m.length, 0);
  toast(`已分成 ${clusters.length} 組${single ? `（${single} 張單獨的桌子不分組）` : ''}`);
}

const groupNum = (g) => (/^G\d+$/.test(g || '') ? Number(g.slice(1)) : 0);
function groupKeys() {
  return [...new Set(state.seats.map((s) => s.group).filter(groupNum))].sort((a, b) => groupNum(a) - groupNum(b));
}
function nextGroupKey() {
  return 'G' + (Math.max(0, ...state.seats.map((s) => groupNum(s.group))) + 1);
}
function groupOptions(current, withAuto) {
  const opt = (v, label) => `<option value="${v}" ${current === v ? 'selected' : ''}>${label}</option>`;
  return (withAuto ? opt('auto', '自動（最近的一組）') : '')
    + groupKeys().map((k) => opt(k, `第 ${groupNum(k)} 組`)).join('')
    + opt('new', '＋ 新的一組') + opt('none', '不分組');
}
/** 設定一個座位的組別（choice：G# / new / none） */
function setSeatGroup(seatId, choice, { quiet = false } = {}) {
  const seat = state.seats.find((x) => x.id === seatId);
  if (!seat) return null;
  const g = resolveGroup(choice, seat.x, seat.y);
  if (seat.group === g) return g;
  pushHistory();
  seat.group = g;
  markDesksEdited();
  save();
  renderSeatsPanel();
  if (!quiet) toast(g ? `已改到第 ${groupNum(g)} 組` : '已設為不分組');
  return g;
}

/** 把選項（auto / new / none / G#）換成實際組別 */
function resolveGroup(choice, x, y) {
  if (choice === 'none') return null;
  if (choice === 'new') return nextGroupKey();
  if (choice !== 'auto') return choice;
  let best = null, bestD = Infinity;
  for (const s of state.seats) {
    if (!groupNum(s.group)) continue;
    const d = Math.hypot((s.x - x) / DESK_W, (s.y - y) / DESK_H);
    if (d < bestD) { bestD = d; best = s.group; }
  }
  return bestD <= 2.5 ? best : null;
}

function addDeskAt(x, y) {
  pushHistory();
  const group = resolveGroup(ui.newGroup, x, y);
  // 選「新的一組」後，接著新增的座位都加入同一個新組
  if (ui.newGroup === 'new' && group) ui.newGroup = group;
  const seat = { id: uid(), x, y, group };
  state.seats.push(seat);
  nudgeFree(seat);
  // 有學生還沒座位時，直接坐進新座位
  const seated = new Set(Object.values(state.assign));
  const pooled = new Set(state.pool || []);
  const waiting = sortedStudents().find((s) => !seated.has(s.id) && !pooled.has(s.id));
  if (waiting) state.assign[seat.id] = waiting.id;
  markDesksEdited();
  save();
  renderSeatsPanel();
}

/** 一次刪掉多出來的空位（名條區還沒放的人，會留給他們足夠的空位） */
function deleteExtraDesks() {
  const need = (state.pool || []).length;
  const empties = seatOrder(state.seats).filter((x) => !state.assign[x.id]);
  const extra = empties.length - need;
  if (extra <= 0) { toast(need ? '空位剛好夠名條區的同學，沒有多的' : '沒有空位可以刪'); return; }
  if (!confirm(`要刪掉 ${extra} 個沒有人坐的空位嗎？（按錯可以按「↶ 復原」）`)) return;
  pushHistory();
  const drop = new Set(empties.slice(-extra).map((x) => x.id));
  state.seats = state.seats.filter((x) => !drop.has(x.id));
  markDesksEdited();
  save();
  renderSeatsPanel();
  toast(`已刪掉 ${extra} 個空位`);
}

function deleteDesk(seatId) {
  const sid = state.assign[seatId];
  if (sid && state.pool?.length) {
    // 正在自己排：坐在這裡的人回到名條區
    pushHistory();
    state.pool.push(sid);
    toast(`${studentById(sid)?.name || '學生'} 回到名條區`);
  } else if (sid) {
    const empty = seatOrder(state.seats).find((s) => s.id !== seatId && !state.assign[s.id]);
    pushHistory();
    if (empty) state.assign[empty.id] = sid;
    else { state.pool = [...(state.pool || []), sid]; state.locked = state.locked.filter((x) => x !== sid); }
    toast(`${studentById(sid)?.name || '學生'} ${empty ? '已移到空位' : '沒有空位了，名條放在左邊'}`);
  } else {
    pushHistory();
  }
  delete state.assign[seatId];
  state.seats = state.seats.filter((s) => s.id !== seatId);
  markDesksEdited();
  save();
  renderSeatsPanel();
}

function fitRoom() {
  const wrap = $('#roomWrap'), room = $('#room');
  const W = parseFloat(room.style.width), H = parseFloat(room.style.height);
  const avail = wrap.clientWidth || W;
  if (isClean()) {
    // 大屏／抽籤：放大到填滿螢幕
    const availH = window.innerHeight - wrap.getBoundingClientRect().top - 16;
    ui.scale = Math.max(0.3, Math.min(2.2, avail / W, availH > 200 ? availH / H : avail / W));
  } else {
    ui.scale = Math.min(1, avail / W);
  }
  room.style.transform = `scale(${ui.scale})`;
  wrap.style.height = H * ui.scale + 'px';
}

function renderChecks(ev) {
  const box = $('#checkList');
  if (!ev.items.length) {
    box.innerHTML = '<div class="check-item ok">✓ 所有條件都已滿足</div>';
    return;
  }
  const errs = ev.items.filter((i) => i.level === 'err').length;
  const warns = ev.items.filter((i) => i.level === 'warn').length;
  const head = errs || warns ? `<div class="hint">${errs ? `${errs} 項必須修正` : '沒有違反必要規則'}，${warns} 項建議調整</div>` : '';
  box.innerHTML = head + ev.items.map((i) => `<div class="check-item ${i.level}">${i.level === 'err' ? '✗ ' : i.level === 'warn' ? '△ ' : ''}${esc(i.text)}</div>`).join('');
}

function renderSelInfo() {
  const box = $('#selInfo');
  const s = ui.selected ? studentById(ui.selected) : null;
  const seat = state.seats.find((x) => x.id === ui.selSeat);
  const groupBox = seat && canEditDesks()
    ? `<div class="seat-grp"><label>這個座位屬於 <select data-seat-group>${groupOptions(groupNum(seat.group) ? seat.group : 'none', false)}</select></label></div>`
    : '';
  if (!s) {
    box.innerHTML = seat
      ? `<p><strong>空位</strong></p>${groupBox}`
      : `<p class="hint">點一下座位，可查看學生的條件與關係${canEditDesks() ? '，或更改座位的組別' : ''}。</p>`;
    return;
  }
  const names = (ids) => ids.map((id) => studentById(id)?.name).filter(Boolean).map(esc).join('、') || '—';
  const tags = s.tags.map((t) => tagById(t)?.name).filter(Boolean).map(esc).join('、') || '—';
  box.innerHTML = `<dl>
    <dt>學生</dt><dd><strong>${esc(s.no)}. ${esc(s.name)}</strong> ${s.gender === 'M' ? '（男）' : s.gender === 'F' ? '（女）' : ''}</dd>
    ${state.prev?.seats?.[s.id] ? `<dt>上次座位</dt><dd>${SIDE_LABEL[state.prev.seats[s.id].side]}</dd>` : ''}
    <dt>近視／身高</dt><dd>${s.myopia ? '近視' : '—'}／${s.height ? esc(s.height) + ' cm' : s.hlevel ? HLEVEL_LABEL[s.hlevel] : '—'}</dd>
    <dt>座位偏好</dt><dd>前後：${PREF_LABEL[s.pref]}；左右：${HPREF_LABEL[s.hpref || 'any']}</dd>
    <dt>不可相鄰</dt><dd>${names(s.avoidAdj)}</dd>
    <dt>不可同組</dt><dd>${names(s.avoidGroup)}</dd>
    <dt>盡量同組</dt><dd>${names(s.preferGroup)}</dd>
    <dt>自訂條件</dt><dd>${tags}</dd>
    ${s.note ? `<dt>備註</dt><dd>${esc(s.note)}</dd>` : ''}
  </dl>${groupBox}<p class="hint">橘框：不可相鄰／同組的對象；綠框：盡量同組的對象。</p>`;
}

/* ---------- 名條區：清空座位，老師一個一個放 ---------- */
function renderPool() {
  const box = $('#pool');
  if (!box) return;
  const list = (state.pool || []).map(studentById).filter(Boolean);
  document.body.classList.toggle('has-pool', list.length > 0);
  box.hidden = !list.length;
  $('#btnClearSeats').hidden = list.length > 0;
  if (!list.length) { box.innerHTML = ''; return; }
  const empty = state.seats.filter((x) => !state.assign[x.id]).length;
  box.innerHTML = `<div class="pool-head"><b>名條</b> <span class="hint">還有 ${list.length} 位</span></div>
    <p class="hint pool-tip">拖到座位上；或點名條再點座位。座位上的人拖回這裡＝拿下來。</p>
    <div class="pool-list">${list.map((st) => `<div class="pool-chip ${st.gender ? 'g-' + st.gender : ''} ${ui.poolPick === st.id ? 'picked' : ''}" data-pool="${st.id}"><span class="d-no">${esc(st.no)}</span><span class="pc-name">${esc(st.name)}</span></div>`).join('')}</div>
    <div class="pool-actions"><button class="btn small" id="poolFill" ${empty ? '' : 'disabled'}>剩下的依座號放進空位</button></div>`;
}

const overlaps = (a, b) => Math.abs(a.x - b.x) < DESK_W * 0.6 && Math.abs(a.y - b.y) < DESK_H * 0.6;
const tooClose = (a, b) => Math.abs(a.x - b.x) < DESK_W + 4 && Math.abs(a.y - b.y) < DESK_H + 6;
/** 這個座位跟別的座位疊在一起：挪到附近最近的空處 */
function nudgeFree(seat) {
  const others = state.seats.filter((x) => x !== seat);
  if (!others.some((o) => overlaps(o, seat))) return false;
  const sx = DESK_W + 14, sy = DESK_H + 26;
  let best = null;
  for (let r = 1; r <= 8 && !best; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const c = { x: seat.x + dx * sx, y: seat.y + dy * sy };
        if (others.some((o) => tooClose(o, c))) continue;
        const d = Math.hypot(dx * sx, dy * sy);
        if (!best || d < best.d) best = { ...c, d };
      }
    }
  }
  if (!best) return false;
  seat.x = Math.round(best.x); seat.y = Math.round(best.y);
  return true;
}
function separateOverlaps() {
  pushHistory();
  let n = 0;
  for (let i = 0; i < state.seats.length; i++) {
    for (let j = i + 1; j < state.seats.length; j++) {
      if (overlaps(state.seats[i], state.seats[j]) && nudgeFree(state.seats[j])) n++;
    }
  }
  markDesksEdited(); save(); renderSeatsPanel();
  toast(n ? `已把 ${n} 個疊住的座位移到旁邊，可以再拖到想要的位置` : '沒有疊在一起的座位');
}

/** 座位表上方的提醒：全班幾人、誰不在座位表上（沒座位、在名條區、被疊住的座位蓋住） */
function renderRoomSummary() {
  const el = $('#roomSummary');
  if (!el) return;
  const seats = state.seats;
  const seated = new Set(Object.values(state.assign));
  const hidden = [];
  let nOver = 0;
  for (let i = 0; i < seats.length; i++) {
    for (let j = i + 1; j < seats.length; j++) {
      if (overlaps(seats[i], seats[j])) {
        nOver++;
        const st = studentById(state.assign[seats[i].id]);
        if (st) hidden.push(st);
      }
    }
  }
  const pooled = new Set(state.pool || []);
  const noSeat = sortedStudents().filter((x) => !seated.has(x.id));
  const tag = (x) => `${esc(x.no)}.${esc(x.name)}`;
  const empties = seats.length - seated.size;
  const parts = [`👥 全班 <b>${state.students.length}</b> 人`, `座位 ${seats.length} 個${empties > 0 ? `（${empties} 個空位）` : ''}`];
  const missing = [
    ...noSeat.map((x) => `${tag(x)}${pooled.has(x.id) ? '（在名條區）' : '（沒有座位）'}`),
    ...hidden.map((x) => `${tag(x)}（座位被疊住，看不到）`),
  ];
  el.classList.toggle('warn', missing.length > 0);
  el.innerHTML = parts.join('｜') + '｜' + (missing.length ? `⚠ 不在座位表上：${missing.join('、')}` : '✓ 每個人都在座位表上')
    + (nOver ? ` <button class="btn small" data-fix-overlap>🔧 把疊住的座位分開</button>` : '');
}

/** 把名條區的同學放進座位；座位上原本有人就換到名條區 */
function placeFromPool(sid, seatId) {
  pushHistory();
  const prev = state.assign[seatId];
  state.assign[seatId] = sid;
  const i = state.pool.indexOf(sid);
  if (prev) state.pool.splice(i, 1, prev); else state.pool.splice(i, 1);
  ui.poolPick = null;
  save();
  renderSeatsPanel();
}

/** 座位上的同學拿下來放回名條區 */
function moveToPool(seatId) {
  const sid = state.assign[seatId];
  if (!sid) return;
  pushHistory();
  delete state.assign[seatId];
  state.pool.push(sid);
  state.locked = state.locked.filter((x) => x !== sid);
  save();
  renderSeatsPanel();
}

function clearSeatsToPool() {
  const locked = new Set(state.locked);
  const take = seatOrder(state.seats).filter((x) => state.assign[x.id] && !locked.has(state.assign[x.id]));
  if (!take.length) { toast('沒有可以拿下來的同學（鎖定的不會動）'); return; }
  pushHistory();
  const ids = take.map((x) => state.assign[x.id]);
  take.forEach((x) => delete state.assign[x.id]);
  state.pool = [...state.pool, ...ids].sort((a, b) => (Number(studentById(a)?.no) || 999) - (Number(studentById(b)?.no) || 999));
  ui.selected = null; ui.selSeat = null; ui.poolPick = null;
  save();
  renderSeatsPanel();
  toast(`已清空 ${ids.length} 個座位${locked.size ? '（鎖定的不動）' : ''}，名條在左邊`, 3500);
}

function swapSeats(a, b) {
  if (a === b) return;
  pushHistory();
  const sa = state.assign[a], sb = state.assign[b];
  if (sb) state.assign[a] = sb; else delete state.assign[a];
  if (sa) state.assign[b] = sa; else delete state.assign[b];
  save();
  renderSeatsPanel();
}

function markDesksEdited() {
  const m = currentMap();
  if (m) {
    m.seats = templateFrom(state.seats);
  } else {
    state.custom = true;
  }
}

function changeLayout(mutator) {
  if (state.custom && !confirm('切換或調整版型會重設你手動移動過的桌椅位置，確定嗎？')) { renderSeatsPanel(); return; }
  pushHistory();
  mutator(state.layout);
  relayout();
  save();
  renderSeatsPanel();
}

function bindSeatsPanel() {
  $('#layoutSeg').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del-map]');
    if (del) { e.stopPropagation(); deleteMap(del.dataset.delMap); return; }
    if (e.target.closest('[data-new-map]')) { openMapDialog(state.custom ? 'copy' : 'groups'); return; }
    const mapId = e.target.closest('[data-map]')?.dataset.map;
    if (mapId) {
      if (state.layout.type === 'map' && state.layout.mapId === mapId && !state.custom) return;
      changeLayout((L) => { L.type = 'map'; L.mapId = mapId; });
      toast(`已切換到「${currentMap()?.name}」，可按「依條件自動排座」重新安排`);
      return;
    }
    const t = e.target.closest('[data-layout]')?.dataset.layout;
    if (!t || (t === state.layout.type && !state.custom)) return;
    changeLayout((L) => { L.type = t; });
    toast(`已切換為${LAYOUT_LABEL[t]}，可按「依條件自動排座」重新安排`);
  });
  $('#mapDialog').addEventListener('close', () => { if ($('#mapDialog').returnValue === 'ok') createMap(); });
  // 按「抽籤」直接進入籤筒畫面，設定在「說明」面板裡
  $('#btnDraw').addEventListener('click', startDraw);
  $('#btnDrawLink').addEventListener('click', async () => {
    renderCloudDialog();
    $('#cloudDialog').showModal();
    if (!cloud.session || cloud.session.expired) { cloudMsg('要先登入或建立雲端班級，才能產生抽籤連結'); return; }
    const sel = $('#clDrawHours');
    sel?.closest('.tf-row')?.scrollIntoView({ block: 'center' });
    cloud.lastBtn = $('#cloudBody [data-cl="drawlink"]');
    await cloudAction('drawlink');
  });
  $('#bigDraw').addEventListener('click', () => {
    if (document.body.classList.contains('kiosk') && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    startDraw();
  });
  $('#btnBig').addEventListener('click', () => setBigScreen(true));
  $('#btnRemember').addEventListener('click', () => rememberSeating());
  $('#btnSaveNew').addEventListener('click', saveNewSeating);
  $('#bigExit').addEventListener('click', () => setBigScreen(false));
  $('#drawPad').addEventListener('click', (e) => {
    const b = e.target.closest('[data-draw-no]');
    if (!b || !ui.drawing || ui.drawing.busy) return;
    ui.drawing.current = b.dataset.drawNo;
    const st = studentById(ui.drawing.current);
    setDrawLabel(ui.drawing.mode === 'pick' ? `${st.no} 號 ${st.name}，請在座位表上點你想坐的位子` : `${st.no} 號 ${st.name}，請搖籤筒`);
    renderDrawPad();
  });
  $('#drawModes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-dmode]');
    if (b) setDrawMode(b.dataset.dmode);
  });
  $('#room').addEventListener('click', (e) => {
    const desk = e.target.closest('.desk');
    if (desk && ui.drawing?.mode === 'pick') pickSeat(desk.dataset.seat);
  });
  $('#drawShake').addEventListener('click', drawShake);
  $('#drawTube').addEventListener('click', drawShake);
  $('#drawRevealAll').addEventListener('click', () => { if (confirm('直接揭曉所有還沒抽的座位？')) revealAll(); });
  $('#drawEnd').addEventListener('click', endDraw);
  $('#drawRemember').addEventListener('click', () => { rememberSeating(); endDraw(); });
  $('#btnImage').addEventListener('click', downloadSeatImage);
  $('#btnPdf').addEventListener('click', exportPDF);
  $('#layoutOpts').addEventListener('click', (e) => {
    if (e.target.closest('[data-save-custom]')) openMapDialog('copy');
    if (e.target.closest('[data-auto-group]')) autoGroup();
  });
  $('#layoutOpts').addEventListener('input', (e) => {
    if (!('mapName' in e.target.dataset)) return;
    const m = currentMap();
    if (!m) return;
    m.name = e.target.value;
    const btn = $(`#layoutSeg [data-map="${m.id}"]`);
    if (btn) btn.firstChild.textContent = m.name || '未命名';
    save();
  });
  $('#layoutOpts').addEventListener('change', (e) => {
    const k = e.target.dataset.lo;
    if (!k) return;
    const v = k === 'paired' ? e.target.checked : clamp(Number(e.target.value) || 0, 3, 10);
    changeLayout((L) => { L[k] = v; });
  });
  $('#modeSeg').addEventListener('click', (e) => {
    const m = e.target.closest('[data-mode]')?.dataset.mode;
    if (!m) return;
    state.mode = m;
    save();
    renderSeatsPanel();
  });
  $('#btnArrange').addEventListener('click', () => {
    askRememberCurrent();
    askClearUsedFixed();
    pushHistory();
    const btn = $('#btnArrange');
    btn.disabled = true;
    btn.textContent = '排座中…';
    setTimeout(() => {
      optimize(true);
      btn.disabled = false;
      btn.textContent = '✨ 依條件自動排座';
      save();
      renderSeatsPanel();
      const ev = evaluate();
      const errs = ev.items.filter((i) => i.level === 'err').length;
      toast(errs ? `已排座，但有 ${errs} 項規則無法同時滿足，請查看檢查結果` : '已依條件完成排座 ✓');
    }, 30);
  });
  $('#btnClearSeats').addEventListener('click', clearSeatsToPool);
  $('#roomSummary').addEventListener('click', (e) => { if (e.target.closest('[data-fix-overlap]')) separateOverlaps(); });
  $('#btnDelEmpty').addEventListener('click', deleteExtraDesks);
  $('#btnRandom').addEventListener('click', () => { askRememberCurrent(); askClearUsedFixed(); pushHistory(); optimize(false); save(); renderSeatsPanel(); toast('已隨機排座（鎖定的座位不變）'); });
  $('#btnUndo').addEventListener('click', () => {
    const h = ui.history.pop();
    if (!h) return;
    Object.assign(state, JSON.parse(h));
    ensureSeating();
    save();
    renderSeatsPanel();
  });
  $('#btnFlip').addEventListener('click', () => { state.flipped = !state.flipped; save(); renderSeatsPanel(); });
  $('#btnUnlockAll').addEventListener('click', () => { state.locked = []; save(); renderSeatsPanel(); });
  $('#btnPrint').addEventListener('click', () => window.print());
  $('#btnResetDesks').addEventListener('click', () => {
    if (!confirm('把桌椅還原成目前版型的標準排列？（學生會依原本前後順序放回）')) return;
    pushHistory(); relayout(); save(); renderSeatsPanel();
  });
  $('#btnAddDesk').addEventListener('click', () => {
    const b = roomBounds();
    const last = state.seats.filter((s) => s.y === b.maxY);
    const x = last.length ? Math.max(...last.map((s) => s.x)) + DESK_W + 14 : b.minX;
    addDeskAt(x, b.maxY);
  });

  $('#newDeskGroup').addEventListener('change', (e) => { ui.newGroup = e.target.value; });
  $('#groupBrush').addEventListener('change', (e) => {
    ui.groupBrush = e.target.value || null;
    renderSeatsPanel();
    if (ui.groupBrush) toast('分組刷開啟：點座位就改成這一組。按 Esc 或選「關」結束', 3500);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.groupBrush) { ui.groupBrush = null; renderSeatsPanel(); } });
  $('#selInfo').addEventListener('change', (e) => {
    if (!('seatGroup' in e.target.dataset)) return;
    const seat = state.seats.find((x) => x.id === ui.selSeat);
    if (!seat) return;
    pushHistory();
    seat.group = resolveGroup(e.target.value, seat.x, seat.y);
    markDesksEdited();
    save();
    renderSeatsPanel();
    toast(seat.group ? `已改到第 ${groupNum(seat.group)} 組` : '已設為不分組');
  });

  const room = $('#room');
  room.addEventListener('click', (e) => {
    const desk = e.target.closest('.desk');
    if (!desk) return;
    if (e.target.closest('[data-lock]')) {
      const sid = state.assign[desk.dataset.seat];
      state.locked = state.locked.includes(sid) ? state.locked.filter((x) => x !== sid) : [...state.locked, sid];
      save(); renderSeatsPanel();
    } else if (e.target.closest('[data-del-desk]')) {
      deleteDesk(desk.dataset.seat);
    }
  });
  // 右鍵（手機長按）：鎖定／拿下來／刪除座位
  const menu = document.createElement('div');
  menu.className = 'desk-menu'; menu.hidden = true; menu.setAttribute('role', 'menu');
  document.body.appendChild(menu);
  const closeMenu = () => { menu.hidden = true; };
  room.addEventListener('contextmenu', (e) => {
    const desk = e.target.closest('.desk');
    if (!desk || isClean() || ui.drawing) return;
    e.preventDefault();
    const seatId = desk.dataset.seat;
    const sid = state.assign[seatId];
    const st = studentById(sid);
    const locked = sid && state.locked.includes(sid);
    menu.innerHTML = `<div class="dm-title">${st ? `${esc(st.no)}. ${esc(st.name)}` : '空位'}</div>
      ${st ? `<button data-dm="lock">${locked ? '🔓 解除鎖定' : '🔒 鎖定（自動排座時不動）'}</button>
      <button data-dm="pool">🧺 拿下來放到名條區</button>` : ''}
      <div class="dm-groups"><span>組別</span>${groupKeys().map((k) => `<button data-dm-group="${k}" class="${state.seats.find((x) => x.id === seatId)?.group === k ? 'on' : ''}">${groupNum(k)}</button>`).join('')}<button data-dm-group="new" title="新的一組">＋</button><button data-dm-group="none" title="不分組">不分</button></div>
      <button data-dm="del" class="danger">🗑 刪除這個座位</button>`;
    menu.hidden = false;
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(e.clientX, innerWidth - r.width - 8) + 'px';
    menu.style.top = Math.min(e.clientY, innerHeight - r.height - 8) + 'px';
    menu.dataset.seat = seatId;
  });
  menu.addEventListener('click', (e) => {
    const gb = e.target.closest('[data-dm-group]');
    if (gb) { closeMenu(); setSeatGroup(menu.dataset.seat, gb.dataset.dmGroup); return; }
    const b = e.target.closest('[data-dm]');
    if (!b) return;
    const seatId = menu.dataset.seat, sid = state.assign[seatId];
    closeMenu();
    if (b.dataset.dm === 'lock' && sid) {
      pushHistory();
      state.locked = state.locked.includes(sid) ? state.locked.filter((x) => x !== sid) : [...state.locked, sid];
      save(); renderSeatsPanel();
    } else if (b.dataset.dm === 'pool') moveToPool(seatId);
    else if (b.dataset.dm === 'del') deleteDesk(seatId);
  });
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('scroll', closeMenu, true);
  room.addEventListener('dblclick', (e) => {
    if (!canEditDesks() || e.target.closest('.desk')) return;
    const r = room.getBoundingClientRect();
    const vx = (e.clientX - r.left) / ui.scale - DESK_W / 2;
    const vy = (e.clientY - r.top) / ui.scale - DESK_H / 2;
    const p = fromView(vx, vy);
    addDeskAt(p.x, p.y);
  });

  let drag = null;
  const pool = $('#pool');
  pool.addEventListener('click', (e) => {
    if (e.target.closest('#poolFill')) {
      pushHistory();
      state.pool = [];
      ensureSeating(); save(); renderSeatsPanel();
      return;
    }
  });
  pool.addEventListener('pointerdown', (e) => {
    const chip = e.target.closest('.pool-chip');
    if (!chip || e.button > 0) return;
    const rect = chip.getBoundingClientRect();
    drag = { fromPool: chip.dataset.pool, desk: chip, moved: false, sx: e.clientX, sy: e.clientY, ox: e.clientX - rect.left, oy: e.clientY - rect.top };
    e.preventDefault();
  });
  room.addEventListener('pointerdown', (e) => {
    const desk = e.target.closest('.desk');
    if (!desk || e.button > 0 || e.target.closest('button') || isClean()) return;
    const seatId = desk.dataset.seat;
    const rect = desk.getBoundingClientRect();
    drag = {
      seatId, desk, moved: false,
      sx: e.clientX, sy: e.clientY,
      ox: e.clientX - rect.left, oy: e.clientY - rect.top,
      left: parseFloat(desk.style.left), top: parseFloat(desk.style.top),
    };
    e.preventDefault();
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (drag.fromPool) {
      if (!drag.moved) {
        drag.moved = true;
        drag.ghost = drag.desk.cloneNode(true);
        drag.ghost.classList.add('drag-ghost', 'pool-ghost');
        document.body.appendChild(drag.ghost);
        drag.desk.classList.add('dragging');
      }
      drag.ghost.style.left = e.clientX - drag.ox + 'px';
      drag.ghost.style.top = e.clientY - drag.oy + 'px';
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('#room .desk');
      $$('#room .drop-target').forEach((d) => d !== target && d.classList.remove('drop-target'));
      if (target) target.classList.add('drop-target');
      return;
    }
    if (!drag.moved) {
      drag.moved = true;
      if (state.mode === 'swap') {
        drag.ghost = drag.desk.cloneNode(true);
        drag.ghost.classList.add('drag-ghost');
        drag.ghost.classList.remove('selected', 'conflict', 'warnd', 'rel-bad', 'rel-good');
        drag.ghost.style.transformOrigin = '0 0';
        drag.ghost.style.transform = `scale(${ui.scale}) rotate(-2deg)`;
        document.body.appendChild(drag.ghost);
        drag.desk.classList.add('dragging');
      }
    }
    if (state.mode === 'swap') {
      drag.ghost.style.left = e.clientX - drag.ox + 'px';
      drag.ghost.style.top = e.clientY - drag.oy + 'px';
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('#room .desk');
      $$('#room .drop-target').forEach((d) => d !== target && d.classList.remove('drop-target'));
      if (target && target !== drag.desk) target.classList.add('drop-target');
    } else {
      drag.desk.style.left = drag.left + dx / ui.scale + 'px';
      drag.desk.style.top = drag.top + dy / ui.scale + 'px';
    }
  });
  const endDrag = (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.fromPool) {
      if (!d.moved) {
        // 點一下名條：選起來，再點座位放進去
        if (e.type === 'pointerup') { ui.poolPick = ui.poolPick === d.fromPool ? null : d.fromPool; renderPool(); }
        return;
      }
      d.ghost.remove();
      d.desk.classList.remove('dragging');
      $$('#room .drop-target').forEach((x) => x.classList.remove('drop-target'));
      const hit = e.type === 'pointerup' ? document.elementFromPoint(e.clientX, e.clientY)?.closest('#room .desk') : null;
      if (hit) placeFromPool(d.fromPool, hit.dataset.seat);
      return;
    }
    if (!d.moved) {
      const sid = state.assign[d.seatId];
      if (e.type === 'pointerup' && ui.poolPick && state.pool.includes(ui.poolPick)) { placeFromPool(ui.poolPick, d.seatId); return; }
      if (e.type === 'pointerup' && ui.groupBrush) {
        // 分組刷：點到的座位改成這一組；選「新的一組」時，第一下建立新組，之後都刷這組
        const g = setSeatGroup(d.seatId, ui.groupBrush, { quiet: true });
        if (ui.groupBrush === 'new' && g) { ui.groupBrush = g; renderSeatsPanel(); }
        return;
      }
      if (e.type === 'pointerup') {
        if (ui.selSeat === d.seatId) { ui.selSeat = null; ui.selected = null; } else { ui.selSeat = d.seatId; ui.selected = sid || null; }
        renderRoom();
        if (ui.secretMode) renderSecret();
      }
      return;
    }
    if (state.mode === 'swap') {
      d.ghost.remove();
      d.desk.classList.remove('dragging');
      const hit = e.type === 'pointerup' ? document.elementFromPoint(e.clientX, e.clientY) : null;
      const target = hit?.closest('#room .desk');
      $$('#room .drop-target').forEach((x) => x.classList.remove('drop-target'));
      if (hit?.closest('#pool') || (hit?.closest('.room-card') && !hit.closest('#roomWrap') && document.body.classList.contains('has-pool'))) {
        moveToPool(d.seatId);
      } else if (target && target !== d.desk) {
        swapSeats(d.seatId, target.dataset.seat);
      } else if (!target && hit?.closest('#room')) {
        // 拖到空白處：整個座位（連同學生）移過去
        const r = room.getBoundingClientRect();
        const p = fromView((e.clientX - d.ox - r.left) / ui.scale, (e.clientY - d.oy - r.top) / ui.scale);
        const seat = state.seats.find((s) => s.id === d.seatId);
        pushHistory();
        seat.x = p.x;
        seat.y = p.y;
        if (nudgeFree(seat)) toast('那裡已經有座位了，已放在旁邊');
        markDesksEdited();
        save();
        renderSeatsPanel();
      }
    } else {
      let dx = (e.clientX - d.sx) / ui.scale, dy = (e.clientY - d.sy) / ui.scale;
      if (state.flipped) { dx = -dx; dy = -dy; }
      const seat = state.seats.find((s) => s.id === d.seatId);
      pushHistory();
      seat.x = Math.round((seat.x + dx) / 8) * 8;
      seat.y = Math.round((seat.y + dy) / 8) * 8;
      if (nudgeFree(seat)) toast('那裡已經有座位了，已放在旁邊');
      markDesksEdited();
      save();
      renderSeatsPanel();
    }
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  window.addEventListener('resize', () => { if (!$('#panel-seats').hidden) fitRoom(); });
}

/* =========================================================
   共用：分頁、匯出入、初始化
   ========================================================= */

function showTab(tab) {
  state.tab = tab;
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#panel-students').hidden = tab !== 'students';
  $('#panel-seats').hidden = tab !== 'seats';
  if (tab === 'seats') { ensureSeating(); renderSeatsPanel(); } else renderStudentsPanel();
  save();
}

function bindGlobal() {
  $$('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  const cn = $('#className');
  cn.value = state.className || '';
  cn.addEventListener('input', () => { state.className = cn.value; save(); });

  // 備份／搬到其他裝置（手機、家裡電腦、學校電腦）
  const importData = (raw) => {
    const data = normalize(raw);
    if (!data) throw new Error('bad');
    if (data.students.length < MIN_N || data.students.length > MAX_N) throw new Error('count');
    state = data;
    ui.history = []; ui.selected = null; ui.selSeat = null;
    cn.value = state.className || '';
    ensureSeating();
    save();
    showTab(state.tab);
  };
  const importFail = (err) => toast(err.message === 'count' ? `匯入失敗：人數需介於 ${MIN_N}～${MAX_N}` : '匯入失敗：資料格式不正確', 3500);
  $('#btnTransfer').addEventListener('click', () => { $('#tfText').value = ''; $('#tfInfo').textContent = ''; $('#transferDialog').showModal(); });
  $('#tfClose').addEventListener('click', () => $('#transferDialog').close());
  $('#tfDownload').addEventListener('click', () => { exportData(); toast('備份檔已下載到「下載」資料夾', 3000); });
  $('#tfCopy').addEventListener('click', async () => {
    const code = await makeDataCode();
    state.lastBackup = Date.now(); save();
    const ta = $('#tfText');
    ta.value = code;
    let copied = false;
    try { await navigator.clipboard.writeText(code); copied = true; } catch { /* 不支援時改為手動複製 */ }
    if (!copied) { ta.focus(); ta.select(); try { copied = document.execCommand('copy'); } catch { /* ignore */ } }
    $('#tfInfo').textContent = (copied ? '✓ 已複製資料碼' : '請長按下方文字框「全選 → 拷貝」')
      + `（${code.length} 字）。${code.length > 4500 ? '資料碼較長，LINE 一般訊息可能放不下，建議貼到 LINE Keep、Email 或 Google 文件，或改用「下載備份檔」。' : '可以用 LINE 傳給自己。'}`;
  });
  $('#tfPaste').addEventListener('click', async () => {
    const text = $('#tfText').value.trim();
    if (!text) { toast('請先把資料碼貼到文字框'); return; }
    try {
      const raw = await readDataCode(text);
      if (!confirm('匯入會取代這台裝置目前的資料，確定嗎？')) return;
      importData(raw);
      $('#transferDialog').close();
      toast('已匯入資料');
    } catch (err) { importFail(err); }
  });
  $('#fileImport').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const raw = await readDataCode(await f.text());
      if (!confirm('匯入會取代這台裝置目前的資料，確定嗎？')) return;
      importData(raw);
      $('#transferDialog').close();
      toast('已匯入資料');
    } catch (err) { importFail(err); }
  });
  $('#btnReset').addEventListener('click', () => {
    if (!confirm('確定清除所有學生、條件與座位資料，回到預設狀態？')) return;
    state = defaultState();
    ui.history = []; ui.selected = null; ui.selSeat = null;
    cn.value = '';
    ensureSeating();
    showTab('students');
  });
}

bindGlobal();
// 太久沒備份時提醒（資料只存在這個瀏覽器裡）
setTimeout(() => {
  const days = state.lastBackup ? (Date.now() - state.lastBackup) / 864e5 : Infinity;
  const hasData = !cloud.session && (state.prev || state.students.some((x) => !/^學生\d+$/.test(x.name)));
  if (hasData && days > 14) toast(state.lastBackup ? `已經 ${Math.floor(days)} 天沒有備份了，建議按右上角「💾 備份／搬移」存一份` : '提醒：資料只存在這個瀏覽器，建議按右上角「💾 備份／搬移」備份', 6000);
}, 800);
bindStudentsPanel();
bindSeatsPanel();
bindSecret();
bindRecords();
bindCloud();
ensureSeating();
showTab(state.tab === 'seats' ? 'seats' : 'students');
