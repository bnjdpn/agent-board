import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { AgentSettings, BoardItem, Config, ControlState } from './types.js';
import { listJobs } from './jobs.js';

const empty = (): ControlState => ({ paused: false, columns: [], cards: [], agents: {}, wip: {}, launches: {}, externalHold: false });
const statePath = (config: Config): string => config.control?.stateFile ?? 'agent-board.state.json';

export async function readControl(config: Config): Promise<ControlState> {
  let raw: Partial<ControlState> = {};
  try {
    const text = await readFile(statePath(config), 'utf8');
    try { raw = JSON.parse(text) as Partial<ControlState> ?? {}; }
    catch { raw = { paused: true }; } // An existing plain hold file is a global pause.
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return { ...empty(), ...raw, columns: raw.columns ?? [], cards: raw.cards ?? [], agents: raw.agents ?? {}, wip: raw.wip ?? {}, launches: raw.launches ?? {}, externalHold: !!config.control?.holdFile && existsSync(config.control.holdFile) };
}

async function saveControl(config: Config, state: ControlState): Promise<void> {
  const path = statePath(config);
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  const { externalHold: _externalHold, ...persisted } = state;
  void _externalHold;
  await writeFile(temp, JSON.stringify(persisted, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, path);
}

export async function withControlLock<T>(config: Config, update: (state: ControlState) => Promise<T>): Promise<T> {
  if (config.controller) throw new Error('Managed by Studio Control: use runtime controls. Local overrides are disabled.');
  const lock = `${statePath(config)}.lock`;
  await mkdir(dirname(lock), { recursive: true });
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await mkdir(lock); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const age = Date.now() - (await stat(lock)).mtimeMs;
      if (age > 30_000) { await rm(lock, { recursive: true, force: true }); continue; }
      if (attempt === 59) throw new Error('Control state is busy');
      await delay(100);
    }
  }
  try {
    const state = await readControl(config);
    const result = await update(state);
    await saveControl(config, state);
    return result;
  } finally { await rm(lock, { recursive: true, force: true }); }
}

export async function setPause(config: Config, paused: boolean, target?: { column?: string; card?: number }): Promise<ControlState> {
  return withControlLock(config, async state => {
    if (target?.column) state.columns = [...new Set(paused ? [...state.columns, target.column] : state.columns.filter(value => value !== target.column))];
    else if (target?.card) state.cards = [...new Set(paused ? [...state.cards, target.card] : state.cards.filter(value => value !== target.card))];
    else {
      state.paused = paused;
      if (config.control?.holdFile) {
        if (paused && !existsSync(config.control.holdFile)) {
          await mkdir(dirname(config.control.holdFile), { recursive: true });
          await writeFile(config.control.holdFile, 'agent-board paused\n', { mode: 0o600 });
        }
        if (!paused) await rm(config.control.holdFile, { force: true });
        state.externalHold = paused;
      }
    }
    return state;
  });
}

export async function setAgent(config: Config, card: number, patch: Partial<AgentSettings>): Promise<AgentSettings> {
  return withControlLock(config, async state => {
    const next = mergeAgent(agentFor(config, state, card), patch);
    state.agents[String(card)] = next;
    return next;
  });
}

function mergeAgent(base: AgentSettings, patch: Partial<AgentSettings>): AgentSettings {
  const next = { ...base };
  if (patch.engine !== undefined) next.engine = patch.engine;
  if (patch.model !== undefined) next.model = patch.model;
  if (patch.effort !== undefined) next.effort = patch.effort;
  if (!['codex', 'cursor'].includes(next.engine) || !next.model || !next.effort) throw new Error('Engine, model and effort are required');
  return next;
}

export async function setDefaultAgent(config: Config, patch: Partial<AgentSettings>): Promise<AgentSettings> {
  return withControlLock(config, async state => {
    const next = mergeAgent(state.defaultAgent ?? config.agents?.default ?? { engine: 'codex', model: 'default', effort: 'medium' }, patch);
    state.defaultAgent = next;
    return next;
  });
}

export function agentFor(config: Config, state: ControlState, card: number): AgentSettings {
  return state.agents[String(card)] ?? state.defaultAgent ?? config.agents?.default ?? { engine: 'codex', model: 'default', effort: 'medium' };
}

export async function setWip(config: Config, column: string, limit: number): Promise<void> {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('WIP limit must be a nonnegative integer');
  await withControlLock(config, async state => { state.wip[column] = limit; });
}

function alive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function isPaused(state: ControlState, item: BoardItem): boolean {
  return state.paused || state.externalHold || state.columns.includes(item.status) || (item.number !== undefined && state.cards.includes(item.number));
}

export async function activeCards(config: Config, state: ControlState): Promise<Set<number>> {
  const active = new Set<number>();
  for (const [number, launch] of Object.entries(state.launches)) {
    if (alive(launch.pid)) active.add(Number(number));
  }
  for (const job of await listJobs(config)) {
    if (!job.cardNumber) continue;
    let status = '';
    try { status = (await readFile(`${job.path}/STATUS`, 'utf8')).trim().toUpperCase(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const finished = (await readdir(job.path)).some(name => name === 'RESULT' || name.startsWith('RESULT.'));
    if (!finished && ['RUNNING', 'IN_PROGRESS', 'ACTIVE', 'STARTED'].includes(status)) active.add(job.cardNumber);
  }
  return active;
}

export function wipLimit(config: Config, state: ControlState, column: string): number {
  return state.wip[column] ?? config.control?.wip?.[column] ?? Number.POSITIVE_INFINITY;
}

export async function clearRequeued(config: Config, items: BoardItem[]): Promise<void> {
  await withControlLock(config, async state => {
    const active = await activeCards(config, state);
    for (const [number, launch] of Object.entries(state.launches)) {
      const current = items.find(item => item.number === Number(number));
      if (!active.has(Number(number)) && current?.status !== launch.column) delete state.launches[number];
    }
  });
}

export async function launchCard(config: Config, item: BoardItem, boardItems: BoardItem[], mode: 'manual' | 'dispatch' = 'manual'): Promise<{ pid: number; settings: AgentSettings }> {
  if (!item.number) throw new Error('Only numbered cards can be launched');
  if (!config.launcher?.command) throw new Error('Configure launcher.command before launching');
  return withControlLock(config, async state => {
    if (isPaused(state, item)) throw new Error(`Card #${item.number} is paused`);
    const active = await activeCards(config, state);
    if (active.has(item.number!)) throw new Error(`Card #${item.number} already has an active job`);
    const column = item.status;
    if (mode === 'dispatch' && state.launches[String(item.number)]?.column === column) throw new Error(`Card #${item.number} was already dispatched in ${column}`);
    const count = boardItems.filter(candidate => candidate.status === column && candidate.number && active.has(candidate.number)).length;
    if (count >= wipLimit(config, state, column)) throw new Error(`WIP limit reached in ${column}`);
    const settings = agentFor(config, state, item.number!);
    const vars: Record<string, string> = { card: String(item.number), column, repository: item.repository ?? '', engine: settings.engine, model: settings.model, effort: settings.effort, url: item.url ?? '' };
    const replace = (input: string) => input.replace(/<([a-z]+)>/g, (match, key: string) => vars[key] ?? match);
    const child = spawn(replace(config.launcher!.command), config.launcher!.args.map(replace), { detached: true, stdio: 'ignore', shell: false });
    const pid = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('spawn', () => resolve(child.pid!));
    });
    child.unref();
    state.launches[String(item.number)] = { pid, column, startedAt: new Date().toISOString() };
    return { pid, settings };
  });
}
