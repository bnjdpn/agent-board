# agent-board

Open-source, cross-platform (macOS / Linux / Windows) desktop kanban for **GitHub Projects** that also shows what your **coding agents** are doing — live.

- Electron + TypeScript desktop app, plus a Node/TS `agent-board` CLI in the same monorepo (for humans and bots).
- Generic: GitHub owner/project, status columns, custom fields, jobs folder and log adapters are all configuration. Nothing team-specific is hardcoded.
- Auth: GitHub token read at runtime (`gh auth token`, `GITHUB_TOKEN`, or OS keychain). No secrets are stored in the repo.

## Roadmap
- **v0 (MVP)**: kanban of a GitHub Project v2 (columns from the Status field, filter by any single-select field); card detail (body, labels, comments, linked PRs + check status); live tail of an agent job log from a configurable jobs folder (adapters: plain transcript, JSONL, notify/status files); job ↔ card mapping by card number; CLI `board`, `show`, `tail`.
- **v1**: move cards (drag & drop + `move`), list running jobs (`jobs`), launch a job via a configurable launcher command (`launch`).
- **v2**: goals/metrics header (e.g. releases per week, MRR placeholder via plugins), notifications when a job ends, packaged releases.

## License
MIT
