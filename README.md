# Discord FF14 Log Summary Bot

Loki に蓄積された FFXIV の攻略ログを取得し、Discord へ要約結果を通知する PoC ボットです。
Node.js 22 / TypeScript / discord.js をベースに、Docker・Kubernetes・Fluentd・GitHub Actions を組み合わせて運用できる構成を想定しています。

---

## 機能概要

- `/test` スラッシュコマンド
  - 任意日付（未指定時は前日 JST）の「攻略開始」「攻略終了」ログを突き合わせ、所要時間付きで返信
  - `ephemeral` オプションにより、エフェメラル／通常返信を切り替え可能
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

## ジョブ／ヘルパー

- `src/jobs/dailySummary.ts` : Loki から前日分のログを取得し、`DISCORD_CHANNEL_ID` で指定したチャンネルへサマリを送信。CronJob・ローカル実行 (`yarn daily:summary`) 双方で利用。
- `src/logParser.ts` : 開始／終了ログを突き合わせてサマリを生成するコアロジック。
- `src/index.ts` : `/test` コマンドをハンドルし、必要に応じてエフェメラル返信を行う。

---

## 制限事項と今後の改善

- 2000 文字を超えるサマリは分割していません。必要に応じて複数メッセージ送信を実装してください。
- テストコードは未整備です。ロジックの安定化に合わせてユニットテストを追加してください。
- Fluentd の冪等制御や再送設計は PoC レベルです。商用利用では重複検知や監視を追加してください。
- Loki のクエリは単一 PC 前提です。複数環境のログを扱う場合は ConfigMap でラベル条件を調整する必要があります。

---

ご不明点や改善要望があれば、お気軽にお知らせください。
