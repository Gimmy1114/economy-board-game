# AGENTS.md

## 專案目的

維持「經濟棋局」原有的多人財經桌遊玩法，以小步驟加入新功能。目前的功能是「多裝置房間」：不同裝置用代碼加入同一局（見下方「目前進度」）。

## 專案結構

- `data.js`、`engine.js`、`sync.js`、`room.js`、`app.js` 是來源檔；`game.js` 由它們合併產生，`index.html` 實際載入的是 `game.js`。
- 修改來源檔後，必須執行 `node build.mjs` 更新 `game.js`，兩者要一起提交。`build.mjs` 也會改 `index.html`：用 `game.js` 加 `styles.css` 的內容雜湊（8 碼）蓋上 `game.js?v=…`、`styles.css?v=…` 和頁尾 `#app-version`，所以 `index.html` 也要一起提交。
- 測試以 `node --test` 執行（`engine.test.js`、`sync.test.js`、`room.test.js`）。
- 這台電腦沒有 Node.js：建置改用 `python _harness/build.py . game.js`（與 `build.mjs` 輸出逐位元組相同，已用 HEAD 版 `game.js` 驗證）。**注意（2026-10-21）**：`build.mjs` 現在還會在 `index.html` 蓋版本號，`_harness/build.py` 要照著加上同樣的步驟，否則版本號不會更新（遊戲仍能用，但手機可能拿到舊快取）；測試用 `python -m http.server 4173` 後開 `http://127.0.0.1:4173/_harness/tests.html`。`_harness/` 已列在 `.git/info/exclude`，不會被提交。

## 修改規則

- 修改前先指出涉及的檔案及計畫。
- 優先保留原有結構，避免無關的大規模重構。
- 新增功能需有可操作的驗證方式，並補上對應的測試。
- 修改 UI 時保留基本的行動裝置可用性。
- 不建立或提交 API Key、密碼、個資或 .env 等敏感檔案。
- 每完成一個功能，摘要修改範圍與測試結果。

## 工作方式（使用者要求）

- 使用者回答設計問題不等於同意開工；要等使用者明確說「做」才動手改檔。
- 使用者明確要求時才 commit / push。

## 分支與協作（2026-10-21 使用者決定）

```
main（原作品，作業 PR 的 base，不動）
  └─ feature/my-improvement（目前成果，GitHub Pages 從這裡部署）
       ├─ feature/merger（併吞系統）
       └─ feature/<其他功能>
```

- `main`：不要改，也不要把任何分支合併或快轉進去（原因見下方「線上展示」）。
- `feature/my-improvement`：已完成、驗證過的成果。push 到這裡就會更新線上網站，所以只放測過的東西。
- 新功能：從 `feature/my-improvement` 開分支，不要從 `main` 開（`main` 沒有房間功能），命名 `feature/<功能名>`。完成後開 PR，**base 選 `feature/my-improvement`**，使用者看過差異再合併。
- 沒有這個 Repo 寫入權限的人：先 Fork `soymilk0211/bigdata-week7`，在自己的 Fork 開分支，再開 PR 到這個 Repo 的 `feature/my-improvement`。
- 合併前的多裝置測試：網站只部署 `feature/my-improvement`，新分支不會自動上線。要用多支手機測時，在自己的 Fork 開 GitHub Pages，指向自己的分支，就有自己的測試網址。`node serve.mjs` 只監聽 `127.0.0.1`，只能在同一台電腦開頁籤測試。
- 同一個房間的人要開同一個網址，用邀請連結最保險。所有網站版本共用 PeerJS 公用伺服器和同一個房間代碼前綴，不同版本的頁面也可能連進同一個房間，但遊戲狀態可能不相容。之後如果改了房間訊息或 `state` 的格式（例如併吞系統），要把 `room.js` 的 `ROOM_PREFIX` 版本號往上加（目前是 `econboard-v2-`，下次改成 `econboard-v3-`），讓新舊版本進不了同一個房間。
- `claude/room-connection-timeout-l24xbb` 是 Claude Code 工作用的分支，內容和 `feature/my-improvement` 相同，其他人不用理它。
- 協作說明只寫在 AGENTS.md，README 不放（使用者決定，2026-10-21）。
- 權限：協作者由使用者在 GitHub 的 Settings → Collaborators 加入；沒有權限的人用 Fork。AI 助手不能也不要替使用者改 Repo 設定。
- 分工：開工前要先說明要做的功能和會改的檔案，避免多人同時大改 `app.js`。
- 送 PR 前：跑 `node build.mjs`（`game.js`、`index.html` 和來源檔一起提交）和 `node --test`（全過）；PR 說明要寫改了什麼、怎麼測的。動到多人連線就要用兩台裝置（或兩個瀏覽器視窗）實際走一次「建房 → 選企業 → 開始 → 玩完一季」，並確認遊戲狀態在每一步都還在（不要只檢查 `phase`，`state` 變成 `null` 時也會通過）。
- 審查 PR：使用者可以把 PR 連結交給 Claude Code 看差異、跑測試，但合併由使用者自己決定。

