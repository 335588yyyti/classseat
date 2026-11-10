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
    },
    layout: { type: 'map', mapId: 'class', cols: 6, paired: true, groups: 6 },
    maps: [{ id: 'class', name: '本班', seats: CLASS_LAYOUT.map((p) => ({ ...p })) }],
    // 老師暗中安排：fixed 座位→一定抽到的學生；ban 座位→一定不會抽到的學生；apart 不能坐隔壁的兩人
    secret: { fixed: {}, ban: {}, apart: [], backup: {} },
    // 抽籤設定（在「說明」面板裡調整）
    drawOpts: { mode: 'cond', order: 'front', speed: 'mid', sound: 'on' },
    seats: [],
    assign: {}, // seatId -> studentId
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
  s.locked = Array.isArray(data.locked) ? data.locked : [];
  return s;
}

/* ---------- 雲端（Google 試算表）：班級代碼＋老師密碼 ---------- */
// 部署好 cloud/Code.gs 後，把網址填在這裡，每台裝置就不用再貼網址
const DEFAULT_CLOUD_URL = '';
const CLOUD_URL_KEY = 'classseat-cloud-url';
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
/* 抽籤專用連結：#draw=班級代碼&t=憑證(&u=雲端網址)。打開後馬上把網址列上的憑證拿掉，只存在這個分頁 */
const KIOSK_KEY = 'classseat-kiosk';
function readKiosk() {
  const m = location.hash.match(/^#draw=([^&]+)&t=([^&]+)(?:&u=([^&]+))?/);
  if (m) {
    const k = { kiosk: true, code: decodeURIComponent(m[1]), token: m[2], url: m[3] ? decodeURIComponent(m[3]) : '', updatedAt: 0, syncedHash: '' };
    try { sessionStorage.setItem(KIOSK_KEY, JSON.stringify(k)); } catch { /* ignore */ }
    history.replaceState(null, '', location.pathname + location.search);
    return k;
  }
  try { return JSON.parse(sessionStorage.getItem(KIOSK_KEY) || 'null'); } catch { return null; }
}
const KIOSK = readKiosk();
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

let state = load() || defaultState();
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const json = JSON.stringify(state);
    try { store().setItem(storeKey(), json); } catch { /* 無痕模式等情況 */ }
    // 登入雲端班級時，資料有變就排程上傳
    if (cloud.session && hashStr(json) !== cloud.session.syncedHash) scheduleCloudSave();
  }, 200);
}

const ui = { selected: null, selSeat: null, newGroup: 'auto', scale: 1, history: [] };

function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

