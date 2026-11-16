# JRDB companion

認証済みのJRDB画面と公開済みZIPを、個人用Chromeと独立したPlaywright専用Chromiumのプロファイルで取得する。旧版では2026-11-15、利用者のBasic契約で京都11Rの実取得を確認した。

## 起動

秘密JSONを0600で作成し、`jrdbUser`、`jrdbPassword`、`syncToken`、`syncUrl` を設定する。環境変数 `JRDB_USER`、`JRDB_PASSWORD`、`COMPANION_TOKEN` でも指定できる。秘密ファイルはGitに入れない。

```bash
npx playwright install chromium --no-shell
node collector/run.mjs once --config /private/path/config.json --date 20261115 --race 08265411 --no-sync
node collector/run.mjs daemon --config /private/path/config.json
```

`once` は明示的な現在取得。`daemon` はカタログの当日レースに対し発走60・30・20・15・12・11・10・5分前、発走時、5・15・30分後を取得する。12・11分前の先行取得で、発走10分前の判断締切に間に合う観測を確保する。10分前以降は取得完了が締切を過ぎるため、主に推移・結果学習に使う。取り逃がした時点を後から取得済みと偽装しない。起動中30秒周期で確認する。

学習・ZIP準備・購入記録pullは、次の取得予定まで5分以内では実行しない。再学習は結果取得時かモデル初回生成時に限定する。オッズ更新ボタンからの要求は所有者専用APIの5分TTL付きqueueで受け、当日の公式カタログにあるレースだけを取得する。

## 常駐サービス

```bash
python3 -m collector.service install --config /private/path/config.json --start
python3 -m collector.service status
python3 -m collector.service stop
python3 -m collector.service start
```

`~/Library/Application Support/RaceAnalyzer/` に最小実行コード、Playwright依存、専用Chromiumとそのプロファイル、0600設定・記録を配置する。インストーラーは既存サービスを切り替える前にChromiumを取得する。LaunchAgentはログイン中のMacで動く。Mac停止・スリープ中は巡回しない。前の実行コードとplistバックアップを残す。再インストール時に既存の学習記録を上書きしない。

プロファイル認証の追加が必要な場合は `node collector/run.mjs login --config ...` を実行して専用ブラウザでログインする。常駐サービスと同じChromiumを使う場合は `PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Application Support/RaceAnalyzer/browsers"` を指定する。旧版からの初回切り替え時は新しいChromiumプロファイルを使用する。認証失敗はstatusへ記録する。ログへパスワード・Cookie・session queryを出さない。

## 取得内容と限界

- JRDB直前画面の名前付き列から全頭のIDM、パドック点、馬体重、単複オッズ、基準単勝を読む。
- 時系列タブを開き、rowspanを展開して公式の枠番号と時刻付き単勝履歴を読む。現在表示の履歴を後日取得した場合、取得時刻は現在のまま保持する。
- 全頭着順、上位5頭の実際の4角順位、8券種の掲載払戻を読む。掲載払戻はHJC ZIPそのものとは区別して `LIVE_RACE.payload.payouts` に保存する。画面にない返還を推定しない。
- 全組合せの実価格が提供されない券種は取得不能として残す。OZ・OW・OU・OT・OVは基準オッズであり、現在の購入価格として代用しない。
- 元公開時刻のない画面は `sourcePublishedAt:null` のまま、実際に見えた時刻を `availabilityAt`、証拠種別を `observed-visible-at` にする。ZIPや後付けの過去入力にこの証拠を付けない。
- パドック返し馬コメントはオプション契約が必要な場合がある。未提供を空欄の実測値とみなさない。

公式説明: [JRDB直前情報](https://jrdb.com/n_live/help.html)、[オッズ更新周期](https://jrdb.com/i/odds_info.html)、[基準オッズデータ](https://jrdb.com/dic/oz.html)。

## データ更新

`collector.catalog` は元SQLiteを読み取り専用で開き、正式出走馬と当該レース日より前の直近5走を取得する。古い `corner_pass_4` は単勝人気の互換列なので、4角順位として使用しない。未収録レースはJRDB会員ページに実在するリンクをたどり、表示された番組・全頭を補完する。

会員データ一覧に掲載された当日と前2日分のPACI・TYB・HJC ZIPを取得し、夜間公開された結果も補完する。同一内容のZIPはハッシュで重複処理を避ける。

```bash
bash scripts/update.sh
# 検証済み軽量DBを本番の私有Storageへ反映する場合
RACE_ENV_FILE=/private/path/storage.env bash scripts/update.sh --publish
```

PACI6桁ZIPを安全に展開し、元DBのSQLiteバックアップを派生領域で更新する。既存バックエンドの取込・評価コードは変更せず、作業ディレクトリと入力フォルダを派生先へ指定する。完全性確認後に原子的に置き換える。元DBは不変。初回に作った `model.runtime-base.json` を基準として固定し、条件・市場・最終価格モデルを時系列で学習する。新しいIDM条件モデルは研究候補として出力し、過去の前向き入力へ自動的にすり替えない。

## 本番同期

POST `/api/companion` はserver側で所有者を固定したtokenのみ受け付ける。観測・オッズは不変IDで追記する。同一履歴を再取得しても初回取得時刻を保持する。3MB未満・4レース以内・原則100観測以内のbatchに分割する。1レース単体で100観測を超えた場合は全記録を保持し、単独で送る。成功済みで内容が変わらないレースは再送せず、失敗時はpendingを保持して全batch成功まで再試行する。

所有者の購入・精算は同tokenの `pull-ledgers` 限定操作で取り込み、研究DBへ保存する。訂正競合は上書きせず保留する。`pull-commands` で受けた現在取得要求は、取得・保存・本番同期が成功した後に `ack-command` する。任意URL・任意ユーザーの取得はできない。

## テスト

```bash
node --test tests/collector.test.js
python3 -m unittest collector.test_collector pipeline.test_pipeline pipeline.test_prediction -v
```
