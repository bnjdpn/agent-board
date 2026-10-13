export interface Config {
  github: { owner: string; projectNumber: number };
  board: { statusField: string; columns: string[]; filterFields: string[] };
  jobs: { directory: string; cardPattern?: string; adapters: LogAdapter[] };
  launcher?: { command: string; args: string[] };
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
