import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import projectFixture from './__fixtures__/project.json' with { type: 'json' };
import issueFixture from './__fixtures__/issue.json' with { type: 'json' };
import { GitHubClient, readBoard, readIssue } from './github.js';
import { cardNumberFromPrompt, findJob, listJobs, tailJob } from './jobs.js';
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