給測試者的步驟（線上網址 <https://soymilk0211.github.io/bigdata-week7/>）：詳細步驟和常見問題寫在 README 的「怎麼玩（詳細步驟）」。重點：
1. 每個人用自己的裝置打開網址；同一支手機開兩個頁籤不行。
2. 房主在首頁按「多人連線（每人一台）」→「建立房間」→「複製邀請連結」傳給大家，不用先設定玩家。大家頁尾的「版本」要一樣。
3. 每個人（包括房主）在房間視窗輸入名字、點一家企業；別人選走的會變灰。
4. 房主滿 2 位就能按「開始遊戲」；開始後每台裝置自動對應自己選的企業。房主頁面要開在最前面。

## 目前進度（2026-10-21）

### 線上展示
- GitHub Pages：<https://soymilk0211.github.io/bigdata-week7/>，由使用者在 GitHub 設定為「Deploy from a branch → `feature/my-improvement` / (root)」。每次 push 到這個分支都會自動重新部署（約 1～2 分鐘）。
- **不要把 `feature/my-improvement` 合併或快轉進 `main`**（2026-10-21 使用者要求）。作業單（`docs/GitHub-Codex-作業單.docx`）的流程是：在功能分支完成，再開 Pull Request（base：自己的 `main`），用 PR 展示兩條分支的差異；合併由使用者在 PR 上自己決定。曾經誤快轉一次，已用 `--force-with-lease` 把 `main` 退回 `ca0f691`。
- `main` 只有原作品，加上使用者要求的一個 commit（`ca0f691`，README 開頭的「線上直接玩」連結）；房間功能只在功能分支。GitHub Pages 從 `feature/my-improvement` 部署。
- 這台電腦沒有 `gh`，內建瀏覽器也沒登入 GitHub；Repo 設定只能請使用者自己改。

