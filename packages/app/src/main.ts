import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeCards, findJob, launchCard, listJobs, loadConfig, moveCard, readBoard, readControl, readIssue, setAgent, setDefaultAgent, setPause, setWip, tailJob, type AgentSettings } from '@agent-board/core';
// electron-updater is CommonJS: a named ESM import of autoUpdater throws at load time and the app never opens a window.
import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;

const directory = fileURLToPath(new URL('.', import.meta.url));
const tails = new Map<number, () => void>();
const logFile = join(homedir(), 'Library', 'Logs', 'agent-board', 'main.log');
function log(...parts: unknown[]): void {
  const line = `${new Date().toISOString()} ${parts.map(part => part instanceof Error ? part.stack ?? part.message : typeof part === 'string' ? part : JSON.stringify(part)).join(' ')}\n`;
  try { mkdirSync(dirname(logFile), { recursive: true }); appendFileSync(logFile, line); } catch { /* logging must never crash the app */ }
  console.log(line.trimEnd());
}
process.on('uncaughtException', error => log('uncaughtException', error));
process.on('unhandledRejection', error => log('unhandledRejection', error));

const configPath = process.env.AGENT_BOARD_CONFIG ?? (app.isPackaged ? join(app.getPath('userData'), 'agent-board.config.json') : undefined);
let configPromise = loadConfig(configPath);
configPromise.catch(error => log('config load failed', configPath ?? 'agent-board.config.json', error));

async function logSnapshot(): Promise<void> {
  try {
    const config = await configPromise;
    const [board, jobs] = await Promise.all([readBoard(config), listJobs(config)]);
    const running = jobs.filter(job => job.running).map(job => `${job.id}#${job.cardNumber ?? '?'}`);
    log('board loaded', board.items.length, 'cards;', jobs.length, 'jobs;', running.length, 'running:', running.join(', '));
  } catch (error) { log('snapshot failed', error); }
}

function defaultConfig(owner: string, projectNumber: number, jobsDirectory: string, columns: string[]): Record<string, unknown> {
  return {
    github: { owner, projectNumber },
    board: { statusField: 'Status', columns, filterFields: [] },
    jobs: {
      directory: jobsDirectory,
      cardPattern: '(?:card|issue)(?:\\s+[A-Za-z][\\w-]*)?\\s*#?(\\d+)|#(\\d+)',
      adapters: [
        { kind: 'transcript', pattern: '<engine>.log' }, { kind: 'jsonl', pattern: '<engine>.jsonl' },
        { kind: 'plain', pattern: 'notify.log' }, { kind: 'plain', pattern: 'STATUS' }, { kind: 'plain', pattern: 'RESULT*' }
      ]
    },
    agents: { default: { engine: 'codex', model: 'default', effort: 'medium' } }
  };
}

