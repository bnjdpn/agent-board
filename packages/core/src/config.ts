import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { Config } from './types.js';

export function expandPath(value: string): string {
  const home = homedir();
  const expanded = value.replace(/^~(?=\/|$)/, home).replace(/\$\{([A-Za-z_][A-Za-z_0-9]*)\}/g, (_, name: string) => process.env[name] ?? '');
  return isAbsolute(expanded) ? expanded : resolve(expanded);
}

export async function loadConfig(path = process.env.AGENT_BOARD_CONFIG ?? 'agent-board.config.json'): Promise<Config> {
  const configPath = expandPath(path);
  const config = JSON.parse(await readFile(configPath, 'utf8')) as Config;
  if (!config.github?.owner || !Number.isInteger(config.github.projectNumber) || config.github.projectNumber < 1) throw new Error('Invalid github.owner or github.projectNumber');
  if (!config.board?.statusField || !Array.isArray(config.board.columns) || !Array.isArray(config.board.filterFields)) throw new Error('Invalid board configuration');
  if (!config.jobs?.directory || !Array.isArray(config.jobs.adapters)) throw new Error('Invalid jobs configuration');
  for (const adapter of config.jobs.adapters) {
    if (!['transcript', 'jsonl', 'plain'].includes(adapter.kind) || !adapter.pattern || adapter.pattern.includes('/')) throw new Error('Invalid log adapter');
  }
  const settings = config.agents?.default;
  if (settings && (!['codex', 'cursor'].includes(settings.engine) || !settings.model || !settings.effort)) throw new Error('Invalid agents.default');
  for (const [column, limit] of Object.entries(config.control?.wip ?? {})) {
    if (!column || !Number.isSafeInteger(limit) || limit < 0) throw new Error(`Invalid WIP limit for ${column}`);
  }
  if (config.control) {
    const localPath = (value: string) => isAbsolute(value) || value.startsWith('~') ? expandPath(value) : resolve(dirname(configPath), value);
    config.control.stateFile = localPath(config.control.stateFile ?? 'agent-board.state.json');
    if (config.control.holdFile) config.control.holdFile = localPath(config.control.holdFile);
    if (config.control.holdFile === config.control.stateFile) throw new Error('control.holdFile must differ from control.stateFile');
  } else config.control = { stateFile: resolve(dirname(configPath), 'agent-board.state.json') };
  return config;
}