### 多裝置房間（用代碼加入）— 已可使用
使用者已決定：
- 連線用 **WebRTC 點對點（PeerJS）**，房主瀏覽器是唯一權威主機，可部署在 GitHub Pages。
- **每台裝置只控制自己認領的玩家**。
- （2026-10-21 改）**每位玩家都要有一台裝置**，房主也只是其中一位玩家；原本「沒人認領的座位由房主操作」已取消，沒有裝置的人改用單機模式。
- （2026-10-21 再改，使用者覺得比較直觀）**開房間時不用先設定玩家**：開始前房間是「大廳」，每台裝置自己輸入名字、選一家企業（一家只能一台），開始前可以換或退出；房主滿 2 位就能隨時開始，最多 8 位，沒選的裝置只能觀看。開始時每台裝置自動坐在自己選的企業，不用再選座位。
- （2026-10-21）**開始後座位鎖定**，裝置不能自己換位子或離開座位；有人離開由房主按「收回」（`releaseSeat`），另一台裝置按「坐這裡」接手（`claimSeat`，會先確認）。座位清單只用在這種接手的情況（第八段之後，房間不會再開在既有對局上）。
- （2026-10-21，使用者覺得混用）**單機和多人連線是兩個分開的模式**：首頁兩個入口（「一台裝置輪流玩」「多人連線（每人一台）」），上方按鈕改名「多人連線」。多人連線一律從空白大廳開始，不會把這台裝置的單機對局帶進房間；房主的房間對局不寫 `localStorage`、不跟其他頁籤同步；離開／關閉房間後重新載入回到單機模式，單機存檔不受影響。多人對局本身不存檔（房主可匯出）。
- （2026-10-21，與其他人討論後）**房間模式下玩家區只顯示自己的完整資料**，其他玩家只出現在「淨資產排行」（名次、玩家、公司、淨資產）。單機模式照舊顯示全部。只是不顯示，資料仍會傳到每台裝置。棋盤中央和回合面板仍會顯示目前回合玩家的內容（使用者沒有要求隱藏）。

第一段（commit `61375c7`）：
- `room.js`：`makeRoomCode`（5 碼，排除 0/O/1/I）、`normalizeRoomCode`、`roomPeerId`（前綴 `econboard-v1-`）、`seatController`、`canAct`、`claimSeat`、`releaseSeat`、`releaseClient`、`parseGuestMessage`（訪客訊息白名單：`hello`／`claim`／`release`／`action`，數量必須是有限數字）。`room.test.js` 有 7 個測試。
- `run()` 改為回傳錯誤訊息字串（成功時回傳 `null`）。

第二段（連線與畫面）：
- PeerJS 1.5.2 由 `index.html` 從 `https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js` 載入。單機遊玩不依賴 PeerJS 或網路。
- `app.js` 的程式位置：`room` 狀態物件與 `clientId`（存在 `sessionStorage`）在檔案上方；連線程式在 `applyAction` 之後（`createRoom`／`openHostPeer`／`acceptGuest`／`onGuestMessage`／`joinRoom`／`connectToHost`／`onHostMessage`／座位操作／`renderRoom`）。
- 動作邏輯抽成 `applyAction(action, amount, remote)`，本機點擊和遠端訊息共用。遠端動作只檢查 `phase==='draw'`，不受房主本機「卡片未關閉」限制。
- 房主：`save()` 和 `adoptShared()` 結尾呼叫 `broadcastRoom()`，送出 `{t:'state', game: JSON 字串（log 只留 60 筆）, seats, online, hostClientId}`；回應 `hello` 時加上 `welcome:true`。遠端動作排進 `room.queue` 逐一處理，並在執行當下才用 `canAct` 檢查。`gameId` 改變時清空座位。關閉房間或關閉頁面時送 `{t:'closed'}`。
- 訪客：`save()` 不寫 `localStorage`，不回應 `storage`／`BroadcastChannel`／focus 同步；收到 `welcome` 先清掉本機 `state` 再採用房主狀態；斷線每 3 秒重連，最多 15 次。離開房間會重新載入頁面（去掉 `?room=`），回到本機對局。
- 畫面：頂端「多裝置房間」按鈕與狀態標籤（`#room-chip`）、房間對話框（`#room-modal`）、訪客等待開局畫面（`#room-wait`）。`renderBoard`／`renderTurn` 變成包裝函式，內容在 `renderBoardContent`／`renderTurnContent`，再由 `gateTurnControls()` 停用不是自己回合的按鈕並顯示提示。`host-only` 類別的按鈕在訪客端隱藏。支援 `?room=代碼` 邀請連結。

已驗證（瀏覽器兩個頁籤，經 PeerJS 公用伺服器實際連線）：建立房間 → 邀請連結加入 → 未選座位時無法操作 → 認領座位後拉霸、抽卡、聘僱、交棒並結算一季 → 連送兩次「交給下一位」第二次被擋 → 訪客重新整理後座位保留 → 房主關閉房間後訪客收到通知。375px 手機寬度無橫向溢出。28 個單元測試通過。

