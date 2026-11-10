# 雲端後端規格（自己架後端用）

座位網頁只透過「一個網址」和後端溝通。照這份規格做好後端，把網址填到網頁（`app.js` 的 `DEFAULT_CLOUD_URL`，或網頁「☁️ 雲端 → 雲端網址設定」），就能使用班級代碼＋老師密碼、自動同步、抽籤專用連結等功能。

`cloud/Code.gs` 是同一份規格的完整範例（Google Apps Script 版），可以對照著寫。

## 連線方式

| 項目 | 規定 |
|---|---|
| 網址 | 任一個 https 網址，例如 `https://你的網域/classseat/api` |
| 測試連線 | `GET 網址` → 回傳 `{"ok":true,"app":"classseat","version":3}` |
| 所有動作 | `POST 網址`，body 是 JSON 文字 |
| Content-Type | 網頁送出時是 `text/plain;charset=UTF-8`（故意不用 `application/json`，避免瀏覽器先送 OPTIONS 預檢）。後端請直接把 body 當 JSON 解析 |
| CORS | 回應必須帶 `Access-Control-Allow-Origin: *`（或座位網頁的網址，例如 `https://335588yyyti.github.io`） |
| 回應 | 一律 HTTP 200 + JSON：成功 `{"ok":true, ...}`，失敗 `{"ok":false,"error":"錯誤代碼"}` |

## 資料欄位

每個班級一筆，至少要存：

| 欄位 | 說明 |
|---|---|
| `code` | 班級代碼，2～20 個非空白字元，**當文字存**（`0302` 不能變 `302`） |
| `name` | 班級名稱（顯示用，可不存） |
| `passHash`、`salt` | 由網頁送來的 `key` 再加鹽雜湊後存（例如 `sha256(salt + ":" + key)`）；**不要存 key 本身** |
| `updatedAt` | 最後存檔時間（毫秒），每次存檔都要變大 |
| `data` | 班級資料，網頁壓縮後的一長串文字（以 `CLASSSEAT1:` 開頭，一般幾千字，請至少支援 20 萬字），後端不需要解讀 |
| 登入憑證 | 老師裝置的憑證（只存雜湊），每班最多保留約 10 個 |
| 抽籤憑證 | 抽籤專用連結的憑證（只存雜湊）＋到期時間 |
| 錯誤次數、鎖定到 | 防止亂猜密碼 |

`key` 是網頁算好的 `SHA-256("classseat|" + 班級代碼 + "|" + 老師密碼)`（64 字的十六進位），後端收不到明碼密碼。

## 動作（POST body 的 `action`）

所有請求都帶 `code`。

### 不用登入
| action | 送出 | 成功回傳 | 說明 |
|---|---|---|---|
| `create` | `key`, `name`, `data` | `token`, `updatedAt` | 建立班級；代碼已存在回 `exists` |
| `login` | `key` | `token`, `data`, `updatedAt`, `name` | 密碼正確時發一組新的登入憑證 |

密碼錯誤回 `{"error":"wrongpass","left":剩幾次}`；連錯 5 次後 10 分鐘內所有 `login` 都回 `{"error":"locked","until":時間}`。**鎖定只擋 `login`，用憑證的請求照常處理**（避免學生亂猜就讓老師的裝置不能用）。

### 用憑證（`token`）
憑證可以是「老師憑證」或「抽籤憑證」。找不到、或抽籤憑證已過期 → `{"error":"session"}`。

| action | 誰可以用 | 送出 | 成功回傳 | 說明 |
|---|---|---|---|---|
| `load` | 老師、抽籤 | — | `data`, `updatedAt`, `name`, `role`（`teacher`／`draw`） | 讀取班級資料 |
| `save` | 老師、抽籤 | `data`, `base`, `name`(可省略), `force`(可省略) | `updatedAt` | 存檔。若 `force` 不是 true，且伺服器上的 `updatedAt` 大於 `base`，回 `{"error":"conflict","updatedAt":伺服器時間}`，不要存 |
| `passwd` | 老師 | `key`（目前密碼）, `newKey` | — | `key` 不對回 `wrongpass`。成功後**只保留這一個老師憑證**，其他裝置與所有抽籤連結都失效 |
| `logout` | 老師 | — | — | 刪除這個憑證 |
| `drawlink` | 老師 | `hours`（1～168） | `drawToken`, `expiresAt` | 產生抽籤專用連結的憑證 |
| `drawrevoke` | 老師 | — | — | 刪除所有抽籤憑證 |

抽籤憑證呼叫 `passwd`／`logout`／`drawlink`／`drawrevoke` 時回 `{"error":"action"}`。

### 錯誤代碼一覽
`code`（代碼格式不對）、`key`、`exists`、`notfound`、`wrongpass`、`locked`、`session`、`conflict`、`toolarge`、`action`、`server`。

## 抽籤專用連結格式（網頁自己組，不用後端處理）

```
https://335588yyyti.github.io/classseat/#draw=班級代碼&t=抽籤憑證&u=後端網址(網址編碼，可省略)
```

網頁打開後會立刻把網址列上的 `#…` 拿掉，憑證只存在那個分頁。

## 安全建議

- 全程 https。
- 憑證用足夠長的亂數（例如兩個 UUID），只存雜湊。
- 同一時間同一班的寫入要排隊（例如資料庫交易或鎖），避免兩台同時存檔互相蓋掉。
- 班級資料裡含有老師的暗中安排，不要提供「列出所有班級」之類的公開 API。
