# Discord FF14 Log Summary Bot

Loki に蓄積された FFXIV の攻略ログを取得し、Discord へ要約結果を通知する PoC ボットです。
Node.js 22 / TypeScript / discord.js をベースに、Docker・Kubernetes・Fluentd・GitHub Actions を組み合わせて運用できる構成を想定しています。

---

## 機能概要

- `/test` スラッシュコマンド
  - 任意日付（未指定時は前日 JST）の「攻略開始」「攻略終了」ログを突き合わせ、所要時間付きで返信
  - `ephemeral` オプションにより、エフェメラル／通常返信を切り替え可能
- `/dps` スラッシュコマンド
  - 同日内の各攻略に対してプレイヤーごとの DPS ランキングを表示
  - `content`（部分一致）や `index`（複数合致時の番号指定）で絞り込み
- 日次バッチ
  - CronJob により毎日 10:00 JST に前日の攻略履歴を指定チャンネルへ自動投稿
- Loki 連携
  - ラベルセレクタ＋正規表現フィルタで攻略ログのみを取得
  - デバッグ時は `LOKI_DEBUG=true` で詳細ログを標準出力へ出力

---

## 必要な環境変数

| 変数名 | 用途 | 備考 |
| --- | --- | --- |
| `DISCORD_TOKEN` | Discord Bot Token | Secret 推奨 |
| `DISCORD_CLIENT_ID` | Discord アプリケーションの Client ID | Slash コマンド登録用 |
| `DISCORD_GUILD_ID` | Slash コマンドを登録する Guild ID | 〃 |
| `DISCORD_CHANNEL_ID` | 日次サマリを送信するチャンネル ID | CronJob / ジョブスクリプトで使用 |
| `LOKI_BASE_URL` | Loki のエンドポイント | 例: `http://loki.monitoring.svc.cluster.local:3100` |
| `LOKI_QUERY` | ラベルセレクタ | 例: `{content="ffxiv", instance="DESKTOP-LHEGLIC", job="ffxiv-dungeon"}` |
| `LOKI_QUERY_FILTER` | 追加の Loki パイプ記述 | 例: `|~ "攻略を(開始|終了)した。"`。未指定なら全ログを取得 |
| `LOKI_QUERY_LIMIT` | 取得上限件数 | 既定値 5000 |
| `LOKI_DEBUG` | デバッグ出力フラグ | `true`/`false` |
| `APP_TIME_ZONE` | 表示・整形に使用するタイムゾーン | 既定値 `Asia/Tokyo` |
| `AGGREGATION_START_HOUR_JST` | 集計開始時刻（JST 時） | 既定値 `10` |
| `AGGREGATION_END_HOUR_JST` | 集計終了時刻（JST 時） | 既定値 `10`（=開始から24h） |

`.env.example` を `.env` にコピーし、上記を設定してください（`.env` は `.gitignore` 済み）。

---

## ローカル開発フロー

1. **依存関係をインストール**
   ```bash
   yarn install
   ```
2. **Slash コマンドを登録**
   ```bash
   yarn deploy:commands
   ```
3. **ボットを起動**
   ```bash
   yarn dev        # ホットリロード
# もしくは
yarn build
yarn start
   ```

### `/test` コマンド例
- `/test` … 前日 JST のサマリをエフェメラルで返信
- `/test ephemeral:false` … 通常メッセージで返信
- `/test date:2025-10-06` … 指定日のサマリをエフェメラルで返信
- `/test date:2025-10-06 ephemeral:false` … 指定日＋通常メッセージ

---

## Fluentd 設定例（Windows）

`fluentd/fluent.conf` には Tail → Loki 出力のサンプルを配置しています。

