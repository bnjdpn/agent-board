import { contextBridge, ipcRenderer } from 'electron';
import type { Board, IssueDetail, Job, LogEntry } from '@agent-board/core';

const api = {
  board: (): Promise<Board> => ipcRenderer.invoke('board'),
  jobs: (): Promise<Job[]> => ipcRenderer.invoke('jobs'),
  detail: (repository: string, number: number): Promise<IssueDetail> => ipcRenderer.invoke('detail', repository, number),
  startTail: (jobId: string): Promise<void> => ipcRenderer.invoke('tail-start', jobId),
  stopTail: (): Promise<void> => ipcRenderer.invoke('tail-stop'),
  openLink: (url: string): Promise<void> => ipcRenderer.invoke('open-link', url),
  onTailEntry: (callback: (entry: LogEntry) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, entry: LogEntry) => callback(entry);
    ipcRenderer.on('tail-entry', listener);
    return () => ipcRenderer.removeListener('tail-entry', listener);
  },
  onTailError: (callback: (message: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message);
    ipcRenderer.on('tail-error', listener);
    return () => ipcRenderer.removeListener('tail-error', listener);
  }
};
contextBridge.exposeInMainWorld('agentBoard', api);
