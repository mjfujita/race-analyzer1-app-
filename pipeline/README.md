# JRDBの記録と学習処理

Python 3標準ライブラリだけで、元DBの監査、TYB/HJCの取込み、時刻付きオッズと購入記録の蓄積、IDM基準モデルの学習と未使用期間の評価を行います。元の `~/projects/backend/race.db` は読み取り専用で開き、別のローカルDBへ記録します。本番サービスへの送信や馬券購入は行いません。

プロジェクトのルートで次を実行します。

```bash
python3 -m pipeline.run run
```

既定の入力は `~/projects/backend/race.db`、出力は `pipeline/output/` です。入力パスは `--source-db`、出力先は `--output` で変更できます。

ダウンロード済みTYB/HJC ZIPをまとめて処理する場合は、取得フォルダを一度のコマンドに指定できます。

```bash
python3 -m pipeline.run run --inbox "$HOME/Downloads"
```

指定フォルダ直下の `TYB年月日*.zip` と `HJC年月日*.zip` だけを対象にします。`(1)` 等が付いた重複ダウンロードも内容で重複排除します。サブフォルダ・シンボリックリンクは追いません。`--inbox` を指定しなければフォルダ走査は行いません。PACIはこの自動検出の対象外で、既存バックエンドでの取込みが必要です。

ZIPと画面から書き出した記録を同時に追加する場合：

```bash
python3 -m pipeline.run run \
  --zip '/path/to/TYB261114.zip' \
  --zip '/path/to/HJC261114.zip' \
  --snapshots '/path/to/odds-history.json' \
  --ledger '/path/to/forecast-ledger.json'
```

`--zip`、`--snapshots`、`--ledger` は複数指定できます。ZIP対応は日付付きTYB/HJC。PACI等の前日パックは既存バックエンドで取り込み、そのDBをこの処理で読みます。ログイン画面の巡回・ダウンロード・PACIの派生DB取込みは [JRDB companion](../collector/README.md) が担当し、この学習処理へ連携します。

| 出力 | 用途 |
|---|---|
| `audit.json` | 全頭完全性、除外理由、収録月、入力時刻の制約 |
| `model.latest.json` | 画面へ取り込めるIDM温度モデル。研究中として表示 |
| `model.conditions.json` | 直近5走の距離・会場・コース実績の追加効果を比較した研究モデル |
| `experiments/*.json` | データとアルゴリズムの版に対応した学習・校正・未使用評価 |
| `market.sqlite` | 元情報を上書きしない観測・記録の蓄積 |
| `observations.json` | TYB・HJC・オッズ・購入記録の統合出力 |
| `ledgers/*.json` | ブラウザへ戻せるユーザー・レース別記録 |
| `payout-suggestions.json` | HJCに掲載された払戻との照合案。精算確定は別操作 |
| `report.latest.json` | 今回の取込件数・監査・学習の結果 |

出力ディレクトリはGit対象外です。JSONとSQLiteはアクセス権0600で作成します。個別の馬データやユーザー記録を共有用コードに追加しないでください。

## 取得時刻を守る

オッズJSONはブラウザのschemaVersion 2の形式です。単体の配列、または `{ "schemaVersion": 2, "snapshots": [...] }` を受け付けます。ID、レース日、観測時刻、元の更新時刻、取得時刻、全頭の倍率が必須です。タイムゾーン付きISO日時と表示時刻の整合性を検証します。

既定では元DBの出走馬数・馬番と一致した場合だけ取り込みます。取消後の正式な出走馬を別途確認した場合は、次の形式の `--manifest /path/active-fields.json` を指定します。

```json
{"05261101": [1, 2, 3, 5, 6]}
```

古いTYB ZIPにはオッズ取得HHMMがありますが、ファイルの公開時刻はありません。取得日を昔に書き換えず、公開時刻は不明のまま保存します。これを発走10分前に実際に取得できた情報とみなすことはありません。

