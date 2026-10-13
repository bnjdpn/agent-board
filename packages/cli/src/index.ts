#!/usr/bin/env node
import { findJob, loadConfig, readBoard, showCard, tailJob, type BoardItem } from '@agent-board/core';

function option(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function usage(): never {
  throw new Error('Usage: agent-board [--config FILE] board [--status X] [--field K=V] [--json] | show <n> | tail <job|n> | move | jobs | launch');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write('Usage: agent-board [--config FILE] board [--status X] [--field K=V] [--json] | show <n> | tail <job|n> | move | jobs | launch\n');
    return;
  }
  const configPath = option(args, '--config');
  if (configPath) args.splice(args.indexOf('--config'), 2);
  const command = args.shift() ?? 'board';
  if (['move', 'jobs', 'launch'].includes(command)) {
    process.stdout.write(`${command}: planned for v1; no action performed\n`);
    return;
  }
  if (!['board', 'show', 'tail'].includes(command)) usage();
  const config = await loadConfig(configPath);
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
    const items = board.items.filter(item => (!status || item.status === status) && (!fieldName || item.fields[fieldName] === fieldValue));
    if (args.includes('--json')) { process.stdout.write(JSON.stringify({ ...board, items }, null, 2) + '\n'); return; }
    process.stdout.write(`${board.title} (${items.length} cards)\n`);
    for (const column of board.columns) {
      process.stdout.write(`\n${column}\n`);
      for (const item of items.filter((item: BoardItem) => item.status === column)) process.stdout.write(`  ${item.number ? `#${item.number}` : 'draft'} ${item.title}\n`);
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
