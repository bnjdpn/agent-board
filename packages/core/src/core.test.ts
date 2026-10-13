import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import projectFixture from './__fixtures__/project.json' with { type: 'json' };
import issueFixture from './__fixtures__/issue.json' with { type: 'json' };
import { GitHubClient, moveCard, readBoard, readIssue } from './github.js';
import { cardNumberFromPrompt, findJob, listJobs, tailJob } from './jobs.js';
import { agentFor, clearRequeued, launchCard, readControl, setAgent, setDefaultAgent, setPause, setWip, withControlLock } from './control.js';
import type { Config } from './types.js';

const config: Config = {
  github: { owner: 'bnjdpn', projectNumber: 1 },
  board: { statusField: 'Status', columns: ['Idées', 'En cours', 'Terminé'], filterFields: ['Plateforme'] },
  jobs: { directory: '/tmp/<date>/<job>', adapters: [{ kind: 'transcript', pattern: '<engine>.log' }, { kind: 'jsonl', pattern: '<engine>.jsonl' }, { kind: 'plain', pattern: 'STATUS' }] }
};
const temporary: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('GitHub data', () => {
  it('maps project status and configured filter fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(projectFixture), { status: 200 })));
    const board = await readBoard(config, new GitHubClient(async () => 'test-token'));
    expect(board.items[0]).toMatchObject({ number: 254, status: 'En cours', fields: { Plateforme: 'macOS' }, kind: 'Issue' });
    expect(board.items[1]?.kind).toBe('DraftIssue');
    expect(board.filters.Plateforme).toEqual(['macOS']);
  });

  it('deduplicates linked PRs and reports their checks', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(issueFixture), { status: 200 })));
    const issue = await readIssue('bnjdpn/Studio', 254, new GitHubClient(async () => 'test-token'));
    expect(issue.comments[0]?.author).toBe('tester');
    expect(issue.pullRequests).toEqual([{ number: 7, title: 'Implement board', url: 'https://github.com/bnjdpn/agent-board/pull/7', state: 'OPEN', checks: 'SUCCESS' }]);
  });

  it('moves a card using the configured status option', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(projectFixture), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { node: { fields: { nodes: [{ id: 'field-id', name: 'Status', options: [{ id: 'option-id', name: 'Terminé' }] }] } } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'item-id' } } } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await moveCard(config, 254, 'Terminé', new GitHubClient(async () => 'test-token'));
    const mutation = JSON.parse(fetchMock.mock.calls[2]![1].body as string) as { variables: Record<string, string> };
    expect(mutation.variables).toMatchObject({ field: 'field-id', option: 'option-id' });
  });
});

describe('jobs', () => {
  it('associates a prompt card number and tails appended transcript and JSONL', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-board-test-'));
    temporary.push(root);
    const path = join(root, '2026-10-13', 'job-a');
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'prompt.md'), 'Work on carte Studio #254');
    await writeFile(join(path, 'codex.log'), 'first line\n');
    await writeFile(join(path, 'codex.jsonl'), '{"message":"hello"}\n');
    const jobsConfig = { ...config, jobs: { ...config.jobs, directory: `${root}/<date>/<job>` } };
    expect(cardNumberFromPrompt('carte Studio #254')).toBe(254);
    expect((await listJobs(jobsConfig))[0]?.cardNumber).toBe(254);
    const job = await findJob(jobsConfig, 254);
    const messages: string[] = [];
    const done = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('tail timed out')), 3000);
      const stop = tailJob(job, jobsConfig.jobs.adapters, entry => {
        messages.push(entry.text);
        if (messages.includes('first line') && messages.includes('hello') && messages.includes('second line')) {
          clearTimeout(timeout); stop(); resolve();
        }
      }, reject);
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    await writeFile(join(path, 'codex.log'), 'first line\nsecond line\n');
    await done;
  });
});

describe('pipeline controls', () => {
  it('persists partial agent overrides and scoped pauses beside the config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-board-control-'));
    temporary.push(root);
    const local = { ...config, agents: { default: { engine: 'codex' as const, model: 'gpt-6', effort: 'high' } }, control: { stateFile: join(root, 'state.json') } };
    await setDefaultAgent(local, { effort: 'medium' });
    await setAgent(local, 254, { engine: 'cursor' });
    await setPause(local, true, { card: 254 });
    await setPause(local, true, { column: 'En cours' });
    const state = await readControl(local);
    expect(agentFor(local, state, 254)).toEqual({ engine: 'cursor', model: 'gpt-6', effort: 'medium' });
    expect(agentFor(local, state, 255)).toEqual({ engine: 'codex', model: 'gpt-6', effort: 'medium' });
    expect(state.cards).toEqual([254]);
    expect(state.columns).toEqual(['En cours']);
    await setPause(local, false, { card: 254 });
    expect((await readControl(local)).cards).toEqual([]);
  });

  it('checks external hold and live WIP before launching', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-board-launch-'));
    temporary.push(root);
    const holdFile = join(root, 'FILL_HOLD');
    const local: Config = { ...config, jobs: { ...config.jobs, directory: `${root}/<date>/<job>` },
      control: { stateFile: join(root, 'state.json'), holdFile, wip: { 'En cours': 1 } },
      launcher: { command: process.execPath, args: ['-e', 'setTimeout(() => {}, 10000)'] } };
    const first = { id: 'one', number: 254, title: 'One', status: 'En cours', fields: {}, kind: 'Issue' as const };
    const second = { ...first, id: 'two', number: 255, title: 'Two' };
    await writeFile(holdFile, 'hold');
    await expect(launchCard(local, first, [first, second])).rejects.toThrow('paused');
    await setPause(local, false);
    expect((await readControl(local)).externalHold).toBe(false);
    const launched = await launchCard(local, first, [first, second]);
    try { await expect(launchCard(local, second, [first, second])).rejects.toThrow('WIP limit'); }
    finally { process.kill(launched.pid); }
    await setWip(local, 'En cours', 0);
    expect((await readControl(local)).wip['En cours']).toBe(0);
  });

  it('does not dispatch the same ready card again after its launcher exits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-board-dispatch-'));
    temporary.push(root);
    const local: Config = { ...config, jobs: { ...config.jobs, directory: `${root}/<date>/<job>` },
      control: { stateFile: join(root, 'state.json') }, launcher: { command: process.execPath, args: [] } };
    const item = { id: 'one', number: 254, title: 'One', status: 'En cours', fields: {}, kind: 'Issue' as const };
    await withControlLock(local, async state => { state.launches['254'] = { pid: 999999, column: 'En cours', startedAt: new Date().toISOString() }; });
    await expect(launchCard(local, item, [item], 'dispatch')).rejects.toThrow('already dispatched');
    await clearRequeued(local, [{ ...item, status: 'Terminé' }]);
    expect((await readControl(local)).launches['254']).toBeUndefined();
  });
});
