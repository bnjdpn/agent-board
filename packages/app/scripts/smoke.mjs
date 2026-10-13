/* global process, console */
// Smoke test: launches the packaged app with AGENT_BOARD_SMOKE=1; main exits 0 only if the preload
// bridge exists and the board (or the first-run setup) rendered without an error. Result is in main.log.
import { spawnSync } from 'node:child_process';
const binary = process.argv[2] ?? '/Applications/agent-board.app/Contents/MacOS/agent-board';
const result = spawnSync(binary, [], { env: { ...process.env, AGENT_BOARD_SMOKE: '1' }, stdio: 'inherit', timeout: 60000 });
console.log(result.status === 0 ? 'smoke: OK' : `smoke: FAILED (status ${result.status})`);
process.exit(result.status === 0 ? 0 : 1);