線上展示網址的連線測試（2026-10-21）：
- 房主建房成功（PeerJS 從 unpkg 載入、SRI 通過），訪客也連上配對伺服器並找到房主，但 WebRTC 點對點連線失敗（`connectionState: failed`）。
- 原因：在公開網址上，Chromium 的 host 候選位址是 mDNS（`xxxx.local`），只剩 srflx（學校對外 IP `163.25.119.118`），同一台電腦的兩個頁籤需要 NAT 迴流，學校網路不支援。在 `localhost` 上瀏覽器會給真實區網位址，所以本機測試能連上。
- 結論：要讓線上版穩定跨網路連線，技術上需要 TURN 中繼，但使用者決定不用（見下方）。

第三段（連線逾時，使用者選「只修逾時提示」，不加 TURN）：
- 原因：PeerJS 1.5.4 的 `DataConnection.close()` 在連線從未 `open` 時不會發出 `close`；ICE 失敗時只發 `error`，卡住時什麼都不發。舊程式忽略 `error`，所以訪客停在「正在連線…」。
- `app.js`：`CONNECT_TIMEOUT_MS=15000`。訪客在 `joinRoom` 和每次 `connectToHost` 呼叫 `armConnectTimeout()`；`open` 時清掉計時器。逾時、`open` 之前的 `error`、或 `close` 都走 `dropHostConn()`：已同步的訪客照舊 `scheduleReconnect()`（每次重連也有逾時，不會卡在同一次）；還沒同步的訪客呼叫 `failJoin()`，重設房間並打開對話框顯示 `P2P_FAILED`（建議改用手機熱點）或 `SIGNAL_FAILED`（配對伺服器沒回應）。代碼保留在輸入框。
- 房主：`acceptGuest` 15 秒後仍沒 `hello` 的連線會從 `room.guests` 移除；若連線從未 `open`，會跳提示。
- `styles.css`：`.room-card .form-error` 改成紅字底色框（原本被 `.modal-card p:not(.eyebrow)` 蓋成灰字）。
- 驗證：在 Chromium 用假的 `Peer`（模擬 1.5.4 的事件行為）加上 Playwright 假時鐘跑 8 個情境：只發 `error`、完全卡住、配對伺服器不回應、正常連線 60 秒不誤判、已加入的訪客重連卡住會繼續重試並在 15 次後顯示離線、房主清掉沒開成的連線。舊版 2/8 通過（重現「正在連線…」卡住），新版 8/8。375px 無橫向溢出。28 個單元測試通過。這個腳本需要 Playwright，沒有放進 repo。

實機測試（2026-10-21，使用者回報）：
- 同一支手機開兩個頁籤（一個房主、一個訪客）會失敗，訪客看到「找不到這個房間」：手機切到訪客頁籤時，房主頁籤被暫停，房間從配對伺服器上消失。
- **兩支手機、不同網路可以連上並遊玩。**

