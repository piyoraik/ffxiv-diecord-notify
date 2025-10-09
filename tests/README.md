# テスト概要

このディレクトリには、Bot のユニットテストおよび小規模な結合テストが含まれます。Node.js 標準のテストランナー（ESM）と tsx ローダーを使用しています。

## 実行方法

- 前提
  - Node.js 20.6 以上（本プロジェクトは 22+ を推奨）
  - Yarn（Corepack）：`corepack enable`
- コマンド
  - すべて実行: `yarn test`
  - 単体実行: `node --test --import tsx tests/<file>.test.ts`
  - 実ログ回帰を明示的にスキップ（CI 既定）: `LOGS_JSON_PATH=__missing__ yarn test`

補足
- ランナーは ESM 専用で、`--import tsx` を使用します（`--loader` は非推奨）。
- アサーションは `node:assert/strict` を使用します。

## 主なテストファイル

- `parsers.events.test.ts`
  - ダメージ文のパース（アクター/ターゲット/ダメージ量/クリ/直）
  - システム開始/終了（00）
  - 構造化アビリティ/範囲（21/22、末尾数値のフォールバックを含む）
- `loki.client.test.ts`
  - ページング、重複排除、昇順ソート
  - フィルタ結合（`|~` の正規表現／生 `|` パイプ）
  - `global.fetch` をモック
- `combatAnalyzer.segments.test.ts`
  - セグメント組み立て（開始/終了のペアリング）、連番付与
  - セグメント内の DPS 集計
  - 03/04（Add/RemoveCombatant）からの参加者推定
- `logParser.format.test.ts`
  - 日次サマリ／DPS 一覧／DPS 詳細の文字列整形
- `config.appSettings.test.ts`
  - 既定値、環境変数上書き、クランプ/フォールバック
- `registerCommands.test.ts`
  - `registerCommandsWith()` が期待どおりの REST パス/ボディで PUT すること
- `dailySummary.job.test.ts`
  - 依存注入（`runDailySummaryWithClient`）でジョブのフローを検証
- `parsers.realLogs.test.ts`
  - 実ログ JSON を用いた回帰（オプション。ファイルが無ければ skip）

## 実ログ回帰テスト

- 既定パス: `logs/logs.json`（Git 管理対象外）
- 上書き: 環境変数 `LOGS_JSON_PATH=/path/to/logs.json`
- 形式（配列）
  ```json
  [
    { "line": "line=\"00|...\"", "timestamp": "1728380689000000000", "fields": {"job":"ffxiv-dungeon","content":"ffxiv"} }
  ]
  ```
- 目的: `parseEvents` / `parseDamageMessage` が実ログでも破綻しないことを軽く確認
- ファイルが無い環境では自動的に skip されます

### 小さなサンプルの作り方

1) Loki へポートフォワード
```bash
kubectl -n monitoring port-forward svc/loki 3100:3100
```
2) クエリして配列 JSON を生成（ラベル・期間は適宜調整）
```bash
curl -sG 'http://localhost:3100/loki/api/v1/query_range' \
  --data-urlencode 'query={content="ffxiv",job="ffxiv-dungeon",instance="DESKTOP-LHEGLIC"}' \
  --data-urlencode 'start=2024-10-08T01:00:00Z' \
  --data-urlencode 'end=2024-10-08T23:00:00Z' \
  --data-urlencode 'direction=FORWARD' \
  --data-urlencode 'limit=1000' | \
jq -c '[.data.result[] | .stream as $s | .values[] | {line:("line=\"" + .[1] + "\""), timestamp: .[0], fields: $s}]' > logs/logs.json
```

## モックの書き方（例）

- Fetch（Loki）:
```ts
import { mock } from 'node:test';
const r = mock.method(global as any, 'fetch', async () => {
  return new Response(JSON.stringify({ data: { result: [] }}), { status: 200 });
});
// r.mock.restore() で解除
```
- Discord（コマンド登録）:
```ts
class FakeREST { private token?: string; setToken(t: string){ this.token=t; return this; }
  async put(path: string, init: any) { /* path / body を検証 */ }
}
await registerCommandsWith(new FakeREST() as any, Routes, 'cid', 'gid', commands);
```
- 非同期フローは依存注入でテストしやすく（`runDailySummaryWithClient`, `handleTestCommandWith`, `handleDpsCommandWith`）

## フィクスチャ運用

- 実ログは `logs/logs.json` に保存（Git 管理外）。
- コミットするフィクスチャは `tests/fixtures/` 配下に小さく分割して配置:
  - NDJSON コーパス: `loki/lines.ndjson`（1 行 1 JSON）
  - Loki API 小型 JSON: `loki/query-range/p1.json`, `p2.json`
  - ゴールデン期待値: `expected/segments.json`, `expected/daily-summary.json`

## 新しいテストの追加（レシピ）

1) `tests/<name>.test.ts` を作成し、ESM でインポート:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
```
2) 内部関数が必要な場合は `__testables` を参照（例: `determineTimeWindow`, `buildSegments`, `assignParticipants`）。
3) HTTP/SDK 呼び出しは `mock.method` でモック、または依存注入の形にする。
4) テストは小さく独立に。巨大なデータセットよりも、狙いを絞ったフィクスチャを。

## CI の挙動

- GitHub Actions は `LOGS_JSON_PATH=__ci_no_logs__` をセットし、実ログ回帰は自動 skip。
- ビルド→テストが成功した場合のみ Docker Push を実行。

## 注意点

- `--import tsx` を使用（近年の Node では `--loader tsx` は非推奨）。
- アサーションは `node:assert/strict` を利用する。
- タイムスタンプは BigInt 精度を保つため、フィクスチャでは文字列として保持し、テスト内で BigInt/Date に変換する。