HJCは全8券種の払戻を読みますが、返還対象を明示するフィールドがありません。掲載された的中払戻は照合できます。未掲載の買い目を自動的に不的中0円としません。ブラウザで返還の有無を確認してから精算を保存します。

## 学習の範囲

全頭の予想IDM、確定オッズ、結果が揃い、馬ID・頭数・着順が一致するレースを抽出します。取消・同着・未完走等で整合しないレースは丸ごと除外します。除外の偏りを監査結果に残します。

日付単位で古い順に約60%を学習、20%を校正、20%を未使用評価へ分けます。同日や同レースの馬を分割しません。IDM温度は学習期間と校正期間だけで選び、未使用期間はlog loss、Brier、確率帯別頻度を評価するために使います。最低60レース・15日未満なら学習を止めます。この件数は処理上の最低値で、十分な精度を保証する基準ではありません。

市場γと能力・市場の混合係数も比較しますが、既存DBの価格は確定オッズです。これらは `marketResearch.scope = closing-odds-only`、`usableForT10 = false` として出力し、10分前予測の学習済みモデルには適用しません。確定オッズによる仮の回収診断は、実購入・正式払戻による実績とは別です。

追加の適性モデルは、各対象レースより前の日付の有効な過去走から直近5走を選び、同じ芝ダートで近距離（±200m）・同会場・同コース距離の走数と3着内数を作ります。これは画面側の `race_ability` と同じ定義です。条件別に5走を選ぶ方式ではありません。

各特徴は `(3着内数 − 学習期間の基準率 × 走数) / (走数 + 3)` とし、小標本を0へ縮めます。基準率は学習期間に属する馬の過去走だけで計算します。係数は学習期間でL2正則化付き尤度を最適化し、校正期間だけで正則化強度とIDM単独からの変更可否を選びます。採用されなければ係数は0です。未使用期間の成績は報告のみに使い、そこで有利だった方へ選び直しません。

`run` は追加で `model.runtime.json` を生成します。展開、当日傾向、天候・馬場状態、パドック、市場、最終価格の各特徴は、条件に合う時刻付き記録だけから学習・校正します。必要な観測が不足する特徴は未採用または係数0のままです。締切後に取得した画面履歴を、締切前の前向き記録に流用しません。

初回の能力・適性モデルを `model.runtime-base.json` に固定し、以後のruntimeモデルと本番同期もこの同じ基準モデルを使います。毎回出力する `model.conditions.json` は研究候補で、基準モデルを自動的に置換しません。新しい基準モデルの採用には、別版として将来の観測を蓄積して比較する工程が必要です。

## 個別の処理

```bash
python3 -m pipeline.run audit
python3 -m pipeline.run train
python3 -m pipeline.run import-zip --zip '/path/to/HJC261114.zip'
python3 -m pipeline.run import-snapshots --snapshots '/path/to/odds-history.json'
python3 -m pipeline.run import-ledger --ledger '/path/to/forecast-ledger.json'
python3 -m pipeline.run export
python3 -m unittest pipeline.test_pipeline -v
```

再取込みは同じ内容を重複登録しません。IDが同じで内容の異なるオッズ・購入記録は拒否します。訂正は新IDと元IDへの参照で追記します。古い購入記録を取り込んでも、新しい記録は削除されません。

## 参照した公式仕様

- [JRDB TYB第4b版](https://jrdb.com/program/Tyb/tyb_doc.txt)：128バイト、CRLF除外後126バイト。
- [JRDB HJC第4a版](https://www.jrdb.com/program/Hjc/hjcdata_doc.txt)：444バイト、CRLF除外後442バイト。三連単払戻は9桁。

ファイルはバイト位置で解析し、日本語文字数をオフセットに使いません。ZIPの内部パスを展開せずメモリ上で検証し、サイズ制限・全レコードの検証後に取込みます。