第四段（房主暫時離線，使用者說「做」）：
- 讀 PeerJS 1.5.4 原始碼（npm 版與 unpkg 版 SRI 相同）發現：房主和配對伺服器斷線後，舊程式會立刻 `reconnect()`；重連失敗時 `error` 發生在 `peer.open===false`，舊程式就 `resetRoom()`，整個房間被拆掉（已加入的訪客也斷線）。重連時伺服器若還佔著舊 ID，回 `unavailable-id`，舊程式會換新代碼並斷開所有人。另外 PeerJS 每次重連失敗都會再發一次 `disconnected`，立刻重連會變成連續重試。
- `app.js`：房主的 peer 曾經 `open` 之後（`opened`），`error` 一律忽略，交給 `disconnected` 處理 → `hostSignalLost()`：`room.offline=true`、提示「房間暫時離線」、狀態文字變琥珀色、頂端標籤顯示「暫時離線」，每 `SIGNAL_RETRY_MS=5000` 用同一個 ID `reconnect()`（`scheduleSignalRetry`／`retrySignal`）。重新 `open` 時提示「房間恢復連線」。訪客的 `disconnected` 也改成間隔重試。頁面回到前景（`visibilitychange`）或網路恢復（`online`）時立刻重試。
- 訪客「找不到這個房間」改成 `ROOM_NOT_FOUND`，說明房主頁面要開在最前面、重新整理會換代碼。
- 驗證：用 npm 的 `peerjs@1.5.4`（與線上同一個檔案）加本機 PeerServer（`peer@1.0.2`，綁 127.0.0.1:9000），在 Chromium 實際連線後停掉、重啟伺服器。舊版 2/9 通過（房間被拆掉、訪客斷線、恢復後代碼失效）；新版 9/9：伺服器停 20 秒房主保留房間和代碼、已加入的訪客不斷線、房主和訪客各只重試 4 次、伺服器回來 5 秒內恢復同一代碼、新裝置可用同一代碼加入、找不到房間的訊息正確。另外 3 個情境：伺服器仍佔著舊 ID 時房主維持離線不換代碼、ID 釋出後拿回同一代碼、`visibilitychange` 立刻重連（24 ms）。第三段的 8 個逾時情境仍全數通過，28 個單元測試通過，375px 無橫向溢出。腳本需要 Playwright 和網路下載套件，沒有放進 repo。

第五段（座位鎖定、全員入座、只看自己的資料，使用者說「做」）：
- `room.js`：移除 `seatController`、`releaseClient`；新增 `emptySeats(seats, playerIds)`。`canAct(seats, game, clientId)`（不再傳房主 ID）在還有空位時一律回傳 `false`。`claimSeat` 在裝置已經有座位時丟出「你已經選好座位了…」。`parseGuestMessage` 不再接受 `release`。新增 `netWorthRanking(game)`（由高到低，同分同名次），淨資產只在這裡算給排行用。
- `app.js`：`mySeat()`／`missingSeats()`；`claimSeatHere` 先 `confirm`；座位清單在房主端對所有已入座的座位顯示「收回」，訪客自己的座位顯示「已鎖定」，已入座的裝置看不到其他「坐這裡」。`promptSeat()`（在 `renderRoom` 開頭）每個 `gameId` 對沒座位的裝置自動打開座位清單一次。`turnWho()` 讓「輪到你」只對可操作的裝置顯示，其他人看到「輪到「玩家 1」」；`roomTurnNote()` 顯示「等待入座：還差…」或「現在輪到…，你是…」。`renderPlayers` 在房間模式只畫自己的卡（`.mine`、「你」標記）加 `rankingMarkup()`。頂端標籤：訪客顯示「你：玩家 2」或「還沒選座位」。
- `index.html`：訪客等待畫面文字改成「會跳出座位清單」。`styles.css`：`.net-ranking`、`.you-badge`、`.room-seat-locked`。
- 驗證：30 個單元測試（`room.test.js` 改寫座位測試並加排行測試）。Chromium＋真的 PeerJS＋本機 PeerServer 13 個情境全過：房主開局後訪客和房主都自動跳出座位清單；有空位時房主強制按拉霸也被擋並提示還差誰；入座後鎖定；改過程式的訪客送 `claim` 另一個空位或 `release` 都被房主拒絕；訪客畫面寫「輪到「玩家 1」」；坐滿後輪到的人能拉霸；房主和訪客都只看到自己的卡和兩人排行；不開房間時照舊。390／1000／1500px 版面正常、無橫向溢出。第三、四段的 8＋9＋3 個連線情境重跑仍全過。

