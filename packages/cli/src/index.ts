#!/usr/bin/env node
import { setTimeout as delay } from 'node:timers/promises';
import { activeCards, agentFor, clearRequeued, findJob, launchCard, listJobs, loadConfig, moveCard, readBoard, readControl, setAgent, setDefaultAgent, setPause, setWip, showCard, tailJob, type BoardItem } from '@agent-board/core';

function option(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function usage(): never {
  throw new Error('Usage: agent-board [--config FILE] board | show N | tail N | jobs [--all] | move N COLUMN | agent set N|default [--engine codex|cursor] [--model X] [--effort X] | pause|resume [--column X|--card N] | wip set COLUMN LIMIT | launch N | dispatch [--watch] [--interval-ms N]');
}

function cardNumber(value: string | undefined): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) usage();
  return number;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write('Usage: agent-board [--config FILE] board | show N | tail N | jobs [--all] | move N COLUMN | agent set N|default [--engine codex|cursor] [--model X] [--effort X] | pause|resume [--column X|--card N] | wip set COLUMN LIMIT | launch N | dispatch [--watch] [--interval-ms N]\n');
    return;
  }
  const configPath = option(args, '--config');
  if (configPath) args.splice(args.indexOf('--config'), 2);
  const command = args.shift() ?? 'board';
  const config = await loadConfig(configPath);
  if (command === 'move') {
    const number = cardNumber(args.shift());
    const column = args.join(' ');
    if (!column) usage();
    await moveCard(config, number, column);
    process.stdout.write(`Moved #${number} to ${column}\n`);
    return;
  }
  if (command === 'pause' || command === 'resume') {
    const column = option(args, '--column');
    const card = option(args, '--card');
    if (column && card) throw new Error('Choose --column or --card');
    const state = await setPause(config, command === 'pause', { column, card: card ? cardNumber(card) : undefined });
    process.stdout.write(JSON.stringify({ paused: state.paused, columns: state.columns, cards: state.cards, externalHold: state.externalHold }) + '\n');
    return;
  }
  if (command === 'agent') {
    if (args.shift() !== 'set') usage();
    const target = args.shift();
    const card = target === 'default' ? undefined : cardNumber(target);
    const engine = option(args, '--engine');
    const model = option(args, '--model');
    const effort = option(args, '--effort');
    if (!engine && !model && !effort) usage();
    if (engine && engine !== 'codex' && engine !== 'cursor') throw new Error('Engine must be codex or cursor');
    const patch = { engine: engine as 'codex' | 'cursor' | undefined, model, effort };
    const settings = card ? await setAgent(config, card, patch) : await setDefaultAgent(config, patch);
    process.stdout.write(`${card ? `#${card}` : 'default'} ${JSON.stringify(settings)}\n`);
    return;
  }
  if (command === 'wip') {
    if (args.shift() !== 'set') usage();
    const column = args.shift();
    const limit = Number(args.shift());
    if (!column) usage();
    await setWip(config, column, limit);
    process.stdout.write(`${column}: ${limit}\n`);
    return;
  }
  if (command === 'jobs') {
    const state = await readControl(config);
    const active = await activeCards(config, state);
    const jobs = (await listJobs(config)).filter(job => args.includes('--all') || (job.cardNumber && active.has(job.cardNumber)));
    if (args.includes('--json')) process.stdout.write(JSON.stringify(jobs, null, 2) + '\n');
    else for (const job of jobs) process.stdout.write(`${job.id} ${job.cardNumber ? `#${job.cardNumber}` : 'unassigned'}\n`);
    if (!args.includes('--all')) for (const [number, launch] of Object.entries(state.launches)) {
      if (active.has(Number(number)) && !jobs.some(job => job.cardNumber === Number(number))) process.stdout.write(`#${number} pid=${launch.pid} [launcher]\n`);
    }
    return;
  }
  if (command === 'launch' || command === 'dispatch') {
    if (command === 'launch') {
      const board = await readBoard(config);
      const number = cardNumber(args[0]);
      const item = board.items.find(candidate => candidate.number === number);
      if (!item) throw new Error(`Card #${number} not found on project`);
      const launched = await launchCard(config, item, board.items);
      process.stdout.write(`Launched #${number} pid=${launched.pid} ${JSON.stringify(launched.settings)}\n`);
    } else {
      const ready = config.control?.readyColumns ?? [];
      if (!ready.length) throw new Error('Configure control.readyColumns before dispatch');
      const interval = Number(option(args, '--interval-ms') ?? 10_000);
      if (!Number.isSafeInteger(interval) || interval < 1000) throw new Error('--interval-ms must be at least 1000');
      const watch = args.includes('--watch');
      let stopping = false;
      process.once('SIGINT', () => { stopping = true; });
      process.once('SIGTERM', () => { stopping = true; });
      do {
        try {
          const board = await readBoard(config);
          await clearRequeued(config, board.items);
          let launched = 0;
          for (const item of board.items.filter(candidate => candidate.number && ready.includes(candidate.status))) {
            try {
              const result = await launchCard(config, item, board.items, 'dispatch');
              process.stdout.write(`Launched #${item.number} pid=${result.pid}\n`);
              launched++;
            } catch (error) {
              if (!watch) process.stderr.write(`Skipped #${item.number}: ${(error as Error).message}\n`);
            }
          }
          if (!watch || launched) process.stdout.write(`Dispatch launched ${launched} job(s)\n`);
        } catch (error) {
          if (!watch) throw error;
          process.stderr.write(`Dispatch retry: ${(error as Error).message}\n`);
        }
        if (watch && !stopping) await delay(interval);
      } while (watch && !stopping);
    }
    return;
  }
  if (!['board', 'show', 'tail'].includes(command)) usage();
  if (command === 'board') {
    const status = option(args, '--status');
    const field = option(args, '--field');
    let fieldName: string | undefined;
    let fieldValue: string | undefined;
    if (field) {
      const separator = field.indexOf('=');
      if (separator < 1 || separator === field.length - 1) throw new Error('--field must be K=V');
      fieldName = field.slice(0, separator);
      fieldValue = field.slice(separator + 1);
    }
    const board = await readBoard(config);
    const state = await readControl(config);
    const active = await activeCards(config, state);
    const items = board.items.filter(item => (!status || item.status === status) && (!fieldName || item.fields[fieldName] === fieldValue));
    if (args.includes('--json')) { process.stdout.write(JSON.stringify({ ...board, items, control: state, activeCards: [...active] }, null, 2) + '\n'); return; }
    process.stdout.write(`${board.title} (${items.length} cards)\n`);
    for (const column of board.columns) {
      process.stdout.write(`\n${column}\n`);
      for (const item of items.filter((item: BoardItem) => item.status === column)) process.stdout.write(`  ${item.number ? `#${item.number}` : 'draft'} ${item.title}${item.number ? ` [${agentFor(config, state, item.number).engine}${active.has(item.number) ? ', active' : ''}]` : ''}\n`);
    }
    for (const item of items.filter(item => !item.status)) process.stdout.write(`  [No status] ${item.number ? `#${item.number}` : 'draft'} ${item.title}\n`);
    return;
  }
  const target = args[0];
  if (!target) usage();
  if (command === 'show') {
    const number = Number(target);
    if (!Number.isSafeInteger(number) || number < 1) usage();
    const detail = await showCard(config, number);
    process.stdout.write(`#${detail.number} ${detail.title} [${detail.state}]\n${detail.url}\n\n${detail.body}\n\nLabels: ${detail.labels.join(', ') || 'none'}\n`);
    for (const comment of detail.comments) process.stdout.write(`\n${comment.author} (${comment.createdAt}):\n${comment.body}\n`);
    for (const pr of detail.pullRequests) process.stdout.write(`\nPR #${pr.number} ${pr.title} [${pr.state}, checks: ${pr.checks}] ${pr.url}\n`);
    return;
  }
  const job = await findJob(config, target);
  process.stdout.write(`Tailing ${job.id} (Ctrl-C to stop)\n`);
  const stop = tailJob(job, config.jobs.adapters, entry => process.stdout.write(`[${entry.file}] ${entry.text}\n`), error => process.stderr.write(`tail: ${error.message}\n`));
  process.on('SIGINT', () => { stop(); process.exitCode = 0; });
  process.on('SIGTERM', () => { stop(); process.exitCode = 0; });
}

main().catch(error => { process.stderr.write(`agent-board: ${(error as Error).message}\n`); process.exitCode = 1; });
