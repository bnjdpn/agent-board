import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeCards, findJob, launchCard, listJobs, loadConfig, moveCard, readBoard, readControl, readIssue, setAgent, setDefaultAgent, setPause, setWip, tailJob, type AgentSettings } from '@agent-board/core';
import { autoUpdater } from 'electron-updater';

const directory = fileURLToPath(new URL('.', import.meta.url));
const tails = new Map<number, () => void>();
const configPromise = loadConfig(process.env.AGENT_BOARD_CONFIG ?? (app.isPackaged ? join(app.getPath('userData'), 'agent-board.config.json') : undefined));

function makeWindow(): void {
  const window = new BrowserWindow({
    width: 1450, height: 920, minWidth: 850, minHeight: 600,
    webPreferences: { preload: join(directory, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.on('closed', () => { tails.get(window.webContents.id)?.(); tails.delete(window.webContents.id); });
  void window.loadFile(join(directory, 'renderer', 'index.html'));
}

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
  makeWindow();
  if (app.isPackaged && process.platform === 'darwin') {
    autoUpdater.autoDownload = false;
    autoUpdater.checkForUpdates().catch(error => { console.error('Update check failed:', error); });
    autoUpdater.on('update-available', () => { autoUpdater.downloadUpdate().catch(error => console.error('Update download failed:', error)); });
  }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) makeWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