第六段（開局引導，使用者說「做」；其中步驟清單、裝置數對齊按鈕和人數不符確認，已在第七段被大廳取代並移除）：
- 房間視窗在開局前顯示步驟；設定畫面顯示裝置數並有「改成 N 位玩家」按鈕；人數不符時開始前先確認。
- 已開局但還有空位時，房主的房間視窗會用 `seatCountHint()` 顯示「目前 N 台裝置、M 位玩家」，裝置不夠時建議按「新遊戲」重設。
- README 的「怎麼玩」改成房主／其他玩家／常見問題的詳細步驟，順序是先建房再開局。
- 驗證：30 個單元測試；Chromium＋真的 PeerJS＋本機 PeerServer 11 個新情境全過（步驟顯示、裝置數即時更新、改成 N 位、人數不符先確認、取消不會開局、相符時直接開局、開局後兩邊都跳出座位清單、3 位玩家 1 台裝置的提示、單機模式沒有提示也不確認）。前面的 13＋9＋3＋8 個情境重跑全過，375px 無橫向溢出。注意：測試腳本中途當掉時，要確認本機 PeerServer（`signal-server.cjs`）有被停掉，不然下次「停掉伺服器」的測試會連到殘留的伺服器而誤判失敗。

第七段（選企業大廳，使用者說「做」）：
- `room.js`：`cleanPlayerName`（去掉控制字元、最多 16 字）、`pickRole(lobby, clientId, roleId, name, roleIds)`（企業不能重複、最多 8 位、換企業保留原本順序）、`leaveLobby`、`lobbyPlayers(lobby)`（至少 2 位；依選擇順序；空白名字補「玩家 N」，重名加數字，因為 `createGame` 要求名字不空白也不重複）、`lobbySeats(game, lobby)`（開始時把每位玩家對應到選他的裝置）。訪客訊息白名單新增 `pick`（`roleId`、`name`）與 `unpick`。
- `app.js`：`room.lobby`（陣列，房主權威，放進 `roomSnapshot` 廣播；訪客在 `onHostMessage` 檢查型別後採用）、`room.nameDraft`、`room.lobbyTarget`／`lobbyRounds`。房主在 `onGuestMessage` 處理 `pick`／`unpick`（已有對局時拒絕）。`lobbyMarkup()` 在沒有對局時取代座位清單：名字輸入、10 家企業按鈕（別人選走的 disabled）、已選名單（房主可「移除」）、房主的勝利目標／季數與「開始遊戲（N 位玩家）」按鈕。`startRoomGame()`：`lobbyPlayers` → `createGame` → `prepareNewSession` → `room.seats=lobbySeats(...)` 並設定 `seatsGameId`，關閉視窗後 `save()` 廣播；房主自己沒選企業或有選好的人離線時會先 `confirm`。訪客收到第一份對局時，有座位或沒有空位可接手就關閉房間視窗。`renderRoom` 重畫視窗時會保留目前輸入框的焦點和游標（大家打名字時有人選企業不會被打斷）。名字改完（`change`）會重送 `pick`。房間模式下 `body.room-host` 會隱藏設定畫面的手動玩家設定和開始按鈕，`#setup-room-hint` 改成提示去房間視窗；`#start-btn` 在 `room.role` 時不作用。訪客等待畫面有「輸入名字、選企業」按鈕。頂端標籤：訪客開始前顯示「已選：企業」或「還沒選企業」，開始後顯示「你：名字」或「觀看中」。
- 驗證：34 個單元測試（新增名字清理、大廳規則、最多 8 位、開始時的玩家與座位對應、`pick`／`unpick` 訊息）。Chromium＋真的 PeerJS＋本機 PeerServer 新增 18 個大廳情境全過：房主開房就看到大廳、選了企業但只有 1 位時不能開始、訪客看到被選走的企業變灰、改過程式的訪客強選也被房主拒絕、房主打字時有人選企業不會失去焦點、改名會更新名單、換企業保留順序、第三台可以加入再退出、設定畫面改成指向房間、用大廳設定的目標與季數開局、座位直接對應、開始後所有人的視窗關閉（觀看者顯示「觀看中」）、開始後房主可以直接拉霸、開始後選企業被拒絕、房主沒選企業會先確認、單機模式不受影響。座位測試改成「房主開房前已經有對局」的情況，13 個仍全過；連線 9＋3＋8 個重跑全過。375px 無橫向溢出。