```conf
<source>
  @type tail
  path "C:\\Users\\Owner\\AppData\\Roaming\\Advanced Combat Tracker\\FFXIVLogs\\*.log"
  pos_file "C:\\Users\\Owner\\work\\ffxiv_logs\\ffxiv.pos"
  tag "ffxiv.logs"
  read_from_head true
  <parse>
    @type multiline
    format_firstline "/^\\d+\\|/"
    format1 /^(?<prefix>\\d+)\|(?<timestamp>[^|]+)\|(?<code>[^|]*)\|(?<extra>[^|]*)\|(?<message>[^|]*)\|(?<uuid>.*)$/
    time_format %Y-%m-%dT%H:%M:%S.%N%:z
    time_key timestamp
    keep_time_key true
  </parse>
</source>

<filter ffxiv.logs>
  @type record_transformer
  enable_ruby false
  <record>
    job ffxiv-dungeon
    instance DESKTOP-LHEGLIC
  </record>
</filter>

<match ffxiv.logs>
  @type loki
  url "http://192.168.100.220:31000/loki/api/v1/push"
  extra_labels {"content":"ffxiv"}
  <buffer>
    @type file
    path "C:\\Users\\Owner\\work\\ffxiv_logs\\buffer"
    flush_interval 5s
  </buffer>
</match>
   ```

- 初回に過去ログを再送したい場合は Fluentd 停止 → pos ファイル・バッファ削除 → 再起動
- `LOKI_QUERY_FILTER` を設定すると Loki クエリに追記されます（既定では無指定）。

### Loki の手動クエリ（curl 例）

ローカルからポートフォワードして確認できます。

```bash
kubectl -n monitoring port-forward svc/loki 3100:3100

# 例: 2024-10-08 の JST 10:00 → 翌日 08:00 (UTC 01:00 → 23:00)
curl -sG 'http://localhost:3100/loki/api/v1/query_range' \
  --data-urlencode 'query={content="ffxiv",job="ffxiv-dungeon",instance="DESKTOP-LHEGLIC"}' \
  --data-urlencode 'start=2024-10-08T01:00:00Z' \
  --data-urlencode 'end=2024-10-08T23:00:00Z' \
  --data-urlencode 'direction=FORWARD' \
  --data-urlencode 'limit=5000' | jq .
```

---

## GitHub Actions

1. **Build and Push Docker Image (`.github/workflows/ci.yml`)**
   - `v*` タグの push をトリガーとして GHCR に `ghcr.io/<owner>/<repo>:<version>` と `:latest` をプッシュ
2. **Deploy Slash Commands (`.github/workflows/deploy-commands.yml`)**
   - 上記ワークフローが成功すると自動起動し、該当コミットで `yarn deploy:commands` を実行
3. **Release (`.github/workflows/release.yml`)**
   - 手動 (`workflow_dispatch`) で `standard-version` を実行し、CHANGELOG 更新＋タグ push＋GitHub Release 作成
   - タグ push により 1. と 2. が連動

### リリース手順（ローカル）
1. Conventional Commits で実装を終えたら `git push`。Husky が `yarn release` → `git push --follow-tags --no-verify` を自動実行します。
   - 初回 push 時は upstream が無い場合でもフック内で自動作成します。
2. タグ push 後、Docker ビルドと Slash コマンド更新が自動で走ります。
3. 手動で行いたい場合は `yarn release -- --release-as <type>` → `git push --follow-tags` でも可。

必要な Secrets: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`（GitHub Actions で使用）。

---

## Docker

```bash
docker build -t ff14-log-bot .
docker run \
  --env-file .env \
  ff14-log-bot
