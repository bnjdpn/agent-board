import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readRuntime, controlRuntime, runtimeArguments, wakeRuntime } from './runtime.js';
import { setPause, setAgent, launchCard } from './control.js';
import type { Config } from './types.js';

const base: Config = { github: { owner: 'test', projectNumber: 1 }, board: { statusField: 'Status', columns: ['Prêt'], filterFields: [] }, jobs: { directory: '/tmp/<date>/<job>', adapters: [] } };

describe('single runtime authority', () => {
  it('does not erase a safety hold or write local overrides in managed mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runtime-test-'));
    try {
      const hold = join(root, 'hold');
      await writeFile(hold, 'safety hold');
      const config: Config = { ...base, controller: { kind: 'studio', command: '/does/not/exist' }, control: { holdFile: hold, stateFile: join(root, 'state.json') }, launcher: { command: '/does/not/exist', args: [] } };
      await expect(setPause(config, false)).rejects.toThrow('Managed by Studio Control');
      await expect(setAgent(config, 1, { engine: 'cursor' })).rejects.toThrow('Managed by Studio Control');
      await expect(launchCard(config, { id: 'a', number: 1, title: 'a', status: 'Prêt', fields: {}, kind: 'Issue' }, [])).rejects.toThrow('Managed by Studio Control');
      expect(await readFile(hold, 'utf8')).toBe('safety hold');
      await expect(readFile(join(root, 'state.json'))).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('uses only supported bounded commands', () => {
    expect(runtimeArguments('stop', 7)).toEqual(['stop', '--issue', '7']);
    expect(runtimeArguments('resume', 7)).toEqual(['resume', '--issue', '7']);
    expect(runtimeArguments('stop')).toEqual(['stop', '--all']);
    expect(runtimeArguments('run')).toEqual(['run', '--once', '--max-starts', '1']);
    expect(() => runtimeArguments('pause', 7)).toThrow();
    expect(() => runtimeArguments('stop', -1)).toThrow();
    expect(() => runtimeArguments('run', 7)).toThrow();
    expect(() => runtimeArguments('arbitrary' as 'stop')).toThrow();
  });

  it('reads real child output and preserves refusal without falling back or retrying', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runtime-cli-'));
    try {
      const script = join(root, 'controller');
      const marker = join(root, 'calls');
      await writeFile(script, `#!/bin/sh\nif [ "$1" = "status" ]; then\n echo '{"observed_at":1,"holds":[{"kind":"safety","reason":"NO-GO"}],"missions":[],"unknown_sources":[],"registered_jobs_count":0}'\nelse\n echo once >> '${marker}'\n echo 'security hold retained'\n exit 75\nfi\n`, { mode: 0o700 });
      const config: Config = { ...base, controller: { kind: 'studio', command: script } };
      expect((await readRuntime(config))?.holds[0]?.reason).toBe('NO-GO');
      expect(await wakeRuntime(config)).toEqual({ state: 'held', reasons: ['NO-GO'] });
      await expect(controlRuntime(config, 'run')).rejects.toThrow('Départ bloqué');
      await expect(readFile(marker)).rejects.toThrow();
      await expect(controlRuntime(config, 'resume')).rejects.toThrow('security hold retained');
      expect((await readFile(marker, 'utf8')).trim()).toBe('once');
      await writeFile(script, `#!/bin/sh\necho '{"observed_at":1,"holds":[],"missions":[],"unknown_sources":["board"]}'\nexit 1\n`, { mode: 0o700 });
      expect(await wakeRuntime(config)).toEqual({ state: 'held', reasons: ['board'] });
      await expect(controlRuntime(config, 'run')).rejects.toThrow('Départ bloqué');
      await writeFile(script, '#!/bin/sh\necho invalid\n', { mode: 0o700 });
      await expect(readRuntime(config)).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
