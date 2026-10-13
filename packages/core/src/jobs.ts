import { watch, type FSWatcher } from 'node:fs';
import { open, readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { expandPath } from './config.js';
import type { Config, Job, LogAdapter, LogEntry } from './types.js';

function rootDirectory(pattern: string): string {
  const marker = pattern.indexOf('<date>');
  if (marker < 0 || !pattern.includes('<job>')) throw new Error('jobs.directory must contain <date>/<job>');
  if (!/^\/?<job>\/?$/.test(pattern.slice(marker + '<date>'.length))) throw new Error('jobs.directory must end in <date>/<job>');
  return expandPath(pattern.slice(0, marker).replace(/\/$/, ''));
}

export function cardNumberFromPrompt(prompt: string, pattern?: string): number | undefined {
  const expression = new RegExp(pattern ?? '(?:card|carte|issue)(?:\\s+[A-Za-z][\\w-]*)?\\s*#?(\\d+)|#(\\d+)', 'i');
  const match = prompt.match(expression);
  const number = Number(match?.[1] ?? match?.[2]);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

export async function listJobs(config: Config): Promise<Job[]> {
  const root = rootDirectory(config.jobs.directory);
  const jobs: Job[] = [];
  let dates: string[];
  try { dates = await readdir(root); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  for (const date of dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const datePath = join(root, date);
    if (!(await stat(datePath)).isDirectory()) continue;
    for (const jobName of await readdir(datePath)) {
      const path = join(datePath, jobName);
      const info = await stat(path);
      if (!info.isDirectory()) continue;
      let prompt = '';
      try { prompt = await readFile(join(path, 'prompt.md'), 'utf8'); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      jobs.push({ id: `${date}/${jobName}`, path, cardNumber: cardNumberFromPrompt(prompt, config.jobs.cardPattern), modifiedAt: info.mtimeMs });
    }
  }
  return jobs.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export async function findJob(config: Config, identifier: string | number): Promise<Job> {
  const jobs = await listJobs(config);
  const match = typeof identifier === 'number' || /^\d+$/.test(identifier)
    ? jobs.find(job => job.cardNumber === Number(identifier))
    : jobs.find(job => job.id === identifier || basename(job.path) === identifier);
  if (!match) throw new Error(`Job ${identifier} not found`);
  return match;
}

function matches(pattern: string, name: string): boolean {
  const regex = '^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/<engine>|\\\*/g, '[^/]*') + '$';
  return new RegExp(regex).test(name);
}

function decode(kind: LogAdapter['kind'], line: string): string {
  if (kind !== 'jsonl') return line;
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null) {
      const record = value as Record<string, unknown>;
      for (const key of ['message', 'text', 'content', 'result']) if (typeof record[key] === 'string') return record[key];
    }
    return JSON.stringify(value);
  } catch { return line; }
}

export function tailJob(job: Job, adapters: LogAdapter[], onEntry: (entry: LogEntry) => void, onError: (error: Error) => void = () => {}): () => void {
  const offsets = new Map<string, { offset: number; pending: string; decoder: StringDecoder }>();
  let closed = false;
  let scanning = false;
  let rerun = false;
  const scan = async () => {
    if (scanning) { rerun = true; return; }
    scanning = true;
    try {
      do {
        rerun = false;
        const names = await readdir(job.path);
        for (const adapter of adapters) for (const name of names.filter(name => matches(adapter.pattern, name))) {
          const path = join(job.path, name);
          const info = await stat(path);
          if (!info.isFile()) continue;
          let state = offsets.get(path);
          if (!state || info.size < state.offset) {
            state = { offset: 0, pending: '', decoder: new StringDecoder('utf8') };
            offsets.set(path, state);
          }
          if (info.size === state.offset) continue;
          const handle = await open(path, 'r');
          try {
            const length = info.size - state.offset;
            const buffer = Buffer.alloc(length);
            const { bytesRead } = await handle.read(buffer, 0, length, state.offset);
            state.offset += bytesRead;
            const chunk = state.decoder.write(buffer.subarray(0, bytesRead));
            if (adapter.pattern === 'STATUS' || adapter.pattern.startsWith('RESULT')) {
              if (chunk.trim()) onEntry({ file: name, text: chunk.trimEnd() });
              continue;
            }
            const lines = (state.pending + chunk).split(/\r?\n/);
            state.pending = lines.pop() ?? '';
            for (const line of lines) if (line) onEntry({ file: name, text: decode(adapter.kind, line) });
          } finally { await handle.close(); }
        }
      } while (rerun && !closed);
    } catch (error) { if (!closed) onError(error as Error); }
    finally { scanning = false; }
  };
  let watcher: FSWatcher | undefined;
  try { watcher = watch(job.path, () => { void scan(); }); }
  catch (error) { onError(error as Error); }
  const interval = setInterval(() => { void scan(); }, 1000);
  void scan();
  return () => { closed = true; watcher?.close(); clearInterval(interval); };
}

export function jobName(job: Job): string { return `${basename(dirname(job.path))}/${basename(job.path)}`; }
