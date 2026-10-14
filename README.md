# agent-board

MIT licensed desktop kanban for GitHub Projects with live coding-agent logs and a CLI for humans and dispatchers. Built with Electron, TypeScript, and Node 22+.

## Features

- GitHub Project v2 columns, filters, issue detail, linked PRs/checks, drag-and-drop moves, and CLI `move`.
- Local job discovery and live transcript/JSONL tailing. Job association uses the card number in `prompt.md`.
- Editable default and per-card engine (`codex` or `cursor`), model, and reasoning effort. The CLI and app edit the same state file.
- Global, column, and card Play/Pause. A configurable external hold file such as `FILL_HOLD` also pauses every launch.
- Live per-column WIP limits, enforced under a state-file lock by `launch` and `dispatch`.
- Configurable launcher command with `<card>`, `<column>`, `<repository>`, `<url>`, `<engine>`, `<model>`, and `<effort>` substitutions. `dispatch` walks configured ready columns and launches eligible cards.

## Configure

```sh
npm ci
npm run build
cp agent-board.config.example.json agent-board.config.json
# Edit GitHub owner/project, columns, jobs directory, and launcher.
```

`agent-board.config.example.json` contains portable paths and no credentials. Set `GITHUB_TOKEN` or log in with `gh auth login`; the token is read at runtime. For the installed app, place the config at the app's user-data directory as `agent-board.config.json`, or set `AGENT_BOARD_CONFIG` to its path. On macOS this directory is under `~/Library/Application Support/agent-board/`. Private overrides can use ignored `*.local.json` files.

`control.stateFile` is resolved relative to the config file. It stores pauses, per-card assignments, WIP overrides, and launch PIDs; keep it local and writable by the dispatcher. `control.holdFile` is optional. Its **presence** pauses all launches, including when the state says Play. Global `pause` creates it and global `resume` removes it, so a legacy dispatcher that checks for a file such as `FILL_HOLD` follows the same global control. Scoped pauses change only the JSON state. If `stateFile` itself contains legacy plain text, it is read as a global pause and replaced with JSON on the next edit. A launcher must stay alive for its job duration so its PID gives the dispatcher an accurate WIP count. Jobs with `STATUS` equal to `RUNNING`, `IN_PROGRESS`, `ACTIVE`, or `STARTED` also count as active unless a `RESULT` file exists. The launcher should update these files for external jobs.

The launcher runs without a shell and receives configured arguments, so place flags and placeholders in separate `args` entries. Set `control.readyColumns` before using `dispatch`. Run `dispatch --watch` for continuous dequeueing, or invoke one-shot `dispatch` from an existing bot or scheduler. The state lock serializes concurrent CLI/app launches.
The dispatcher records a card after launching it and will not launch it again while it stays in the same column, even after its process exits. Once the dispatcher observes the card in another column, moving it back makes it eligible again; an explicit `launch` can retry a stopped card.

## CLI

```sh
node packages/cli/dist/index.js board --json
node packages/cli/dist/index.js show 254
node packages/cli/dist/index.js jobs
node packages/cli/dist/index.js jobs --all
node packages/cli/dist/index.js tail 254
node packages/cli/dist/index.js move 254 "In Progress"
node packages/cli/dist/index.js agent set 254 --engine cursor --model example-model --effort high
node packages/cli/dist/index.js agent set default --engine codex --model example-model --effort medium
node packages/cli/dist/index.js pause
node packages/cli/dist/index.js resume --column "In Progress"
node packages/cli/dist/index.js pause --card 254
node packages/cli/dist/index.js wip set "In Progress" 2
node packages/cli/dist/index.js launch 254
node packages/cli/dist/index.js dispatch
node packages/cli/dist/index.js dispatch --watch --interval-ms 10000
```

Use `--config FILE` before the command or set `AGENT_BOARD_CONFIG`. `launch` and `dispatch` consult the current board, state, external hold, active jobs, and WIP limit immediately before spawning.

## Development and packaging

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run dev
npm run dist:mac -w @agent-board/app
```

The app uses a sandboxed renderer with context isolation and a narrow preload bridge. It opens external links only on `github.com`. The app icon source is generated raster artwork in `packages/app/build/icon-source.png`; the iconset, ICNS, PNG, and ICO are committed for reproducible packaging. The local macOS command writes a `.dmg` and `.zip` under `out/` and never publishes. It does not sign or notarize the app.

The tag-only `.github/workflows/release.yml` builds macOS assets and attaches them to GitHub Releases. No release is created by this repository change. `electron-updater` is wired to the GitHub provider and checks packaged macOS builds, with the required ZIP update feed. **macOS auto-update cannot successfully install updates until the app is code signed.** Before a production tag, configure a Developer ID Application certificate in CI, enable hardened runtime, notarize/staple the app, and verify an installed older build updates from a test GitHub Release. Keep signing credentials in GitHub secrets. See [electron-builder auto-update](https://www.electron.build/auto-update/) and [macOS packaging](https://www.electron.build/mac/).

## License

MIT

## Studio Control integration

For Studio, use `examples/studio/agent-board.config.json`. The optional
`controller: { "kind": "studio", "command": "~/.local/bin/studio" }` delegates
operator actions to the installed Studio CLI. The console displays live process
observations and suspension reasons. Pause stops admissions; Stop interrupts
owned missions; Resume reconciles state and preserves security holds. Resume
does not launch a job. “Execute next ticket” asks the existing selector for one
bounded admission. This version does not install a background dispatcher.

With a controller configured, local agent overrides, WIP, dragging cards and
legacy launch/dispatch/pause mutations are disabled. The controller and GitHub
remain authoritative; no second execution queue is created. A failed action is
reported as unconfirmed and is never retried automatically.

CLI: `agent-board --config FILE runtime status`, `runtime pause`, `runtime stop
--card 123`, `runtime resume --card 123`, `runtime run`. Read-only status invokes
no model. Existing standalone configurations retain their original behavior.

### Optional Mac wake-up

`python3 scripts/install-studio-wakeup.py` previews installation;
`--install` installs one launchd wake-up every 60 seconds and at login.
It copies the built controller adapter, never calls an LLM for observation,
and asks the existing Studio selector for at most one admission when no hold
is present. Completion handling remains in Studio. It runs with the app closed.
The current Studio security/operator holds are preserved. A failed or ambiguous
invocation latches `attention.json` and prevents automatic retries; diagnose the
cause and reconcile Studio before removing that file. `heartbeat.json` records
the latest result in `~/Library/Application Support/agent-board/studio-runtime/`.
Uninstall with `launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/dev.agentboard.studio-wakeup.plist`
and then remove that exact plist; retain the runtime directory for diagnosis.
No service is installed by building or launching the GUI.
