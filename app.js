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
    layout: { type: 'rows', cols: 6, paired: true, groups: 6 },
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

const ui = { expanded: new Set(), selected: null, scale: 1, history: [] };

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function pushHistory() {
  ui.history.push(JSON.stringify({ seats: state.seats, assign: state.assign, locked: state.locked, layout: state.layout, custom: state.custom }));
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
      for (let k = 0; k < size; k++) {
        add(gx0 + (k % 2) * (DESK_W + 4), gy0 + Math.floor(k / 2) * (DESK_H + 4), 'G' + (g + 1));
      }
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
  const isGroups = state.layout.type === 'groups';
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
  $$('#layoutSeg button').forEach((b) => b.classList.toggle('active', b.dataset.layout === state.layout.type));
  $$('#modeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
  $('#editTools').hidden = state.mode !== 'move';
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
  } else {
    html = `<span class="hint">${n > 24 ? '內外雙層 ㄇ 字型' : '單層 ㄇ 字型'}，開口朝向講台</span>`;
  }
  $('#layoutOpts').innerHTML = html;
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
  const W = b.maxX - b.minX + DESK_W + pad * 2;
  const H = b.maxY - b.minY + DESK_H + pad * 2 + PODIUM_SPACE;
  room.style.width = W + 'px';
  room.style.height = H + 'px';
  room.classList.toggle('move-mode', state.mode === 'move');

  const ev = evaluate();
  const lockedSet = new Set(state.locked);
  const sel = ui.selected ? studentById(ui.selected) : null;
  const bad = new Set(sel ? [...sel.avoidAdj, ...sel.avoidGroup] : []);
  const good = new Set(sel ? sel.preferGroup : []);

  const pw = Math.min(260, W - 40);
  const podiumY = state.flipped ? H - pad - 40 : pad - 10;
  let html = `<div class="podium" style="left:${(W - pw) / 2}px;top:${podiumY}px;width:${pw}px">講 台</div>`;

  if (state.layout.type === 'groups') {
    const groups = {};
    state.seats.forEach((s) => {
      if (!s.group) return;
      const v = toView(s.x, s.y, b, pad);
      const g = groups[s.group] || (groups[s.group] = { x: Infinity, y: Infinity, maxY: -Infinity });
      g.x = Math.min(g.x, v.x); g.y = Math.min(g.y, v.y); g.maxY = Math.max(g.maxY, v.y);
    });
    for (const [k, g] of Object.entries(groups)) {
      const y = state.flipped ? g.maxY + DESK_H + 3 : g.y - 18;
      html += `<div class="group-label" style="left:${g.x}px;top:${y}px">第 ${k.slice(1)} 組</div>`;
    }
  }

  for (const seat of state.seats) {
    const v = toView(seat.x, seat.y, b, pad);
    const st = studentById(state.assign[seat.id]);
    const cls = ['desk'];
    if (!st) cls.push('empty');
    else {
      if (st.gender) cls.push('g-' + st.gender);
      if (lockedSet.has(st.id)) cls.push('locked');
      if (ev.errSeats.has(seat.id)) cls.push('conflict');
      else if (ev.warnSeats.has(seat.id)) cls.push('warnd');
      if (sel && st.id === sel.id) cls.push('selected');
      else if (bad.has(st.id)) cls.push('rel-bad');
      else if (good.has(st.id)) cls.push('rel-good');
    }
    let inner;
    if (st) {
      const tags = st.tags.map((tid) => { const t = tagById(tid); return t ? `<span class="d-tag" style="background:${tagColor(tid)}" title="${esc(t.name)}">${esc(t.name.slice(0, 1))}</span>` : ''; }).join('');
      inner = `<div class="d-top"><span class="d-no">${esc(st.no)}</span><span class="d-name">${esc(st.name)}</span></div>
        <div class="d-badges">${st.myopia ? '<span title="近視">👓</span>' : ''}${st.height ? `<span>${esc(st.height)}</span>` : ''}${tags}</div>
        <button class="lock" data-lock title="${lockedSet.has(st.id) ? '解除鎖定' : '鎖定此座位'}">${lockedSet.has(st.id) ? '🔒' : '🔓'}</button>`;
    } else {
      inner = `<span>空位</span>${state.mode === 'move' ? '<button class="del" data-del-desk title="刪除這張桌子">×</button>' : ''}`;
    }
    html += `<div class="${cls.join(' ')}" data-seat="${seat.id}" style="left:${v.x}px;top:${v.y}px">${inner}</div>`;
  }
  room.innerHTML = html;
  fitRoom();

  const empties = state.seats.length - Object.keys(state.assign).length;
  $('#roomHint').textContent = (state.mode === 'swap'
    ? '拖曳學生到另一個座位即可互換位置；點一下學生可查看條件，點 🔓 可鎖定座位。'
    : '拖曳桌子可自由調整位置；可新增或刪除空桌。') + `　（${state.seats.length} 個座位、${empties} 個空位）`;

  renderChecks(ev);
  renderSelInfo();
  $('#printTitle').textContent = `${state.className || ''} 座位表`.trim();
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
  if (!s) { box.innerHTML = '<p class="hint">點一下座位上的學生，可查看他的條件與關係。</p>'; return; }
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
  </dl><p class="hint">橘框：不可相鄰／同組的對象；綠框：盡量同組的對象。</p>`;
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
    const t = e.target.closest('[data-layout]')?.dataset.layout;
    if (!t || (t === state.layout.type && !state.custom)) return;
    changeLayout((L) => { L.type = t; });
    toast(`已切換為${LAYOUT_LABEL[t]}，可按「依條件自動排座」重新安排`);
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
    pushHistory();
    const b = roomBounds();
    const last = state.seats.filter((s) => s.y === b.maxY);
    const x = last.length ? Math.max(...last.map((s) => s.x)) + DESK_W + 14 : b.minX;
    state.seats.push({ id: uid(), x, y: b.maxY, group: null });
    state.custom = true;
    save(); renderSeatsPanel();
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
      if (state.assign[desk.dataset.seat]) return;
      pushHistory();
      state.seats = state.seats.filter((s) => s.id !== desk.dataset.seat);
      state.custom = true;
      save(); renderSeatsPanel();
    }
  });

  let drag = null;
  room.addEventListener('pointerdown', (e) => {
    const desk = e.target.closest('.desk');
    if (!desk || e.button > 0 || e.target.closest('button')) return;
    const seatId = desk.dataset.seat;
    if (state.mode === 'swap' && !state.assign[seatId]) return;
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
      if (sid && e.type === 'pointerup') { ui.selected = ui.selected === sid ? null : sid; renderRoom(); }
      return;
    }
    if (state.mode === 'swap') {
      d.ghost.remove();
      d.desk.classList.remove('dragging');
      const target = e.type === 'pointerup' ? document.elementFromPoint(e.clientX, e.clientY)?.closest('#room .desk') : null;
      $$('#room .drop-target').forEach((x) => x.classList.remove('drop-target'));
      if (target && target !== d.desk) swapSeats(d.seatId, target.dataset.seat);
    } else {
      let dx = (e.clientX - d.sx) / ui.scale, dy = (e.clientY - d.sy) / ui.scale;
      if (state.flipped) { dx = -dx; dy = -dy; }
      const seat = state.seats.find((s) => s.id === d.seatId);
      pushHistory();
      seat.x = Math.round((seat.x + dx) / 8) * 8;
      seat.y = Math.round((seat.y + dy) / 8) * 8;
      state.custom = true;
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
      ui.history = []; ui.selected = null; ui.expanded.clear();
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
    ui.history = []; ui.selected = null; ui.expanded.clear();
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
