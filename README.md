# Discord FF14 Log Summary Bot (PoC)

PoC Discord bot that queries Loki for FFXIV network logs and returns a daily summary via a `/test` slash command. Implemented with Node.js 22, TypeScript, and discord.js.

## Prerequisites

- Node.js 22+
- Yarn 1 (installed via Corepack or standalone)
- Discord bot application with a guild to register commands

## Getting Started

1. Install dependencies:

   ```bash
yarn install
   ```

2. Copy the env template and fill in your Discord credentialsと Loki 接続情報:

   ```bash
cp .env.example .env
# edit .env to set DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, LOKI_BASE_URL, LOKI_QUERY, LOKI_QUERY_FILTER
   ```

3. Register the slash command (guild-scoped for faster propagation):

   ```bash
yarn deploy:commands
   ```

4. Start the bot locally（`/test` 実行時に Loki のログを都度取得）:

   ```bash
yarn dev
   ```

   Alternatively, build and run the compiled output:

   ```bash
yarn build
yarn start
   ```

## Docker Usage

```bash
docker build -t ff14-log-bot .
docker run \
  --env-file .env \
  ff14-log-bot
```

## GitHub Actions

- **Build and Push Docker Image (`.github/workflows/ci.yml`)** — runs when a `v*` tag is pushed; builds and pushes `ghcr.io/<repo>:<version>` and `:latest`.
- **Deploy Slash Commands (`.github/workflows/deploy-commands.yml`)** — triggered after the Docker workflow succeeds; checks out the release commit and runs `yarn deploy:commands` using the Discord credentials in repository secrets.
- **Release (`.github/workflows/release.yml`)** — manual trigger; selects `patch`/`minor`/`major`, runs `yarn release` (powered by `standard-version`), pushes the version bump commit & tag, then drafts a GitHub Release. Set any additional secrets (e.g. `NPM_TOKEN`) before publishing to external registries.

### Releasing locally

1. Ensure commits follow Conventional Commits.
2. Husky hooks will automatically run `yarn release && git push --follow-tags --no-verify` on `git push`. To run manually, execute `yarn release` (optionally with `--release-as <type>`).
3. Once the tag is pushed (automatically or manually), the Docker workflow builds/pushes the image and the Deploy workflow updates slash commands.

## Kubernetes Deployment (example)

Manifests are provided under `k8s/manifests/`:

- `configmap.yaml` — non-secret environment settings (Loki connection, etc.)
- `secret.example.yaml` — copy to `secret.yaml`, populate Discord credentials, and apply as a Secret
- `deployment.yaml` — single-replica Deployment referencing the GHCR image (`ghcr.io/<owner>/<repo>:latest` by default)
  - expects a pre-created imagePullSecret named `ghcr-pull` for private GHCR access
- `cronjob.yaml` — runs the daily summary sender (`node dist/jobs/dailySummary.js`) every day at 10:00 JST

```bash
kubectl apply -f k8s/manifests/configmap.yaml
kubectl apply -f k8s/manifests/secret.yaml   # created from secret.example.yaml
kubectl apply -f k8s/manifests/deployment.yaml
kubectl apply -f k8s/manifests/cronjob.yaml
```

Adjust `namespace`, image tag, and resource requests/limits as needed for your cluster.

## Slash Command Behaviour

- `/test` (optional `date` argument in `YYYY-MM-DD` format)
  - Queries Loki with the configured label selector (default `{content="ffxiv", instance="DESKTOP-LHEGLIC", job="ffxiv-dungeon"}`) and regex filter (`攻略を(開始|終了)した。`)
  - Pairs start/end entries such as `「王城旧跡 アンダーキープ」の攻略を開始した。`
  - Returns a summary for the requested date (default: previous day in JST)
  - Flags unmatched start or end entries in the response

## Notes & Next Steps

- The parser assumes timestamps are in JST (`Asia/Tokyo`). Adjust the formatter if your log timestamps use a different offset.
- Extend by wiring into Kubernetes CronJobs or adjusting the Loki query window to match production needs.
- Add automated tests around the parser when transitioning beyond PoC.
