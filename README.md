# agent-board

Open-source, cross-platform (macOS / Linux / Windows) desktop kanban for **GitHub Projects** that also shows what your **coding agents** are doing — live.

- Electron + TypeScript desktop app, plus a Node/TS `agent-board` CLI in the same monorepo (for humans and bots).
- Generic: GitHub owner/project, status columns, custom fields, jobs folder and log adapters are all configuration. Nothing team-specific is hardcoded.
- Auth: GitHub token read at runtime (`gh auth token`, `GITHUB_TOKEN`, or OS keychain). No secrets are stored in the repo.

## Roadmap
- **v0 (MVP)**: kanban of a GitHub Project v2 (columns from the Status field, filter by any single-select field); card detail (body, labels, comments, linked PRs + check status); live tail of an agent job log from a configurable jobs folder (adapters: plain transcript, JSONL, notify/status files); job ↔ card mapping by card number; CLI `board`, `show`, `tail`.
- **v1 (full-auto ready, for humans and bots)**: per-agent config (engine, model, reasoning effort; default + per card; UI + CLI); pipeline Play/Pause (global, per column, per card; `pause`/`resume`; a state file the dispatcher honours, compatible with existing hold files); live WIP limits per column enforced by the dispatcher; generated app icon (all sizes, .icns/.ico); electron-builder packages (.dmg/.zip/AppImage/NSIS); auto-update with electron-updater from GitHub Releases + release workflow on tag (unsigned for now, signing/notarization documented).
- **v1 (also)**: move cards (drag & drop + `move`), list running jobs (`jobs`), launch a job via a configurable launcher command (`launch`).
- **v2**: goals/metrics header (e.g. releases per week, MRR placeholder via plugins), notifications when a job ends, packaged releases.

## License
MIT

## Run the v0 MVP

Requires Node 22 or newer, npm, a GitHub token with Projects access, and a local `gh` login or `GITHUB_TOKEN`. The token is read at runtime. `gh auth token` can use the operating system keychain; the app never saves the token to a config file.

```sh
npm ci
npm run build
cp agent-board.config.example.json agent-board.config.json
# Edit owner, project number, fields, columns and jobs directory.
node packages/cli/dist/index.js board
node packages/cli/dist/index.js board --status "In Progress" --field Platform=macOS --json
node packages/cli/dist/index.js show 254
node packages/cli/dist/index.js tail 254
npm run dev
```

The CLI package exposes the `agent-board` binary. In the workspace, `npm exec --workspace @agent-board/cli -- agent-board --config ../../agent-board.config.json board` invokes it from the CLI package directory. The config path defaults to `agent-board.config.json` in the current directory. Set `AGENT_BOARD_CONFIG` for the desktop app, or pass `--config FILE` to the CLI. A portable Studio sample is in [`examples/studio/agent-board.config.json`](examples/studio/agent-board.config.json); it uses `~` rather than a machine-specific path. Keep private overrides in ignored `*.local.json` files.

The jobs directory must end with `<date>/<job>`, for example `~/agent-jobs/<date>/<job>`. Date folders use `YYYY-MM-DD`. Each job can include `prompt.md`, `<engine>.log`, `<engine>.jsonl`, `notify.log`, `STATUS`, and `RESULT*`; adapters and the prompt card-number pattern are configurable. The newest matching job is shown beside its card. The live reader uses filesystem notifications and incremental reads, with a periodic fallback for filesystems that miss notifications.

`move`, `jobs`, and `launch` are explicit v1 stubs. The `launcher` config records a future command but v0 never runs it. Release and MRR figures in the desktop header are placeholders.

## Development

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

The Electron renderer runs with `contextIsolation`, sandboxing, and no Node integration. Only the small typed preload API can reach GitHub and the jobs folder through the main process. The app opens external links only on `github.com`.
