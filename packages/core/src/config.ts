import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import type { Config } from './types.js';

export function expandPath(value: string): string {
  const home = homedir();
  const expanded = value.replace(/^~(?=\/|$)/, home).replace(/\$\{([A-Za-z_][A-Za-z_0-9]*)\}/g, (_, name: string) => process.env[name] ?? '');
  return isAbsolute(expanded) ? expanded : resolve(expanded);
}

export async function loadConfig(path = process.env.AGENT_BOARD_CONFIG ?? 'agent-board.config.json'): Promise<Config> {
  const config = JSON.parse(await readFile(expandPath(path), 'utf8')) as Config;
  if (!config.github?.owner || !Number.isInteger(config.github.projectNumber) || config.github.projectNumber < 1) throw new Error('Invalid github.owner or github.projectNumber');
  if (!config.board?.statusField || !Array.isArray(config.board.columns) || !Array.isArray(config.board.filterFields)) throw new Error('Invalid board configuration');
  if (!config.jobs?.directory || !Array.isArray(config.jobs.adapters)) throw new Error('Invalid jobs configuration');
  for (const adapter of config.jobs.adapters) {
    if (!['transcript', 'jsonl', 'plain'].includes(adapter.kind) || !adapter.pattern || adapter.pattern.includes('/')) throw new Error('Invalid log adapter');
  }
  return config;
}
