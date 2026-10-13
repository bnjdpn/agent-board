import type { AgentSettings, Board, ControlState, IssueDetail, Job, LogEntry } from '@agent-board/core';

declare global {
  interface Window {
    agentBoard: {
      board(): Promise<Board>;
      jobs(): Promise<Job[]>;
      control(): Promise<{ state: ControlState; defaults: AgentSettings; limits: Record<string, number>; active: number[] }>;
      pause(paused: boolean, target?: { column?: string; card?: number }): Promise<ControlState>;
      setAgent(card: number, settings: AgentSettings): Promise<AgentSettings>;
      setDefaultAgent(settings: AgentSettings): Promise<AgentSettings>;
      setWip(column: string, limit: number): Promise<void>;
      launch(card: number): Promise<{ pid: number; settings: AgentSettings }>;
      move(card: number, column: string): Promise<void>;
      detail(repository: string, number: number): Promise<IssueDetail>;
      startTail(jobId: string): Promise<void>;
      stopTail(): Promise<void>;
      openLink(url: string): Promise<void>;
      onTailEntry(callback: (entry: LogEntry) => void): () => void;
      onTailError(callback: (message: string) => void): () => void;
    };
  }
}
export {};
