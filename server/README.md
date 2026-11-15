# 個人用の取得・予想記録API

`api/companion.js` は Vercel Node Function。`race-research` private Storage bucketを使う。既存の`race-db/race.db.gz`には触れない。

必要なサーバ環境変数：`SUPABASE_PROJECT_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`RACE_OWNER_ID`、`COMPANION_TOKEN`（32文字以上）。いずれも`VITE_`を付けない。クライアントへservice keyとcompanion tokenを返さない。

## HTTP

- `GET /api/companion`：Supabase `getUser(accessToken)`で検証したownerだけ。status、models、availableRaces（最新開催日順、最大36件）。`raceDate=YYYYMMDD`で開催日を指定できる。
- `GET /api/companion?raceId=...&raceDate=YYYYMMDD`：上記にrace、snapshots、observations、context、results、ledger、conflictsを加える。
- `POST /api/companion`、`Authorization: Bearer COMPANION_TOKEN`：取得プログラムの`race-companion-bundle`を受け付ける。
- 同tokenの`POST {"action":"pull-ledgers","raceId":"...","raceDate":"YYYYMMDD"}`：固定ownerの指定1レースのledgerだけを取得プログラムへ返す。返答は`{schemaVersion:1,ledger,conflicts:[]}`。userId・自由パス・複数レース指定は受け付けず、返答3MB超は413で記録を保持する。購入記録をローカル研究データへ取り戻す用途。
- ownerの`POST {"action":"request-capture","raceId":"...","raceDate":"YYYYMMDD"}`：5分有効の画面取得依頼を保存する。返答は`{ok:true,command:{id,raceId,raceDate,requestedAt,expiresAt,status}}`。同raceの未完了依頼は再利用し、同時依頼もcreate-onlyの後続slotで統合する。
- collector tokenの`POST {"action":"pull-commands"}`：期限内の未完了依頼を最大36件、`{schemaVersion:1,commands:[...]}`で返す。`POST {"action":"ack-command","id":"...","status":"completed"}`で完了、`failed`で失敗を記録する。完了記録もimmutable、同じstatusの再送は可能。任意URL/user/pathは受け付けない。GETのstatusに`pendingCaptureCount`を含める。
- `POST /api/companion`、ownerのSupabase bearer：`{"action":"ledger","ledger":...}`だけを受け付ける。

匿名は401、別ユーザーは403、同じID内容変更・訂正分岐は409。GETにcollector tokenは使えない。CORS wildcardを設定しない。返答は`private, no-store`。JSONは3MB以内。任意パス・別raceの観測・機密キー・セッション入りURLを拒否する。

## 保存と競合

Storage配下はowner IDからサーバが構成し、リクエストの自由パスを採用しない。

- 元bundle、race観測の版、ledger受信版は内容hashでimmutable保存。
- snapshot/event IDにも原子的なcreate-only保存を行い、同ID変更を拒否。
- 実効ledgerは予想・購入・精算の個別immutable objectを結合して検証する。
- 購入訂正は元ID、初回精算は購入ID、精算訂正は元精算IDから一意の保存先を作る。`upsert:false`の原子的確保で同時分岐の一方を409にする。
- 予想→購入→精算の依存順に保存。途中で通信が失敗しても、有効な先行記録だけが残り、同じ送信を再実行できる。
- 元IDの内容変更や循環・参照不整合がある保存記録は409。自動的に金額を集計しない。
- 各ledger種類は500件、race観測版は2000件まで読み、超過時は切り捨てずエラーにする。metadataは最新1版、レース一覧は表示上限を明示して絞る。

これはRDBの一括transactionではない。複数の追記が一度に送られた場合、途中の失敗で有効な一部の追記が先に保存されることがある。上書き消失や二重計上を防ぐため、immutable IDに基づいて再送・再取得する。

## 本番前の権限確認

private bucketを作るだけで安全を断定しない。実環境で匿名・通常認証ユーザーの直接Storageアクセスを拒否すること、APIのowner認可、別user・パス変更・未認証・不正tokenの拒否を確認する。service roleを持つローカルプログラムとサーバだけがStorageへ直接書く。

`tests/cloud-api.test.js`はMemory Storageの原子的create-only契約を使い、認可、入力検証、同時更新、失敗後の再送、会計の往復を検証する。実SupabaseのRLS・ネットワークを検証した代替にはならない。
