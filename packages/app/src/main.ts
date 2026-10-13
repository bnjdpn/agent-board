import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findJob, listJobs, loadConfig, readBoard, readIssue, tailJob } from '@agent-board/core';

const directory = fileURLToPath(new URL('.', import.meta.url));
const tails = new Map<number, () => void>();
const configPromise = loadConfig();

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
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) makeWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
