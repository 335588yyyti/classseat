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
    id: uid(), no, name: '學生' + no, gender: '', myopia: false, height: '', note: '',
    tags: [], avoidAdj: [], avoidGroup: [], preferGroup: [], pref: 'any',
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
    },
    layout: { type: 'map', mapId: 'class', cols: 6, paired: true, groups: 6 },
    maps: [{ id: 'class', name: '本班', seats: CLASS_LAYOUT.map((p) => ({ ...p })) }],
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
    const raw = localStorage.getItem(STORE_KEY);
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
  delete s.customLayout;
  delete s.freeLayout;
  s.assign = data.assign && typeof data.assign === 'object' ? data.assign : {};
  s.locked = Array.isArray(data.locked) ? data.locked : [];
  return s;
}

let state = load() || defaultState();
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* 無痕模式等情況 */ }
  }, 200);
}

const ui = { expanded: new Set(), selected: null, selSeat: null, newGroup: 'auto', scale: 1, history: [] };

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function pushHistory() {
  ui.history.push(JSON.stringify({ seats: state.seats, assign: state.assign, locked: state.locked, layout: state.layout, custom: state.custom, maps: state.maps }));
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
  const order = seatOrder(state.seats).map((s) => state.assign[s.id]).filter(Boolean);
  const seen = new Set(order);
  for (const s of sortedStudents()) if (!seen.has(s.id)) order.push(s.id);
  state.seats = generateSeats(state.students.length, state.layout);
  state.assign = {};
  seatOrder(state.seats).forEach((seat, i) => { if (order[i]) state.assign[seat.id] = order[i]; });
  state.custom = false;
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
  return { N, front, adj, adjPairs, rowPairs, isGroups, groupIdx, groupCount: groupKeys.length, sameGroup };
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

  // 身高百分位（矮→0，高→1）
  const withH = studs.map((s, i) => ({ i, h: parseFloat(s.height) })).filter((o) => o.h > 0).sort((a, b) => a.h - b.h);
  const hTarget = new Float64Array(studs.length).fill(-1);
  withH.forEach((o, r) => { hTarget[o.i] = withH.length > 1 ? r / (withH.length - 1) : 0.5; });

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
  });
  const gender = studs.map((s) => s.gender || '');

  function cost(occ, pos) {
    let t = 0;
    const { front, adj, N, sameGroup, adjPairs, rowPairs, isGroups, groupIdx, groupCount } = geo;
    for (let i = 0; i < studs.length; i++) {
      const f = front[pos[i]];
      const p = frontPull[i];
      if (p > 0) t += p * 10 * f;
      else if (p < 0) t += -p * 10 * (1 - f);
      if (wH && hTarget[i] >= 0) t += wH * 10 * Math.abs(f - hTarget[i]);
    }
    for (const [a, b] of avoidAdj) if (adj[pos[a] * N + pos[b]]) t += 1000;
    for (const [a, b] of avoidGroup) if (sameGroup(pos[a], pos[b])) t += 800;
    for (const [a, b] of preferGroup) if (!sameGroup(pos[a], pos[b])) t += 150;

    if (wG && !isGroups) {
      for (const [a, b] of rowPairs) {
        const sa = occ[a], sb = occ[b];
        if (sa < 0 || sb < 0) continue;
        if (gender[sa] && gender[sa] === gender[sb]) t += wG * 8;
      }
    }
    if (spreadTags.length) {
      for (const [a, b] of adjPairs) {
        const sa = occ[a], sb = occ[b];
        if (sa < 0 || sb < 0) continue;
        for (const st of spreadTags) if (st.set.has(sa) && st.set.has(sb)) t += st.w * 25;
      }
    }
    if (isGroups && groupCount && (wG || spreadTags.length)) {
      const m = new Int16Array(groupCount), fe = new Int16Array(groupCount);
      const tagCnt = spreadTags.map(() => new Int16Array(groupCount));
      for (let s = 0; s < occ.length; s++) {
        const st = occ[s], g = groupIdx[s];
        if (st < 0 || g < 0) continue;
        if (gender[st] === 'M') m[g]++;
        else if (gender[st] === 'F') fe[g]++;
        spreadTags.forEach((tg, k) => { if (tg.set.has(st)) tagCnt[k][g]++; });
      }
      for (let g = 0; g < groupCount; g++) {
        if (wG) t += wG * 8 * Math.max(0, Math.abs(m[g] - fe[g]) - 1);
        spreadTags.forEach((tg, k) => { if (tagCnt[k][g] > 1) t += tg.w * 25 * (tagCnt[k][g] - 1); });
      }
    }
    return t;
  }

  return { geo, idx, cost };
}

