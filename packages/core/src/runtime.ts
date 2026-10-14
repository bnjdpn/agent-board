import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Config, RuntimeAction, RuntimeStatus } from './types.js';

const execute = promisify(execFile);

export async function readRuntime(config: Config): Promise<RuntimeStatus | null> {
  if (!config.controller) return null;
  const { stdout } = await execute(config.controller.command, ['status', '--json'], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  const value = JSON.parse(stdout) as RuntimeStatus;
  if (!Number.isFinite(value.observed_at) || !Array.isArray(value.holds) || !Array.isArray(value.missions) || !Array.isArray(value.unknown_sources)) throw new Error('Invalid Studio Control status');
  return value;
}

export function runtimeArguments(action: RuntimeAction, issue?: number): string[] {
  if (issue !== undefined && (!Number.isSafeInteger(issue) || issue < 1)) throw new Error('Invalid issue');
  if (action === 'pause') {
    if (issue !== undefined) throw new Error('Pause is global; use stop to interrupt a mission');
    return ['pause', '--reason', 'Pause depuis agent-board'];
  }
  if (action === 'resume') return issue === undefined ? ['resume'] : ['resume', '--issue', String(issue)];
  if (action === 'stop') return issue === undefined ? ['stop', '--all'] : ['stop', '--issue', String(issue)];
  if (action === 'run' && issue === undefined) return ['run', '--once', '--max-starts', '1'];
  throw new Error('Unsupported runtime action');
}

export async function controlRuntime(config: Config, action: RuntimeAction, issue?: number): Promise<string> {
  if (!config.controller) throw new Error('No runtime controller configured');
  const args = runtimeArguments(action, issue);
  try {
    const { stdout } = await execute(config.controller.command, args, { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    return stdout.trim();
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    throw new Error(`Action non confirmée. Relire l’état avant toute nouvelle tentative.\n${failure.stdout || failure.stderr || failure.message}`);
  }
}

// A clock wake-up is not a second scheduler: the Studio selector owns admission,
// claims, priority, resource locks and completion handling.
export async function wakeRuntime(config: Config): Promise<{ state: string; reasons?: string[]; output?: string }> {
  const status = await readRuntime(config);
  if (!status) throw new Error('No runtime controller configured');
  if (status.holds.length || status.unknown_sources.length) return {
    state: 'held', reasons: [...status.holds.map(hold => hold.reason), ...status.unknown_sources]
  };
  return { state: 'checked', output: await controlRuntime(config, 'run') };
}