function makeWindow(): void {
  const window = new BrowserWindow({
    width: 1450, height: 920, minWidth: 850, minHeight: 600,
    webPreferences: { preload: join(directory, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  // Always show the window on a visible display, even if a previous position was off-screen.
  const { workArea } = screen.getPrimaryDisplay();
  window.setBounds({ x: workArea.x + Math.max(0, Math.round((workArea.width - Math.min(1450, workArea.width)) / 2)), y: workArea.y, width: Math.min(1450, workArea.width), height: Math.min(920, workArea.height) });
  window.once('ready-to-show', () => { window.show(); window.focus(); });
  window.webContents.on('did-fail-load', (_event, code, description, url) => log('did-fail-load', code, description, url));
  window.webContents.on('preload-error', (_event, path, error) => log('preload-error', path, error));
  window.webContents.on('console-message', (details: { level?: string; message?: string }) => { if (details.level === 'error' || details.level === 'warning') log('renderer console', details.level, details.message); });
  window.webContents.on('did-finish-load', () => {
    const check = `new Promise(r => setTimeout(() => r({ bridge: typeof window.agentBoard === 'object' && window.agentBoard !== null, cards: document.querySelectorAll('.card').length, setup: !!document.querySelector('form.setup'), error: (document.querySelector('.error')?.textContent ?? '').slice(0, 300) }), ${process.env.AGENT_BOARD_SMOKE ? 12000 : 8000}))`;
    window.webContents.executeJavaScript(check).then((result: { bridge: boolean; cards: number; setup: boolean; error: string }) => {
      log(result.bridge ? 'renderer check' : 'renderer check FAILED: preload bridge window.agentBoard missing', result);
      if (process.env.AGENT_BOARD_SMOKE) app.exit(result.bridge && (result.cards > 0 || result.setup) && !result.error ? 0 : 1);
    }).catch(error => { log('renderer check failed', error); if (process.env.AGENT_BOARD_SMOKE) app.exit(1); });
  });
  window.webContents.on('render-process-gone', (_event, details) => log('render-process-gone', details));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const contentsId = window.webContents.id;
  window.on('closed', () => { tails.get(contentsId)?.(); tails.delete(contentsId); });
  window.loadFile(join(directory, 'renderer', 'index.html')).catch(error => log('loadFile failed', error));
  setTimeout(() => { if (!window.isDestroyed() && !window.isVisible()) window.show(); }, 3000);
}

ipcMain.on('renderer-log', (_event, message: unknown) => log('renderer', String(message).slice(0, 2000)));
ipcMain.handle('setup-status', async () => {
  try { await configPromise; return { ready: true, path: configPath ?? 'agent-board.config.json' }; }
  catch (error) { return { ready: false, path: configPath ?? 'agent-board.config.json', error: (error as Error).message, missing: !configPath || !existsSync(configPath) }; }
});
ipcMain.handle('setup-save', async (_event, input: { owner: string; projectNumber: number; jobsDirectory: string; columns: string }) => {
  const target = configPath ?? join(process.cwd(), 'agent-board.config.json');
  const columns = String(input.columns ?? '').split(',').map(value => value.trim()).filter(Boolean);
  const config = defaultConfig(String(input.owner ?? '').trim(), Number(input.projectNumber), String(input.jobsDirectory ?? '').trim() || '~/agent-jobs/<date>/<job>', columns.length ? columns : ['Todo', 'In Progress', 'Done']);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
  configPromise = loadConfig(target);
  await configPromise;
  log('config written', target);
  void logSnapshot();
  return { ready: true, path: target };
});
ipcMain.handle('board', async () => readBoard(await configPromise));
ipcMain.handle('jobs', async () => listJobs(await configPromise));
ipcMain.handle('control', async () => {
  const config = await configPromise;
  const state = await readControl(config);
  return { state, defaults: state.defaultAgent ?? config.agents?.default ?? { engine: 'codex', model: 'default', effort: 'medium' }, limits: config.control?.wip ?? {}, active: [...await activeCards(config, state)] };
});
ipcMain.handle('pause', async (_event, paused: boolean, target?: { column?: string; card?: number }) => {
  const config = await configPromise;
  if (typeof paused !== 'boolean') throw new Error('Invalid pause value');
  if (target?.column && !config.board.columns.includes(target.column)) throw new Error('Unknown column');
  if (target?.card && !(await readBoard(config)).items.some(item => item.number === target.card)) throw new Error('Unknown card');
  return setPause(config, paused, target);
});
ipcMain.handle('agent-set', async (_event, card: number, settings: AgentSettings) => {
  const config = await configPromise;
  if (!(await readBoard(config)).items.some(item => item.number === card)) throw new Error('Unknown card');
  return setAgent(config, card, settings);
});
ipcMain.handle('agent-default', async (_event, settings: AgentSettings) => setDefaultAgent(await configPromise, settings));
ipcMain.handle('wip-set', async (_event, column: string, limit: number) => {
  const config = await configPromise;
  if (!config.board.columns.includes(column)) throw new Error('Unknown column');
  return setWip(config, column, limit);
});
ipcMain.handle('launch', async (_event, card: number) => {
  const config = await configPromise;
  const board = await readBoard(config);
  const item = board.items.find(candidate => candidate.number === card);
  if (!item) throw new Error('Unknown card');
  return launchCard(config, item, board.items);
});
ipcMain.handle('move', async (_event, card: number, column: string) => moveCard(await configPromise, card, column));
ipcMain.handle('detail', async (_event, repository: string, number: number) => {
  const board = await readBoard(await configPromise);
  if (!board.items.some(item => item.repository === repository && item.number === number && item.kind === 'Issue')) throw new Error('Card not on configured project');
  return readIssue(repository, number);
});
ipcMain.handle('tail-start', async (event, jobId: string) => {
  const config = await configPromise;
  const job = await findJob(config, jobId);
  const sender = event.sender;
  tails.get(sender.id)?.();
  const stop = tailJob(job, config.jobs.adapters,
    entry => { if (!sender.isDestroyed()) sender.send('tail-entry', entry); },
    error => { if (!sender.isDestroyed()) sender.send('tail-error', error.message); });
  tails.set(sender.id, stop);
});
ipcMain.handle('tail-stop', event => { tails.get(event.sender.id)?.(); tails.delete(event.sender.id); });
ipcMain.handle('open-link', async (_event, url: string) => {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') throw new Error('Only GitHub links are supported');
  await shell.openExternal(url);
});

app.whenReady().then(() => {
  log('app ready', app.getVersion(), 'packaged', app.isPackaged);
  makeWindow();
  void logSnapshot();
  if (app.isPackaged && process.platform === 'darwin') {
    autoUpdater.autoDownload = false;
    autoUpdater.checkForUpdates().catch(error => { console.error('Update check failed:', error); });
    autoUpdater.on('update-available', () => { autoUpdater.downloadUpdate().catch(error => console.error('Update download failed:', error)); });
  }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) makeWindow(); });
}).catch(error => log('startup failed', error));
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