第八段（單機／多人分開、版本號，使用者說「做」）：
- 起因：使用者實機測試時，房主手機存著上一局，建立房間後看到的是那局的座位清單（不是選企業大廳），訪客也選不到企業。已在瀏覽器重現。
- `app.js`：`createRoom` 在開房前清掉畫面上的對局（`state=null`，單機存檔不動），開房失敗時用 `readStored()` 還原。`save()` 遇到房主只 `broadcastRoom()`，不寫 `localStorage`、不送 `BroadcastChannel`；`storage`／`BroadcastChannel`／`syncOnFocus` 在 `room.role` 時一律忽略（原本只擋訪客）。`resetGame` 對房主直接回大廳（不 `clearSave`，保留大廳選擇並打開房間視窗）。`closeRoom` 送出 `closed` 後 300 ms 重新載入（去掉 `?room=`），跟訪客「離開房間」一樣回到單機模式。開局前房主和訪客都顯示 `#room-wait`（`render()` 依角色填 `#room-wait-title`／`#room-wait-copy`），房間模式不再顯示單機設定畫面；第七段的 `#setup-room-hint`、`body.room-host` 已移除。`body.in-room` 隱藏 `.single-only`（開啟同步頁籤、匯入存檔）。首頁：`#home-room-btn`；在房間裡時首頁只顯示「回到多人連線」。介面上「多裝置房間」全部改稱「多人連線」。
- `room.js`：`ROOM_PREFIX` 改成 `econboard-v2-`（第七段改了房間訊息卻沒升版，這次補上），舊版快取的頁面進不了新版房間。
- `build.mjs`：見「專案結構」，`index.html` 用內容雜湊蓋版本號，頁尾顯示版本。
- **回歸修正（同日，使用者回報「按啟動拉霸畫面變回等大家選企業」）**：每個動作（拉霸、抽卡、經營、交棒）會先跑 `ensureFresh()`，用 `localStorage` 檢查同一瀏覽器的其他頁籤有沒有開新局。房間對局不再寫進 `localStorage` 後，它在房主身上看到「沒有存檔」就以為別的頁籤開了新局，把 `state` 清成 `null`。修正：`ensureFresh()` 在 `room.role` 時直接回傳 `true`（房間對局只存在房主記憶體裡）；匯入存檔在房間裡一律拒絕。測試沒抓到的原因：檢查寫成「`phase` 不是 `roll`」，`state` 變成 `null` 時 `phase` 是 `undefined`，剛好也算通過。之後檢查遊戲還在時要寫 `state&&…`，並加了「房間裡從頭玩完一季」的測試（房主沒有單機存檔、房主和訪客各拉霸／抽卡／交棒，兩邊都到第 2 季且是同一局）：線上那版重現失敗，修正後 6/6。
- 驗證：34 個單元測試。Chromium＋真的 PeerJS＋本機 PeerServer：新增 14 個模式情境全過（首頁兩個入口、手機上有舊局時開房間看到大廳而不是座位清單、房間裡隱藏同步頁籤／匯入、有舊局的訪客也看到大廳、房間對局不寫進房主單機存檔、房主另一個頁籤不被同步、房間裡按「新遊戲」回大廳且保留選擇、訪客離開與房主關房後各自的單機對局都回來、頁尾版本和資源網址一致、`file://` 直接開啟仍可用）。大廳 19 個、座位 9 個（改成從大廳開局後測鎖定與接手）、連線 9＋3＋8 個全過。375px 無橫向溢出。

### 併吞／競標系統（其他人開發中）— 整合約定
使用者決定（2026-10-21）：**我們先把房間這邊做好並合併，再請對方把併吞系統接上來**。對方說會做成模組，不影響我們的合併。以下是接上時要注意的地方，給對方和下一個接手的人：

