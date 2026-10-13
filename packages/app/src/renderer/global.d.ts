import type { Board, IssueDetail, Job, LogEntry } from '@agent-board/core';

declare global {
  interface Window {
    agentBoard: {
      board(): Promise<Board>;
      jobs(): Promise<Job[]>;
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
