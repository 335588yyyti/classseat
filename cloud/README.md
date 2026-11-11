# 雲端設定（Firebase）

設定一次之後，所有老師打開座位網頁，就能用「班級代碼＋老師密碼」建立或登入班級：

- 每個班級是 Firestore 裡的一份文件（`classseat_classes/班級代碼`）
- 登入用 Firebase Authentication（帳號是 `班級代碼@classseat.local`，老師看不到也不用管）
- 修改會自動存到雲端，在任何電腦、手機登入同一個班級都是同一份資料
- 「抽籤專用連結」存在 `classseat_draws`，學校大屏點開連結就是抽籤畫面

可以用一個新的 Firebase 專案，也可以和其他系統（例如作業系統）共用同一個專案；座位系統只會用到 `classseat_` 開頭的三個集合，不會動到其他資料。

## 設定步驟（約 10 分鐘，只要做一次）

1. **打開 Firebase 主控台**
   <https://console.firebase.google.com/> → 選現有專案，或「新增專案」。

2. **開啟「電子郵件／密碼」登入**
   左側「Authentication」→「Sign-in method」→「電子郵件／密碼」→ 啟用 → 儲存。
   （如果專案原本就已經開啟，不用再動。）

3. **建立 Firestore 資料庫**（已經有就跳過）
   左側「Firestore Database」→「建立資料庫」→ 選離台灣近的位置（例如 `asia-east1`）→「以正式版模式啟動」。

4. **貼上安全規則**
   「Firestore Database」→「規則」分頁，把本資料夾 [`firestore.rules`](firestore.rules) 的內容貼上 →「發布」。
   - 如果這個專案已經有其他系統的規則，請只把裡面 `match /classseat_classes/...` 和 `match /classseat_draws/...` 兩段**加進**原本的 `match /databases/{database}/documents { ... }` 裡面，不要整份取代。

5. **授權網址**
   「Authentication」→「Settings」→「授權網域」→ 確認有 `335588yyyti.github.io`（沒有就「新增網域」）。

6. **取得網頁設定**
   左上角齒輪「專案設定」→「一般」→ 下方「你的應用程式」：
   - 如果還沒有網頁應用程式，按 `</>` 新增一個（名稱隨便，例如 classseat，**不用**勾 Firebase Hosting）
   - 複製 `firebaseConfig` 那一段，例如：
     ```js
     const firebaseConfig = {
       apiKey: "AIza……",
       authDomain: "你的專案.firebaseapp.com",
       projectId: "你的專案",
       storageBucket: "……",
       messagingSenderId: "……",
       appId: "1:……:web:……"
     };
     ```
   這些設定是公開的網頁設定（不是密碼），可以放在網頁程式裡；真正保護資料的是第 4 步的安全規則。

7. **把設定交給開發者（或自己貼）**
   貼到 `app.js` 最上面附近的 `const FIREBASE_CONFIG = null;`，改成
   `const FIREBASE_CONFIG = { apiKey: "AIza……", authDomain: "……", projectId: "……", appId: "……" };`
   上線後，左上角就會出現「☁️ 雲端」按鈕。

## 常見問題

- **免費嗎？** Firebase 免費方案（Spark）每天有 5 萬次讀取、2 萬次寫入，一個班一天通常只用到幾百次，幾十個班都夠用。
- **老師忘記密碼？** Firebase 主控台 →「Authentication」→「使用者」找到 `班級代碼@classseat.local` → 可以刪除帳號（班級資料在 Firestore 裡，管理者可以另外處理），或請老師用網頁上的備份重新建立班級。
- **班級代碼可以用中文嗎？** 不行，只能用英文字母、數字、`-`、`_`（2～20 個字），例如 `302`、`class-3b`。大小寫視為相同。
- **密碼錯太多次？** Firebase 會自動暫時擋住，過幾分鐘再試。
- **誰看得到資料？** 只有知道班級代碼和老師密碼的人，以及 Firebase 專案的管理者（你）。抽籤連結在期限內，知道連結的人能讀取那個班級的資料，請只傳給自己。
