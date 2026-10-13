export interface Config {
  github: { owner: string; projectNumber: number };
  board: { statusField: string; columns: string[]; filterFields: string[] };
  jobs: { directory: string; cardPattern?: string; adapters: LogAdapter[] };
  launcher?: { command: string; args: string[] };
  agents?: { default: AgentSettings };
  control?: { stateFile?: string; holdFile?: string; readyColumns?: string[]; activeColumns?: string[]; wip?: Record<string, number> };
}
export interface AgentSettings { engine: 'codex' | 'cursor'; model: string; effort: string }
export interface ControlState {
  paused: boolean;
  defaultAgent?: AgentSettings;
  columns: string[];
  cards: number[];
  agents: Record<string, AgentSettings>;
  wip: Record<string, number>;
  launches: Record<string, { pid: number; column: string; startedAt: string }>;
  externalHold: boolean;
}
export interface LogAdapter { kind: 'transcript' | 'jsonl' | 'plain'; pattern: string }
export interface BoardItem {
  id: string;
  number?: number;
  title: string;
  url?: string;
  status: string;
  fields: Record<string, string>;
  kind: 'Issue' | 'PullRequest' | 'DraftIssue';
  repository?: string;
}
export interface Board { id: string; title: string; items: BoardItem[]; columns: string[]; filters: Record<string, string[]> }
export interface PullRequest { number: number; title: string; url: string; state: string; checks: string }
export interface IssueDetail {
  number: number; title: string; url: string; body: string; state: string;
  labels: string[]; comments: { author: string; body: string; createdAt: string }[];
  pullRequests: PullRequest[];
}
export interface Job { id: string; path: string; cardNumber?: number; modifiedAt: number }
export interface LogEntry { file: string; text: string }