模組怎麼放才不會把遊戲弄壞：
- `index.html` 只載入 `game.js`，它由 `build.mjs` 把 `data.js`、`engine.js`、`sync.js`、`room.js`、`app.js` 依序接成一個檔。新模組要加進 `build.mjs` 的清單（用到引擎就放在 `engine.js` 後、`app.js` 前），只能用 `export function`／`export const` 和單行 `import … from './x.js'`。
- 所有檔案接起來後共用同一個範圍，頂層名稱不能和現有的重複（例如 `role`、`colors`、`money`、`state`），否則整個遊戲出錯打不開。建議一律加前綴，例如 `merger…`。
- 規則寫成只讀寫 `state` 的純函式（像 `engine.js` 的 `issueLoan(state, playerId, amount)`，不合法時 `throw Error('中文訊息')`），並在測試檔加測試。不要碰 DOM 或網路。房間裡只有房主執行規則，再把整份 `state` 廣播出去，所以純函式就會自動同步。`importGame` 只檢查基本欄位，新增欄位不會被擋。

接上時房間這邊要改的地方（等對方告訴我們名稱後由我們改）：
- **新動作**：加在 `app.js` 的 `applyAction`，並加進 `room.js` 的 `GUEST_ACTIONS`（有數量就也加進 `AMOUNT_ACTIONS`）。`parseGuestMessage` 目前只放行 `action` 和 `amount`；如果出價還要帶「哪家公司」等參數，要在這裡加驗證。
- **誰可以出價**：`canAct` 只允許坐在目前回合玩家的裝置。競標時其他人也要能出價，需要新的權限規則（例如競標階段裡，坐在未出局玩家、且不是被賣公司的裝置可以出價）。房主端的 `room.queue` 會把同時到達的出價逐一處理，引擎只要逐筆檢查即可。
- **淨資產**：目前一位玩家只有一個 `roleId`，淨資產在 `engine.js` 的 `endTurn`（破產、勝利判定）、`app.js` 的 `renderGoals`、`renderPlayers`，以及 `room.js` 的 `netWorthRanking` 用 `companyPosition(state, roleId)` 算。如果併吞後一位玩家可以擁有多家公司，這幾處要改成同一個函式（建議引擎加 `playerNetWorth(state, player)`），排行再改用它。
- **出局的玩家**：要有一個欄位標示（名稱待對方定）。`endTurn` 的輪流順序要跳過他；`emptySeats`／`canAct` 也要排除他，否則遊戲會一直等他的空位。他的裝置變成只能觀看。

中途有人要離開，討論過的三種做法：
- A. 換人接手：房主按「收回」，另一台裝置坐下接著玩，遊戲在等待期間暫停。**已經可以用。**
- B. 退出：玩家不再輪到、不參與勝負，公司像沒人選的企業一樣每季照樣結算（引擎本來就會結算全部十家公司）。尚未做。
- C. 競標併吞：由其他人開發。還沒定案的規則：底價怎麼算、輪流喊價或暗標、得標款付給誰（離開的人已不在，例如付給銀行）、併吞後是同時經營兩家公司還是只把淨資產併進來、勝利條件要不要調整。

尚未做／已知限制（下一步可考慮，修改前要先問使用者）：
- **使用者決定不使用 TURN 中繼（2026-10-21）。** 跨網路連線不保證成功，連不上時靠逾時提示引導改用手機熱點。除非使用者主動提起，不要再提議加入 TURN。
- 房主頁面被暫停太久時，已加入的訪客也可能斷線；訪客重連 15 次（約 2 分鐘）後會停在「房主已離線」，要重新加入。這部分沒有實機測過。
- 房主重新整理頁面會換一個新代碼，訪客要重新加入；房主的座位分配只存在記憶體。
- 房主端的 `applyAction`／連線流程沒有自動化測試（需要瀏覽器與網路），目前靠手動兩頁籤驗證。

## 交付規則

- 更新 README，說明新增功能、啟動方法及限制。
- 在 Commit 之前先列出修改的檔案，不自行 Push 或合併。