function pushHistory() {
  ui.history.push(JSON.stringify({ seats: state.seats, assign: state.assign, locked: state.locked, layout: state.layout, custom: state.custom, maps: state.maps, secret: state.secret }));
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
  const unseated = sortedStudents().filter((s) => !seated.has(s.id));
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
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const dx = Math.abs(seats[i].x - seats[j].x);
      const dy = Math.abs(seats[i].y - seats[j].y);
      if (dx < DESK_W * 1.3 && dy < DESK_H * 1.6) {
        adj[i * N + j] = adj[j * N + i] = 1;
        adjPairs.push([i, j]);
        if (dy < DESK_H / 2) rowPairs.push([i, j]);
      }
    }
  }
  const isGroups = state.layout.type === 'groups' || (isTemplate() && seats.some((s) => s.group));
  const groupKeys = [...new Set(seats.map((s) => s.group).filter(Boolean))];
  const groupIdx = seats.map((s) => (s.group ? groupKeys.indexOf(s.group) : -1));
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
      if (wPS && prevSeatSets[i].has(pos[i])) t += wPS * 40;
      if (wPD && (prevSide[i] === 'L' || prevSide[i] === 'R') && geo.sideCat[pos[i]] === prevSide[i]) t += wPD * 10;
    }
    for (const [a, b] of avoidAdj) if (adj[pos[a] * N + pos[b]]) t += 1000;
    for (const [a, b] of avoidGroup) if (sameGroup(pos[a], pos[b])) t += 800;
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

  return { geo, idx, cost, secretCost, hasSecret: banList.length + apart.length > 0 };
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

  // 完全隨機時只看老師的暗中安排；依條件時兩者都看
  const costFn = useConditions ? (o, p) => model.cost(o, p) + model.secretCost(o, p) : model.secretCost;
  let best = initial();
  if ((useConditions || model.hasSecret) && movable.length > 1) {
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
  best.occ.forEach((st, si) => { if (st >= 0) state.assign[seats[si].id] = studs[st].id; });
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
  if (prevSameSeat.length) items.push({ level: 'warn', text: `${prevN() > 1 ? `跟最近 ${prevN()} 次坐過的位子重複` : '跟上次坐同一個位子'}：${list(prevSameSeat)}` });
  if (prevStillL.length) items.push({ level: 'warn', text: `上次在左側、這次還在左側（建議換到右側）：${list(prevStillL)}` });
  if (prevStillR.length) items.push({ level: 'warn', text: `上次在右側、這次還在右側（建議換到左側）：${list(prevStillR)}` });
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
    ['gender', '⚥ 性別', '男生旁邊放女生', '男生的左右兩旁盡量安排女生；女生旁邊不限制'],
    ['prevSeat', '🔁 換位子', '不坐坐過的位子', '不要坐最近幾次坐過的位子（在座位安排按「📌 記住這次座位」記錄，最多記 3 次）'],
    ['prevSide', '↔ 左右換邊', '上次左側→換右側', '上次坐左側的換到右側、右側的換到左側；中間的不限（需先「📌 記住這次座位」）'],
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
      <input class="sc-note" type="text" value="${esc(s.note)}" placeholder="備註…" data-f="note" aria-label="備註">
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
  $('#rdClose').addEventListener('click', () => $('#ruleDialog').close());
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
    const list = lines.slice(0, MAX_N).map((line, i) => {
      const st = newStudent(i + 1);
      const tokens = line.split(/[\s,，、\t]+/).filter(Boolean);
      const rest = [];
      for (const tk of tokens) {
        if (/^(男|M|m|boy)$/.test(tk)) st.gender = 'M';
        else if (/^(女|F|f|girl)$/.test(tk)) st.gender = 'F';
        else if (/^近視$/.test(tk)) st.myopia = true;
        else if (/^\d{2,3}(\.\d+)?$/.test(tk) && Number(tk) >= 80) st.height = Number(tk);
        else if (/^(高|中高|普|中|中矮|矮)$/.test(tk)) st.hlevel = { 高: 'tall', 中高: 'midtall', 普: 'mid', 中: 'mid', 中矮: 'midshort', 矮: 'short' }[tk];
        else rest.push(tk);
      }
      if (rest.length) st.name = rest.join(' ');
      return st;
    });
    while (list.length < MIN_N) list.push(newStudent(list.length + 1));
    state.students = list;
    state.assign = {};
    state.locked = [];
    ui.selected = null;
    relayout();
    afterStudentsChanged();
    toast(`已匯入 ${Math.min(lines.length, MAX_N)} 位學生${lines.length > MAX_N ? '（超過 40 人的部分已略過）' : ''}`);
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
  $('#btnResetDesks').hidden = isTemplate();
  $('#btnFlip').textContent = state.flipped ? '視角：講台在下（老師）' : '視角：講台在上（學生）';
  $('#btnUndo').disabled = !ui.history.length;
  $('#btnUnlockAll').disabled = !state.locked.length;
  $('#btnRemember').title = prevInfoText().replace('📌 ', '');
  renderLayoutOpts();
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
  let preAssign = null;
  if (preDraw && state.prev?.seats) {
    preAssign = {};
    for (const [sid, pv] of Object.entries(state.prev.seats)) {
      const k = prevSeatIndex(pv, state.seats);
      if (k >= 0 && studentById(sid) && !preAssign[state.seats[k].id]) preAssign[state.seats[k].id] = sid;
    }
  }
  for (const seat of state.seats) {
    const v = toView(seat.x, seat.y, b, pad);
    const st = studentById(state.assign[seat.id]);
    const cls = ['desk'];
    const clean = isClean();
    if (preDraw) {
      // 大屏還沒抽籤：顯示上次記住的座位，沒有紀錄就全部顯示「？」，不會先看到新的結果
      const ps = studentById(preAssign?.[seat.id]);
      if (!preAssign) html += st ? `<div class="desk draw-hidden" data-seat="${seat.id}" style="left:${v.x}px;top:${v.y}px"><span class="d-name">？</span></div>` : `<div class="desk empty" data-seat="${seat.id}" style="left:${v.x}px;top:${v.y}px"><span class="d-empty">空位</span></div>`;
      else html += `<div class="desk ${ps ? (ps.gender ? 'g-' + ps.gender : '') : 'empty'}" data-seat="${seat.id}" style="left:${v.x}px;top:${v.y}px">${ps ? `<span class="d-no">${esc(ps.no)}</span><span class="d-name">${esc(ps.name)}</span>` : '<span class="d-empty">空位</span>'}</div>`;
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
  $('#roomHint').textContent = tips.join('；') + `。（${state.seats.length} 個座位、${empties} 個空位）`;

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
  const apartHtml = sec.apart.map(([a, b2], i) => `<span class="sec-chip">${nm(a)} ↔ ${nm(b2)}<button data-sec-unapart="${i}" aria-label="移除">×</button></span>`).join('')
    || '<span class="hint">尚未設定</span>';
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
      <p class="hint">「依條件」會遵守不可相鄰、身高、視力等設定；「完全隨機」只遵守下面的安排。按「抽籤」後，學生選自己的座號、搖籤筒，就會抽到照這些設定安排好的座位。</p>
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
      <div class="sec-chips">${apartHtml}</div>
      <div class="sec-pair"><select data-sec-a><option value="">選同學…</option>${studOpts()}</select><span>和</span>
        <select data-sec-b><option value="">選同學…</option>${studOpts()}</select><button class="btn small" data-sec-addapart>加入</button></div>
    </div>
    <div class="sec-block">
      <div class="sec-title">全部安排（${list.length + sec.apart.length}）${list.length + sec.apart.length ? '<button class="link-btn" data-sec-clear>全部清除</button>' : ''}</div>
      ${list.length ? `<details ${list.length <= 8 ? 'open' : ''}><summary>展開清單</summary><ul class="sec-list">${list.map((x) => `<li><button class="link-btn" data-sec-pick="${x.k}">${x.t}</button></li>`).join('')}</ul></details>` : ''}
    </div>`;
}

function bindSecret() {
  $('#btnSecret').addEventListener('click', () => { ui.secretMode = !ui.secretMode; renderSeatsPanel(); });
  $('#secretClose').addEventListener('click', () => { ui.secretMode = false; renderSeatsPanel(); });
  const box = $('#secretBody');
  const sec = () => state.secret;
  const done = () => { save(); renderSeatsPanel(); };
  box.addEventListener('change', (e) => {
    const seatId = ui.selSeat;
    const v = e.target.value;
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
    } else if (d.secUnapart !== undefined) {
      sec().apart.splice(Number(d.secUnapart), 1);
      done();
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
  ui.secretMode = false; // 抽籤時一定藏起老師的安排
  ui.selSeat = null; ui.selected = null;
  pushHistory();
  // 結果先依老師的設定排好、藏起來，學生抽到時才揭曉
  const sessionFixed = { ...state.secret.fixed };
  optimize(state.drawOpts.mode !== 'random', null, sessionFixed);
  save();
  const locked = new Set(state.locked);
  ui.drawing = { done: new Set(state.students.filter((x) => locked.has(x.id)).map((x) => x.id)), current: null, last: null, busy: false, mode: 'draw', fixed: sessionFixed };
  document.body.classList.add('is-drawing');
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
  ui.drawing = null;
  ui.revealed = true;
  // 記下這份內定已經用過（下次老師重排時會提醒清空）
  if (Object.keys(state.secret.fixed).length) { state.secret.usedAt = Date.now(); save(); }
  $('#drawBanner').hidden = true;
  document.body.classList.remove('is-drawing', 'pick-mode');
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

function rememberSeating() {
  const g = geometry();
  const seats = {};
  state.seats.forEach((s, i) => {
    const st = state.assign[s.id];
    if (st) seats[st] = { seatId: s.id, x: s.x, y: s.y, side: g.sideCat[i] };
  });
  const same = state.prev?.seats && Object.keys(seats).length === Object.keys(state.prev.seats).length
    && Object.entries(seats).every(([k, v]) => state.prev.seats[k]?.seatId === v.seatId);
  // 舊的往後推，最多保留 3 次；同一份座位重複按只更新時間
  if (!same && state.prev?.seats) state.prevHistory = [state.prev, ...(state.prevHistory || [])].slice(0, MAX_RECORDS - 1);
  state.prev = { at: Date.now(), seats };
  save();
  if (!cloud.session?.kiosk) exportData();
  renderSeatsPanel();
  toast(cloud.session?.kiosk ? '已記住這次座位' : '已記住這次座位（可在「📚 紀錄／方案」查看），備份檔也下載到「下載」資料夾了', 4000);
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

/* ---------- 雲端同步 ---------- */
const cloudUrl = () => (cloud.session?.kiosk && cloud.session.url) || (localStorage.getItem(CLOUD_URL_KEY) || DEFAULT_CLOUD_URL || '').trim();
const CLOUD_ERR = {
  code: '班級代碼要 2～20 個字，不能有空白', key: '密碼格式不正確', exists: '這個班級代碼已經有人用了，請換一個',
  notfound: '找不到這個班級代碼', wrongpass: '老師密碼不對', locked: '密碼錯太多次，新的登入要等 10 分鐘後再試',
  session: '這台裝置的登入已失效（可能在別台改了密碼），請重新登入',
  kiosk: '這個抽籤連結已經失效或過期了，請老師重新產生一個',
  toolarge: '資料太大，無法存到雲端', server: '雲端程式發生錯誤', action: '雲端程式版本不對，請重新部署 Code.gs',
};
const cloudErrText = (r) => (CLOUD_ERR[r.error] || '連線失敗') + (r.error === 'wrongpass' && r.left !== undefined ? `（再錯 ${r.left} 次會鎖 10 分鐘）` : '');

async function makeKey(code, pass) {
  if (!window.crypto?.subtle) throw new Error('需要用 https 網址打開網頁才能登入雲端');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`classseat|${code}|${pass}`));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function cloudCall(action, payload, url = cloudUrl()) {
  if (!url) throw new Error('還沒設定雲端網址');
  // 用純文字送出，避免瀏覽器先送 OPTIONS（Apps Script 不支援）
  const res = await fetch(url, { method: 'POST', body: JSON.stringify({ action, ...payload }) });
  return res.json();
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
    idle: '', ok: '✓ 已同步', saving: '同步中…', offline: '⚠ 離線，稍後同步', conflict: '⚠ 有衝突', error: '⚠ 未同步',
  }[cloud.status] || '';
  b.textContent = s ? `☁️ ${s.code} ${s.expired ? '⚠ 請重新登入' : label}`.trim() : '☁️ 雲端';
  b.classList.toggle('warn', !!s && (s.expired || ['offline', 'conflict', 'error'].includes(cloud.status)));
  b.classList.toggle('on', !!s);
  b.title = s ? `雲端班級：${s.code}${cloud.msg ? '（' + cloud.msg + '）' : ''}` : '用班級代碼＋老師密碼存到雲端';
}

function scheduleCloudSave() {
  clearTimeout(cloud.timer);
  cloud.timer = setTimeout(() => cloudSave(), 2500);
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
    const r = await cloudCall('save', { code: sess.code, token: sess.token, data: await makeDataCode(), base: sess.updatedAt, name: state.className || '', force }, sess.url);
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
  clearTimeout(cloud.timer);
  setCloudStatus('ok');
}

/** 看看雲端有沒有其他裝置存的新資料 */
async function cloudPull({ quiet = false } = {}) {
  const sess = cloud.session;
  if (!sess || sess.expired || cloud.busy || ui.drawing) return;
  try {
    const r = await cloudCall('load', { code: sess.code, token: sess.token }, sess.url);
    if (!r.ok) { if (r.error === 'session') sessionExpired(); else setCloudStatus('error', cloudErrText(r)); return; }
    const localDirty = hashStr(JSON.stringify(state)) !== sess.syncedHash;
    if (r.updatedAt > (sess.updatedAt || 0)) {
      if (localDirty) { setCloudStatus('conflict'); openConflict(r.updatedAt, r.data); return; }
      const data = normalize(await readDataCode(r.data));
      if (data) { applyCloudState(data, r.updatedAt); if (!quiet) toast('已從雲端更新成最新資料'); }
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
        const r = await cloudCall('load', { code: sess.code, token: sess.token }, sess.url);
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
function renderCloudDialog() {
  const url = cloudUrl();
  const sess = cloud.session;
  let html = '';
  if (sess && !sess.expired) {
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
        <div class="tf-row"><input type="password" id="clNewPass" placeholder="新密碼（至少 4 個字）" autocomplete="new-password"><button class="btn" data-cl="passwd">更改</button></div></div>
      <p class="hint">改密碼後，其他已登入的裝置都會被登出，要用新密碼重新登入。</p>
      <h3 class="sub">切換班級／登出</h3>
      <div class="tf-row"><button class="btn" data-cl="logout">登出</button><button class="btn danger-text" data-cl="logout-clear">登出並清除這台的資料</button></div>
      <p class="hint">在學校或別人的電腦用完，建議按「登出並清除這台的資料」。資料都還在雲端。</p>`;
  } else if (!url && !sess) {
    html = `<p>要用「班級代碼＋老師密碼」在不同電腦登入，需要先設定一次雲端（存在你自己的 Google 試算表）。</p>
      <p class="hint">設定步驟：<a href="https://github.com/335588yyyti/classseat/blob/main/cloud/README.md" target="_blank" rel="noopener">雲端設定教學</a>（約 5 分鐘，只要做一次）</p>`;
  } else {
    html = `${sess?.expired ? `<div class="cl-box warn">⚠ ${CLOUD_ERR.session}</div>` : ''}<p class="hint">用「班級代碼＋老師密碼」登入，資料會存在雲端，任何電腦、手機都能打開同一個班。</p>
      <div class="cl-form">
        <label>班級代碼<input type="text" id="clCode" placeholder="例如 302" autocomplete="username" maxlength="20"></label>
        <label>老師密碼<input type="password" id="clPass" placeholder="至少 4 個字" autocomplete="current-password"></label>
        <label class="cl-check"><input type="checkbox" id="clRemember"> 記住這台裝置（自己的電腦或手機才勾）</label>
      </div>
      <div class="tf-row"><button class="btn primary" data-cl="login">登入</button></div>
      <h3 class="sub">還沒有班級？建立新班級</h3>
      <div class="cl-form">
        <label>確認密碼<input type="password" id="clPass2" placeholder="再輸入一次老師密碼" autocomplete="new-password"></label>
        <label class="cl-check"><input type="radio" name="clSrc" value="current" checked> 用目前畫面上的資料建立</label>
        <label class="cl-check"><input type="radio" name="clSrc" value="blank"> 建立空白的新班級</label>
      </div>
      <div class="tf-row"><button class="btn" data-cl="create">建立新班級</button></div>
      <p class="hint">班級代碼由你自己決定（例如 302、3-5），之後在其他電腦用同一組代碼和密碼登入。</p>`;
  }
  html += `<details class="cl-adv" ${url ? '' : 'open'}><summary>雲端網址設定</summary>
      <div class="tf-row"><input type="text" id="clUrl" placeholder="https://script.google.com/macros/s/……/exec" value="${esc(localStorage.getItem(CLOUD_URL_KEY) || '')}">
      <button class="btn small" data-cl="url">儲存網址</button></div>
      <p class="hint">${DEFAULT_CLOUD_URL ? '網頁已內建雲端網址；這裡填了就會改用你填的。' : '貼上 Google Apps Script 部署後的「網頁應用程式」網址。'}</p></details>`;
  $('#cloudBody').innerHTML = html;
  $('#cloudMsg').textContent = '';
}

const renderStatusText = () => ({ saving: '同步中…', offline: '⚠ 目前離線，連上網路後會自動同步', conflict: '⚠ 有衝突，請選擇要用哪一份', error: '⚠ ' + (cloud.msg || '還沒同步') }[cloud.status] || '');

function cloudMsg(t, bad = true) {
  const el = $('#cloudMsg');
  el.textContent = t;
  el.classList.toggle('bad', bad);
}

async function cloudAction(act) {
  const val = (id) => ($(id)?.value || '').trim();
  try {
    if (act === 'url') {
      const u = val('#clUrl');
      if (u && !/^https:\/\//.test(u)) { cloudMsg('網址要用 https:// 開頭'); return; }
      if (u) {
        cloudMsg('測試連線中…', false);
        const ok = await fetch(u).then((r) => r.json()).then((j) => j.app === 'classseat').catch(() => false);
        if (!ok) { cloudMsg('連不上這個網址，請確認部署時「誰可以存取」選「所有人」'); return; }
        localStorage.setItem(CLOUD_URL_KEY, u);
      } else localStorage.removeItem(CLOUD_URL_KEY);
      renderCloudDialog();
      cloudMsg(u ? '✓ 已儲存網址，可以登入或建立班級了' : '已清除網址', false);
      return;
    }
    if (act === 'login' || act === 'create') {
      const code = val('#clCode'), pass = $('#clPass').value;
      if (!/^\S{2,20}$/.test(code)) { cloudMsg(CLOUD_ERR.code); return; }
      if (pass.length < 4) { cloudMsg('老師密碼至少 4 個字'); return; }
      if (act === 'create' && pass !== $('#clPass2').value) { cloudMsg('兩次輸入的密碼不一樣'); return; }
      const key = await makeKey(code, pass);
      const remember = $('#clRemember').checked;
      const url = cloudUrl();
      cloudMsg(act === 'login' ? '登入中…' : '建立中…', false);
      if (act === 'login') {
        const r = await cloudCall('login', { code, key }, url);
        if (!r.ok) { cloudMsg(cloudErrText(r)); return; }
        const data = normalize(await readDataCode(r.data));
        if (!data) { cloudMsg('雲端資料格式不正確'); return; }
        // 重新登入同一個班、而這台還有沒上傳的修改：先問要用哪一份
        const old = cloud.session;
        if (old?.expired && old.code === code && hashStr(JSON.stringify(state)) !== old.syncedHash) {
          cloud.session = { url, code, token: r.token, remember, updatedAt: old.updatedAt, syncedHash: old.syncedHash };
          setSession(cloud.session);
          $('#cloudDialog').close();
          openConflict(r.updatedAt, r.data);
          return;
        }
        if (old && old.code !== code) { try { localStorage.removeItem(classKey(old.code)); } catch { /* ignore */ } }
        cloud.session = { url, code, token: r.token, remember, updatedAt: r.updatedAt, syncedHash: '' };
        applyCloudState(data, r.updatedAt);
        toast(`已登入 ${code}`);
      } else {
        const src = $('input[name="clSrc"]:checked')?.value || 'current';
        const newState = src === 'blank' ? defaultState() : JSON.parse(JSON.stringify(state));
        const keep = state;
        state = newState;
        const data = await makeDataCode();
        state = keep;
        const r = await cloudCall('create', { code, key, name: newState.className || '', data }, url);
        if (!r.ok) { cloudMsg(cloudErrText(r)); return; }
        cloud.session = { url, code, token: r.token, remember, updatedAt: r.updatedAt, syncedHash: '' };
        applyCloudState(normalize(newState), r.updatedAt);
        toast(`已建立班級 ${code}，之後會自動存到雲端`);
      }
      $('#cloudDialog').close();
      return;
    }
    if (act === 'drawlink') {
      const sess = cloud.session;
      await cloudSave();
      const r = await cloudCall('drawlink', { code: sess.code, token: sess.token, hours: Number($('#clDrawHours').value) || 24 }, sess.url);
      if (!r.ok) { cloudMsg(r.error === 'action' ? '雲端程式版本太舊，請更新 Code.gs 後重新部署' : cloudErrText(r)); return; }
      const base = location.origin + location.pathname;
      const u = sess.url && sess.url !== DEFAULT_CLOUD_URL ? `&u=${encodeURIComponent(sess.url)}` : '';
      const link = `${base}#draw=${encodeURIComponent(sess.code)}&t=${r.drawToken}${u}`;
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
      const r = await cloudCall('drawrevoke', { code: sess.code, token: sess.token }, sess.url);
      cloudMsg(r.ok ? '✓ 所有抽籤連結都已停用' : cloudErrText(r), !r.ok);
      return;
    }
    if (act === 'sync') { await cloudSave(true); renderCloudDialog(); return; }
    if (act === 'pull') { await cloudPull(); renderCloudDialog(); return; }
    if (act === 'passwd') {
      const np = $('#clNewPass').value, op = $('#clOldPass').value;
      if (!op) { cloudMsg('請輸入目前的密碼'); return; }
      if (np.length < 4) { cloudMsg('新密碼至少 4 個字'); return; }
      const sess = cloud.session;
      const r = await cloudCall('passwd', { code: sess.code, token: sess.token, key: await makeKey(sess.code, op), newKey: await makeKey(sess.code, np) }, sess.url);
      if (!r.ok) { cloudMsg(r.error === 'wrongpass' ? '目前的密碼不對' : cloudErrText(r)); return; }
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
      if (!sess.expired) cloudCall('logout', { code: sess.code, token: sess.token }, sess.url).catch(() => {});
      cloud.session = null;
      setSession(null);
      clearTimeout(cloud.timer);
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
    cloudMsg(err.message && !/fetch|network|JSON/i.test(err.message) ? err.message : '連不上雲端，請檢查網路或雲端網址');
  }
}

function bindCloud() {
  $('#btnCloud').addEventListener('click', () => { renderCloudDialog(); $('#cloudDialog').showModal(); });
  $('#cloudClose').addEventListener('click', () => $('#cloudDialog').close());
  $('#cloudBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cl]');
    if (b) cloudAction(b.dataset.cl);
  });
  $('#cloudBody').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target.id === 'clPass' || e.target.id === 'clCode')) cloudAction('login');
  });
  $('#conflictCloud').addEventListener('click', () => resolveConflict(true));
  $('#conflictLocal').addEventListener('click', () => resolveConflict(false));
  window.addEventListener('online', () => cloudSave());
  // 切回這個分頁時，看看其他裝置有沒有新資料
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') cloudPull({ quiet: false }); });
  renderCloudButton();
  if (cloud.session?.kiosk) startKiosk();
  else if (cloud.session) cloudPull({ quiet: true });
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
    const r = await cloudCall('load', { code: sess.code, token: sess.token }, sess.url || cloudUrl());
    if (!r.ok) { kioskMessage(r.error === 'session' ? CLOUD_ERR.kiosk : cloudErrText(r)); return; }
    const data = normalize(await readDataCode(r.data));
    if (!data) { kioskMessage('雲端資料格式不正確'); return; }
    data.tab = 'seats';
    applyCloudState(data, r.updatedAt);
    $('#kioskCover').hidden = true;
    setBigScreen(true);
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
    html = `<p class="hint">每按一次「📌 記住這次座位」就會存一筆在這裡（存在這台裝置的瀏覽器，最多 ${MAX_RECORDS} 次；用「💾 備份／搬移」可以帶到其他裝置）。排座條件「🔁 換位子」會參考最近 ${prevN()} 次。</p>`
      + (recs.length ? recs.map((r, i) => {
        const { seats, assign } = recordToSeats(r);
        const label = i === 0 ? '最近一次' : `前 ${i + 1} 次`;
        return `<div class="rec-item">
          <img class="rec-thumb" src="${thumb(seats, assign, `${label}的座位`, fmtTime(r.at))}" alt="" data-rec-zoom="${i}">
          <div class="rec-info"><b>${label}</b><span class="hint">${fmtTime(r.at)}・${Object.keys(r.seats).length} 人</span>
            <div class="rec-actions"><button class="btn small" data-rec-zoom="${i}">放大看</button><button class="btn small" data-rec-apply="${i}">套用到座位表</button><button class="link-btn" data-rec-del="${i}">刪除</button></div></div>
        </div>`;
      }).join('') : '<p class="empty-note">還沒有紀錄。座位排好或抽完籤後，按工具列的「📌 記住這次座位」。</p>');
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
  // 有學生還沒座位時，直接坐進新座位
  const seated = new Set(Object.values(state.assign));
  const waiting = sortedStudents().find((s) => !seated.has(s.id));
  if (waiting) state.assign[seat.id] = waiting.id;
  markDesksEdited();
  save();
  renderSeatsPanel();
}

