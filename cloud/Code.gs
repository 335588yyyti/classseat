/**
 * 教室座位安排 — 雲端存檔（Google Apps Script）
 *
 * 每個班級是試算表「classes」工作表裡的一列：
 *   班級代碼｜班級名稱｜密碼雜湊｜鹽｜更新時間｜錯誤次數｜鎖定到｜登入憑證｜資料1…資料5
 * 資料是網頁壓縮後的文字；密碼在網頁端先雜湊，這裡再加鹽雜湊一次後才存。
 * 登入成功會發一組「登入憑證」給那台裝置，之後用憑證存取，不必再傳密碼；
 * 密碼錯太多次只會擋「新的登入」，已經登入的裝置不受影響。
 *
 * 設定方式請看同一個資料夾的 README.md。
 */

const SHEET_NAME = 'classes';
const CHUNK = 45000;     // 一格最多 5 萬字，保守切成 4.5 萬字一段
const MAX_CHUNKS = 5;    // 每班最多約 22 萬字（一般一個班只要幾千字）
const MAX_FAILS = 5;     // 密碼連續錯 5 次…
const LOCK_MS = 10 * 60 * 1000; // …新的登入要等 10 分鐘
const MAX_TOKENS = 10;   // 每班最多同時登入 10 台裝置（最舊的會被登出）
const COL = { code: 1, name: 2, hash: 3, salt: 4, updated: 5, fails: 6, lock: 7, tokens: 8, data: 9 };
const WIDTH = COL.data - 1 + MAX_CHUNKS;

function doGet() {
  return out_({ ok: true, app: 'classseat', version: 2 });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const req = JSON.parse(e.postData.contents);
    const code = String(req.code || '').trim();
    if (!/^\S{2,20}$/.test(code)) return out_({ ok: false, error: 'code' });

    const sh = sheet_();
    const row = findRow_(sh, code);
    const now = Date.now();

    if (req.action === 'create') {
      const key = String(req.key || '');
      if (key.length < 32) return out_({ ok: false, error: 'key' });
      if (row > 0) return out_({ ok: false, error: 'exists' });
      const chunks = split_(String(req.data || ''));
      if (!chunks) return out_({ ok: false, error: 'toolarge' });
      const salt = Utilities.getUuid();
      const token = newToken_();
      sh.appendRow(['~' + code, String(req.name || '').slice(0, 50), hash_(key, salt), salt, now, 0, 0, JSON.stringify([hash_(token, 'token')])].concat(chunks));
      return out_({ ok: true, updatedAt: now, token: token });
    }

    if (row < 0) return out_({ ok: false, error: 'notfound' });
    const r = sh.getRange(row, 1, 1, WIDTH).getValues()[0];
    const tokens = parseTokens_(r[COL.tokens - 1]);

    // 已登入的裝置：用登入憑證
    if (req.token) {
      const th = hash_(String(req.token), 'token');
      if (tokens.indexOf(th) < 0) return out_({ ok: false, error: 'session' });
      return act_(sh, row, r, req, now, tokens, th);
    }

    // 新的登入：用密碼
    const key = String(req.key || '');
    if (key.length < 32) return out_({ ok: false, error: 'key' });
    if (Number(r[COL.lock - 1]) > now) return out_({ ok: false, error: 'locked', until: Number(r[COL.lock - 1]) });
    if (hash_(key, r[COL.salt - 1]) !== r[COL.hash - 1]) {
      const fails = Number(r[COL.fails - 1]) + 1;
      if (fails >= MAX_FAILS) sh.getRange(row, COL.fails, 1, 2).setValues([[0, now + LOCK_MS]]);
      else sh.getRange(row, COL.fails).setValue(fails);
      return out_({ ok: false, error: 'wrongpass', left: Math.max(0, MAX_FAILS - fails) });
    }
    if (Number(r[COL.fails - 1])) sh.getRange(row, COL.fails).setValue(0);
    if (req.action !== 'login') return out_({ ok: false, error: 'action' });
    const token = newToken_();
    const th = hash_(token, 'token');
    tokens.push(th);
    sh.getRange(row, COL.tokens).setValue(JSON.stringify(tokens.slice(-MAX_TOKENS)));
    return out_({ ok: true, token: token, name: r[COL.name - 1], updatedAt: Number(r[COL.updated - 1]), data: readData_(r) });
  } catch (err) {
    return out_({ ok: false, error: 'server', message: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** 已登入裝置可以做的事 */
function act_(sh, row, r, req, now, tokens, th) {
  if (req.action === 'load') {
    return out_({ ok: true, name: r[COL.name - 1], updatedAt: Number(r[COL.updated - 1]), data: readData_(r) });
  }
  if (req.action === 'save') {
    const cur = Number(r[COL.updated - 1]);
    if (!req.force && req.base && cur > Number(req.base)) return out_({ ok: false, error: 'conflict', updatedAt: cur });
    const chunks = split_(String(req.data || ''));
    if (!chunks) return out_({ ok: false, error: 'toolarge' });
    const t = Math.max(now, cur + 1);
    if (req.name !== undefined) sh.getRange(row, COL.name).setValue(String(req.name).slice(0, 50));
    sh.getRange(row, COL.updated).setValue(t);
    sh.getRange(row, COL.data, 1, MAX_CHUNKS).setValues([chunks]);
    return out_({ ok: true, updatedAt: t });
  }
  if (req.action === 'passwd') {
    // 改密碼要再輸入一次目前的密碼
    if (hash_(String(req.key || ''), r[COL.salt - 1]) !== r[COL.hash - 1]) return out_({ ok: false, error: 'wrongpass' });
    const newKey = String(req.newKey || '');
    if (newKey.length < 32) return out_({ ok: false, error: 'key' });
    const salt = Utilities.getUuid();
    // 改密碼後，其他裝置全部登出，只留這一台
    sh.getRange(row, COL.hash, 1, 2).setValues([[hash_(newKey, salt), salt]]);
    sh.getRange(row, COL.tokens).setValue(JSON.stringify([th]));
    return out_({ ok: true });
  }
  if (req.action === 'logout') {
    sh.getRange(row, COL.tokens).setValue(JSON.stringify(tokens.filter(function (x) { return x !== th; })));
    return out_({ ok: true });
  }
  return out_({ ok: false, error: 'action' });
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['班級代碼', '班級名稱', '密碼雜湊', '鹽', '更新時間', '錯誤次數', '鎖定到', '登入憑證', '資料1', '資料2', '資料3', '資料4', '資料5']);
    sh.setFrozenRows(1);
  }
  return sh;
}

// 班級代碼前面加「~」存成文字，避免像 0302 被試算表當成數字吃掉 0
function findRow_(sh, code) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return -1;
  const vals = sh.getRange(2, 1, n, 1).getValues();
  for (let i = 0; i < vals.length; i++) if (String(vals[i][0]) === '~' + code) return i + 2;
  return -1;
}

// 每段前面加「~」，避免被當成公式或數字
function split_(data) {
  const chunks = [];
  for (let i = 0; i < data.length; i += CHUNK) chunks.push('~' + data.slice(i, i + CHUNK));
  if (chunks.length > MAX_CHUNKS) return null;
  while (chunks.length < MAX_CHUNKS) chunks.push('');
  return chunks;
}

function readData_(r) {
  return r.slice(COL.data - 1).map(function (c) { return String(c || '').replace(/^~/, ''); }).join('');
}

function parseTokens_(v) {
  try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}

function newToken_() {
  return Utilities.getUuid() + Utilities.getUuid();
}

function hash_(key, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + key, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