```

プライベート GHCR を利用する場合は `docker login ghcr.io` と `ghcr-pull` Secret を Kubernetes へ作成してください。

---

## Kubernetes マニフェスト

`k8s/manifests/` に以下を用意しています。

| ファイル | 説明 |
| --- | --- |
| `configmap.yaml` | Loki 接続情報などの非秘匿設定 |
| `secret.example.yaml` | Discord 認証情報のテンプレ。`secret.yaml` にコピーし実値を設定のうえ適用 |
| `deployment.yaml` | ボット本体の Deployment。GHCR イメージ使用、`ghcr-pull` Secret を参照 |
| `cronjob.yaml` | 毎日 10:00 JST に `node dist/jobs/dailySummary.js` を実行する CronJob |

適用例:
```bash
kubectl apply -f k8s/manifests/configmap.yaml
kubectl apply -f k8s/manifests/secret.yaml   # secret.example.yaml から作成
kubectl apply -f k8s/manifests/deployment.yaml
kubectl apply -f k8s/manifests/cronjob.yaml
```

必要に応じて `namespace`、リソース要求、イメージタグ等を調整してください。

---

## ジョブ／ヘルパー / 構成

- `src/jobs/dailySummary.ts` : 前日分のログを取得しサマリを送信（直接実行時のみ起動）。テスト向けに依存注入関数 `runDailySummaryWithClient()` を公開。
- `src/logParser.ts` : 開始／終了ログの突き合わせと日次サマリの整形。
- `src/discord/handlers.ts` : `/test` `/dps` の実装（依存注入版を用意）。`src/index.ts` から利用。
- `src/index.ts` : Discord クライアントの起動とイベント購読。
- `src/loki/client.ts` : Loki `query_range` 取得。ページング／重複排除／昇順ソート対応。
- `src/parsers/events.ts` : cactbot LogGuide 準拠のパーサ（00/21/22 に加え 03/04 をサポート）。
- `src/registerCommands.ts` : コマンド登録ロジック（`registerCommands`/`registerCommandsWith`）。
- `src/registerCommands.main.ts` : コマンド登録エントリポイント（`yarn deploy:commands` で実行）。

### 集計期間（JST）の定義
- `AGGREGATION_START_HOUR_JST` と `AGGREGATION_END_HOUR_JST` により、「JST X:00 〜 （必要なら翌日へ）JST Y:00」を定義。
- 例: `10` と `8` → 「JST 10:00 〜 翌日 08:00」。
- 例: `10` と `10` → 「JST 10:00 〜 翌日 10:00」。

---

## テスト

- 実行
  - Node.js 20.6+ / 22+（本プロジェクトは 22+ を推奨）
  - `yarn test`（内部で `node --test --import tsx "tests/**/*.test.ts"` を実行）

- カバレッジ（主なテスト）
  - パーサ: 日本語ダメージ文、00 Start/End、21/22 Ability/AOE、03/04 Add/RemoveCombatant
  - Loki クライアント: ページング・重複排除・昇順ソート・フィルタ結合（`|~`/生 `|`）
  - 集計: セグメント組み立て・連番付与・DPS 集計
  - 表示: 日次要約・DPS 一覧/詳細の整形
  - Discord: `/test` `/dps` ハンドラ、日次ジョブ（依存注入＋スタブ）
  - 実ログ回帰: ルートの `logs.json` を読み込み、`parseEvents`/`parseDamageMessage` が破綻しないことを確認

- フィクスチャ方針
  - 実ログは `logs.json` に一時保管（配列形式）。必要に応じて `tests/fixtures` に NDJSON/小型 JSON を追加していくのが推奨
  - NDJSON: 1 行 1 JSON（`{timestamp_ns,line,stream}`）。追記や差分が扱いやすい
  - 期待結果のゴールデン JSON: セグメント/サマリの回帰確認に有効

- モックの使い分け
  - Loki: `global.fetch` を `node:test` の `mock.method` で差し替え
  - Discord: REST/Client をスタブ、または依存注入関数に差し替え

---

## 制限事項と今後の改善

- 2000 文字を超えるサマリは分割していません。必要に応じて複数メッセージ送信を実装してください。
- 21/22 の詳細フィールド（クリ/直/DoT 等）の網羅は段階的に拡充予定。必要に応じて cactbot のフィールド割り当てに合わせて厳密化します。
- Fluentd の冪等制御や再送設計は PoC レベルです。商用利用では重複検知や監視を追加してください。
- Loki のクエリは単一 PC 前提です。複数環境のログを扱う場合は ConfigMap でラベル条件を調整する必要があります。

---

ご不明点や改善要望があれば、お気軽にお知らせください。