function deleteDesk(seatId) {
  const sid = state.assign[seatId];
  if (sid) {
    const empty = seatOrder(state.seats).find((s) => s.id !== seatId && !state.assign[s.id]);
    if (!empty) { toast('座位不能少於學生人數；請先新增空位或減少人數'); return; }
    pushHistory();
    state.assign[empty.id] = sid;
    toast(`${studentById(sid)?.name || '學生'} 已移到空位`);
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
  $('#bigDraw').addEventListener('click', () => {
    if (document.body.classList.contains('kiosk') && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    startDraw();
  });
  $('#btnBig').addEventListener('click', () => setBigScreen(true));
  $('#btnRemember').addEventListener('click', rememberSeating);
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
  $('#btnRandom').addEventListener('click', () => { askClearUsedFixed(); pushHistory(); optimize(false); save(); renderSeatsPanel(); toast('已隨機排座（鎖定的座位不變）'); });
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
  room.addEventListener('dblclick', (e) => {
    if (!canEditDesks() || e.target.closest('.desk')) return;
    const r = room.getBoundingClientRect();
    const vx = (e.clientX - r.left) / ui.scale - DESK_W / 2;
    const vy = (e.clientY - r.top) / ui.scale - DESK_H / 2;
    const p = fromView(vx, vy);
    addDeskAt(p.x, p.y);
  });

  let drag = null;
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
    if (!d.moved) {
      const sid = state.assign[d.seatId];
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
      if (target && target !== d.desk) {
        swapSeats(d.seatId, target.dataset.seat);
      } else if (!target && hit?.closest('#room')) {
        // 拖到空白處：整個座位（連同學生）移過去
        const r = room.getBoundingClientRect();
        const p = fromView((e.clientX - d.ox - r.left) / ui.scale, (e.clientY - d.oy - r.top) / ui.scale);
        const seat = state.seats.find((s) => s.id === d.seatId);
        pushHistory();
        seat.x = p.x;
        seat.y = p.y;
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
