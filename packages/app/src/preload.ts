import { contextBridge, ipcRenderer } from 'electron';
import type { AgentSettings, Board, ControlState, IssueDetail, Job, LogEntry } from '@agent-board/core';

const api = {
  board: (): Promise<Board> => ipcRenderer.invoke('board'),
  jobs: (): Promise<Job[]> => ipcRenderer.invoke('jobs'),
  control: (): Promise<{ state: ControlState; defaults: AgentSettings; limits: Record<string, number>; active: number[] }> => ipcRenderer.invoke('control'),
  pause: (paused: boolean, target?: { column?: string; card?: number }): Promise<ControlState> => ipcRenderer.invoke('pause', paused, target),
  setAgent: (card: number, settings: AgentSettings): Promise<AgentSettings> => ipcRenderer.invoke('agent-set', card, settings),
  setDefaultAgent: (settings: AgentSettings): Promise<AgentSettings> => ipcRenderer.invoke('agent-default', settings),
  setWip: (column: string, limit: number): Promise<void> => ipcRenderer.invoke('wip-set', column, limit),
  launch: (card: number): Promise<{ pid: number; settings: AgentSettings }> => ipcRenderer.invoke('launch', card),
  move: (card: number, column: string): Promise<void> => ipcRenderer.invoke('move', card, column),
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