function optimize(useConditions = true) {
  const seats = state.seats;
  const studs = state.students;
  const N = seats.length;
  const model = buildModel();
  const seatIndex = new Map(seats.map((s, i) => [s.id, i]));
  const locked = new Set(state.locked);

  const baseOcc = new Int32Array(N).fill(-1);
  const fixedSeats = new Set();
  for (const [sid, stid] of Object.entries(state.assign)) {
    if (!locked.has(stid)) continue;
    const si = seatIndex.get(sid), st = model.idx.get(stid);
    if (si === undefined || st === undefined) continue;
    baseOcc[si] = st;
    fixedSeats.add(si);
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

  let best = initial();
  if (useConditions && movable.length > 1) {
    let bestCost = model.cost(best.occ, best.pos);
    const runs = 4, iters = 16000;
    for (let r = 0; r < runs; r++) {
      const { occ, pos } = initial();
      let cur = model.cost(occ, pos);
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
        const nc = model.cost(occ, pos);
        if (nc <= cur || Math.random() < Math.exp((cur - nc) / T)) {
          cur = nc;
          if (cur < bestCost) { bestCost = cur; best = { occ: Int32Array.from(occ), pos: Int32Array.from(pos) }; }
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

  for (const s of state.students) {
    const i = seatIdxOf[s.id];
    if (i === undefined) continue;
    const f = geo.front[i];
    if (s.pref === 'front' && f > 0.5) { items.push({ level: 'warn', text: `${name(s)} 希望坐前排，目前在後半部` }); warnSeats.add(seats[i].id); }
    if (s.pref === 'back' && f < 0.5) { items.push({ level: 'warn', text: `${name(s)} 希望坐後排，目前在前半部` }); warnSeats.add(seats[i].id); }
    if (state.conditions.myopia.on && s.myopia && f > 0.5) { items.push({ level: 'warn', text: `${name(s)} 近視，目前坐在後半部` }); warnSeats.add(seats[i].id); }
    for (const tid of s.tags) {
      const t = tagById(tid);
      if (!t) continue;
      if (t.strategy === 'front' && f > 0.5) { items.push({ level: 'warn', text: `${name(s)}（${t.name}）目前坐在後半部` }); warnSeats.add(seats[i].id); }
      if (t.strategy === 'back' && f < 0.5) { items.push({ level: 'warn', text: `${name(s)}（${t.name}）目前坐在前半部` }); warnSeats.add(seats[i].id); }
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
  items.sort((a, b) => (a.level === 'err' ? 0 : 1) - (b.level === 'err' ? 0 : 1));
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
    ['height', '📏 身高', '矮前高後', '矮的同學坐前面、高的坐後面（需填身高）'],
    ['gender', '⚥ 性別', '男女交錯', '直排／ㄇ字型：左右男女交錯；分組：各組男女人數平均'],
  ];
  $('#builtinConds').innerHTML = defs.map(([k, title, short, desc]) => `
    <div class="cond ${c[k].on ? '' : 'off'}" title="${desc}">
      <label class="cond-text">
        <input type="checkbox" data-cond="${k}" ${c[k].on ? 'checked' : ''}>
        <span class="cond-title">${title}</span>
        <span class="cond-desc">${short}</span>
      </label>
      ${weightSelect(c[k].weight, `data-cond-w="${k}"`)}
    </div>`).join('') + `
    <div class="cond fixed" title="不可相鄰、不可同組最優先；其次是盡量同組與座位偏好（在學生的「規則」中設定）">
      <span class="cond-text"><span class="cond-title">🤝 個人規則</span><span class="cond-desc">一律優先</span></span>
    </div>`;

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
  return s.avoidAdj.length + s.avoidGroup.length + s.preferGroup.length + (s.pref !== 'any' ? 1 : 0) + s.tags.length;
}

function renderTable() {
  const rows = state.students.map((s) => {
    const open = ui.expanded.has(s.id);
    const n = ruleCount(s);
    return `
    <tr class="main-row" data-sid="${s.id}">
      <td class="c-no"><input type="number" min="1" value="${esc(s.no)}" data-f="no" aria-label="座號"></td>
      <td class="c-name"><input type="text" value="${esc(s.name)}" data-f="name" aria-label="姓名"></td>
      <td class="c-gender"><span class="gender">
        <button data-gender="M" class="${s.gender === 'M' ? 'on-M' : ''}">男</button>
        <button data-gender="F" class="${s.gender === 'F' ? 'on-F' : ''}">女</button></span></td>
      <td class="c-myo"><input type="checkbox" class="check" data-f="myopia" ${s.myopia ? 'checked' : ''} aria-label="近視"></td>
      <td class="c-h"><input type="number" min="80" max="220" placeholder="—" value="${esc(s.height)}" data-f="height" aria-label="身高"><span class="unit">cm</span></td>
      <td class="note"><input type="text" value="${esc(s.note)}" placeholder="備註" data-f="note" aria-label="備註"></td>
      <td><button class="btn small rule-btn ${open ? 'open' : ''}" data-toggle-rules>規則${n ? ` <span class="count">${n}</span>` : ''}</button></td>
      <td><button class="link-btn" data-remove ${state.students.length <= MIN_N ? 'disabled title="至少需要 26 人"' : ''}>移除</button></td>
    </tr>
    ${open ? `<tr class="rule-row" data-sid="${s.id}"><td colspan="8">${rulesHtml(s)}</td></tr>` : ''}`;
  });
  $('#stuBody').innerHTML = rows.join('');
}

function relSelect(s, key) {
  const chosen = new Set(s[key]);
  const opts = sortedStudents().filter((o) => o.id !== s.id && !chosen.has(o.id))
    .map((o) => `<option value="${o.id}">${esc(o.no)}. ${esc(o.name)}</option>`).join('');
  const color = key === 'preferGroup' ? 'green' : 'red';
  const chips = s[key].map((id) => {
    const o = studentById(id);
    return o ? `<span class="chip ${color}">${esc(o.no)}. ${esc(o.name)}<button data-unrel="${key}" data-other="${id}" aria-label="移除">×</button></span>` : '';
  }).join('');
  return `<div class="rule-line"><select data-rel="${key}"><option value="">選擇同學…</option>${opts}</select>${chips}</div>`;
}

function rulesHtml(s) {
  const tags = state.tags.length
    ? state.tags.map((t) => {
      const on = s.tags.includes(t.id);
      return `<button class="tag-toggle ${on ? 'on' : ''}" data-tag-toggle="${t.id}" style="${on ? `background:${tagColor(t.id)}` : ''}">${on ? '✓ ' : ''}${esc(t.name)}</button>`;
    }).join('')
    : '<span class="hint">尚未新增自訂條件（可在上方「排座條件」新增）</span>';
  return `<div class="rules">
    <label>不可相鄰</label>${relSelect(s, 'avoidAdj')}
    <label>不可同組</label>${relSelect(s, 'avoidGroup')}
    <label>盡量同組</label>${relSelect(s, 'preferGroup')}
    <label>座位偏好</label><div class="seg small">${Object.entries(PREF_LABEL).map(([k, v]) => `<button data-pref="${k}" class="${s.pref === k ? 'active' : ''}">${v}</button>`).join('')}</div>
    <label>自訂條件</label><div class="rule-line">${tags}</div>
  </div>`;
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
  ui.expanded.delete(id);
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
  const body = $('#stuBody');

  body.addEventListener('input', (e) => {
    const tr = e.target.closest('tr[data-sid]');
    const f = e.target.dataset.f;
    if (!tr || !f || f === 'myopia') return;
    const s = studentById(tr.dataset.sid);
    s[f] = f === 'no' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value;
    save();
  });
  body.addEventListener('change', (e) => {
    const tr = e.target.closest('tr[data-sid]');
    if (!tr) return;
    const s = studentById(tr.dataset.sid);
    if (e.target.dataset.f === 'myopia') { s.myopia = e.target.checked; renderStats(); save(); return; }
    if (e.target.dataset.f === 'name' || e.target.dataset.f === 'no') {
      // 名字／座號改了，刷新其他人規則列中的名字
      $$('tr.rule-row', body).forEach((r) => { r.firstElementChild.innerHTML = rulesHtml(studentById(r.dataset.sid)); });
      return;
    }
    const rel = e.target.dataset.rel;
    if (rel && e.target.value) {
      setRelation(s.id, e.target.value, rel, true);
      renderTable(); renderStats(); save();
    }
  });
  body.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-sid]');
    if (!tr) return;
    const s = studentById(tr.dataset.sid);
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.gender) {
      s.gender = s.gender === btn.dataset.gender ? '' : btn.dataset.gender;
      $$('[data-gender]', tr).forEach((b) => { b.className = s.gender === b.dataset.gender ? 'on-' + s.gender : ''; });
      renderStats(); save();
    } else if ('toggleRules' in btn.dataset) {
      ui.expanded.has(s.id) ? ui.expanded.delete(s.id) : ui.expanded.add(s.id);
      renderTable();
    } else if ('remove' in btn.dataset) {
      if (confirm(`確定移除「${s.name}」？`)) removeStudent(s.id);
    } else if (btn.dataset.unrel) {
      setRelation(s.id, btn.dataset.other, btn.dataset.unrel, false);
      renderTable(); renderStats(); save();
    } else if (btn.dataset.pref) {
      s.pref = btn.dataset.pref;
      renderTable(); save();
    } else if (btn.dataset.tagToggle) {
      const t = btn.dataset.tagToggle;
      s.tags = s.tags.includes(t) ? s.tags.filter((x) => x !== t) : [...s.tags, t];
      renderTable(); renderConditions(); save();
    }
  });

  $('#builtinConds').addEventListener('change', (e) => {
    const k = e.target.dataset.cond, kw = e.target.dataset.condW;
    if (k) state.conditions[k].on = e.target.checked;
    if (kw) state.conditions[kw].weight = Number(e.target.value);
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
        else rest.push(tk);
      }
      if (rest.length) st.name = rest.join(' ');
      return st;
    });
    while (list.length < MIN_N) list.push(newStudent(list.length + 1));
    state.students = list;
    state.assign = {};
    state.locked = [];
    ui.expanded.clear();
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
  renderLayoutOpts();
  renderRoom();
  renderLegend();
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
      <span class="hint">${m?.seats.length || 0} 個座位；可新增、刪除、拖動座位，會自動記住</span>`;
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

  for (const seat of state.seats) {
    const v = toView(seat.x, seat.y, b, pad);
    const st = studentById(state.assign[seat.id]);
    const cls = ['desk'];
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
      const badges = `${st.myopia ? '<span title="近視">👓</span>' : ''}${st.height ? `<span>${esc(st.height)}</span>` : ''}${tags}`;
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

/* ---------- 組別 ---------- */
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
  ui.scale = Math.min(1, avail / W);
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
  const head = `<div class="hint">${errs ? `${errs} 項必須修正` : '沒有違反必要規則'}，${ev.items.length - errs} 項建議調整</div>`;
  box.innerHTML = head + ev.items.map((i) => `<div class="check-item ${i.level}">${i.level === 'err' ? '✗ ' : '△ '}${esc(i.text)}</div>`).join('');
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
    <dt>近視／身高</dt><dd>${s.myopia ? '近視' : '—'}／${s.height ? esc(s.height) + ' cm' : '—'}</dd>
    <dt>座位偏好</dt><dd>${PREF_LABEL[s.pref]}</dd>
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
  $('#layoutOpts').addEventListener('click', (e) => {
    if (e.target.closest('[data-save-custom]')) openMapDialog('copy');
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
  $('#btnRandom').addEventListener('click', () => { pushHistory(); optimize(false); save(); renderSeatsPanel(); toast('已隨機排座（鎖定的座位不變）'); });
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
    if (!desk || e.button > 0 || e.target.closest('button')) return;
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

  $('#btnExport').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${state.className || '班級'}-座位資料.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#fileImport').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = normalize(JSON.parse(await f.text()));
      if (!data) throw new Error('bad');
      if (data.students.length < MIN_N || data.students.length > MAX_N) throw new Error('count');
      state = data;
      ui.history = []; ui.selected = null; ui.selSeat = null; ui.expanded.clear();
      cn.value = state.className || '';
      ensureSeating();
      showTab(state.tab);
      toast('已匯入資料');
    } catch (err) {
      toast(err.message === 'count' ? `匯入失敗：人數需介於 ${MIN_N}～${MAX_N}` : '匯入失敗：檔案格式不正確');
    }
  });
  $('#btnReset').addEventListener('click', () => {
    if (!confirm('確定清除所有學生、條件與座位資料，回到預設狀態？')) return;
    state = defaultState();
    ui.history = []; ui.selected = null; ui.selSeat = null; ui.expanded.clear();
    cn.value = '';
    ensureSeating();
    showTab('students');
  });
}

bindGlobal();
bindStudentsPanel();
bindSeatsPanel();
ensureSeating();
showTab(state.tab === 'seats' ? 'seats' : 'students');
