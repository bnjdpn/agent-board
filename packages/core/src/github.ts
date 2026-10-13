import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Board, BoardItem, Config, IssueDetail, PullRequest } from './types.js';

const execFileAsync = promisify(execFile);
type GraphQLResponse<T> = { data?: T; errors?: { message: string }[] };

export class GitHubClient {
  constructor(private readonly tokenProvider: () => Promise<string> = runtimeToken, private readonly endpoint = 'https://api.github.com/graphql') {}

  async query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const token = await this.tokenProvider();
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/vnd.github+json' },
      body: JSON.stringify({ query, variables })
    });
    if (!response.ok) throw new Error(`GitHub GraphQL HTTP ${response.status}`);
    const result = await response.json() as GraphQLResponse<T>;
    if (result.errors?.length) throw new Error(result.errors.map(error => error.message).join('; '));
    if (!result.data) throw new Error('GitHub GraphQL returned no data');
    return result.data;
  }
}

export async function runtimeToken(): Promise<string> {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    // gh may retrieve the credential from the operating-system keychain.
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], { timeout: 10_000 });
    const token = stdout.trim();
    if (token) return token;
  } catch { /* emit a useful error below */ }
  throw new Error('GitHub token unavailable: set GITHUB_TOKEN or sign in with gh auth login');
}

const projectQuery = `query Project($owner:String!,$number:Int!,$cursor:String) {
  user(login:$owner) { projectV2(number:$number) { ...ProjectFields } }
}
fragment ProjectFields on ProjectV2 {
  id title items(first:100,after:$cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { id content {
      ... on Issue { number title url repository { nameWithOwner } }
      ... on PullRequest { number title url repository { nameWithOwner } }
      ... on DraftIssue { title }
    } fieldValues(first:30) { nodes {
      ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
    } } }
  }
} `;

const orgProjectQuery = projectQuery.replace('user(login:$owner)', 'organization(login:$owner)');
type ProjectResult = { user?: { projectV2?: RawProject | null } | null; organization?: { projectV2?: RawProject | null } | null };
type RawProject = { id: string; title: string; items: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawItem[] } };
type RawItem = { id: string; content?: { number?: number; title?: string; url?: string; repository?: { nameWithOwner: string } } | null; fieldValues: { nodes: ({ name?: string; field?: { name?: string } } | null)[] } };

export async function readBoard(config: Config, client = new GitHubClient()): Promise<Board> {
  const items: BoardItem[] = [];
  let cursor: string | null = null;
  let ownerKind: 'user' | 'organization' = 'user';
  let projectId = '';
  let title = '';
  do {
    const variables: { owner: string; number: number; cursor: string | null } = { owner: config.github.owner, number: config.github.projectNumber, cursor };
    let data: ProjectResult = await client.query<ProjectResult>(ownerKind === 'user' ? projectQuery : orgProjectQuery, variables);
    let project: RawProject | null | undefined = data[ownerKind]?.projectV2;
    if (!project && ownerKind === 'user') {
      ownerKind = 'organization';
      data = await client.query<ProjectResult>(orgProjectQuery, variables);
      project = data.organization?.projectV2;
    }
    if (!project) throw new Error(`Project ${config.github.owner}/${config.github.projectNumber} not found`);
    projectId = project.id;
    title = project.title;
    for (const raw of project.items.nodes) {
      const fields = Object.fromEntries(raw.fieldValues.nodes.filter(value => value?.name && value.field?.name).map(value => [value!.field!.name!, value!.name!]));
      const content = raw.content;
      items.push({ id: raw.id, number: content?.number, title: content?.title ?? '(untitled)', url: content?.url,
        status: fields[config.board.statusField] ?? '', fields,
        kind: content?.repository ? (content.url?.includes('/pull/') ? 'PullRequest' : 'Issue') : 'DraftIssue',
        repository: content?.repository?.nameWithOwner });
    }
    cursor = project.items.pageInfo.hasNextPage ? project.items.pageInfo.endCursor : null;
    if (project.items.pageInfo.hasNextPage && !cursor) throw new Error('GitHub returned an incomplete project cursor');
  } while (cursor);
  const columns = [...config.board.columns];
  for (const item of items) if (item.status && !columns.includes(item.status)) columns.push(item.status);
  const filters = Object.fromEntries(config.board.filterFields.map(name => [name, [...new Set(items.map(item => item.fields[name]).filter((value): value is string => !!value))].sort()]));
  return { id: projectId, title, items, columns, filters };
}

const issueQuery = `query Issue($owner:String!,$repo:String!,$number:Int!) {
  repository(owner:$owner,name:$repo) { issue(number:$number) {
    number title url body state labels(first:100) { nodes { name } }
    comments(first:100) { nodes { author { login } body createdAt } }
    closedByPullRequestsReferences(first:30) { nodes { ...LinkedPR } }
    timelineItems(first:100,itemTypes:[CROSS_REFERENCED_EVENT]) { nodes {
      ... on CrossReferencedEvent { source { ... on PullRequest { ...LinkedPR } } }
    } }
  } }
}
fragment LinkedPR on PullRequest {
  number title url state commits(last:1) { nodes { commit { statusCheckRollup { state } } } }
}`;
type RawPR = { number: number; title: string; url: string; state: string; commits: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] } };
type IssueResult = { repository?: { issue?: { number: number; title: string; url: string; body: string; state: string; labels: { nodes: { name: string }[] }; comments: { nodes: { author?: { login: string } | null; body: string; createdAt: string }[] }; closedByPullRequestsReferences: { nodes: RawPR[] }; timelineItems: { nodes: ({ source?: RawPR } | null)[] } } | null } | null };

export async function readIssue(repository: string, number: number, client = new GitHubClient()): Promise<IssueDetail> {
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) throw new Error(`Invalid repository ${repository}`);
  const result = await client.query<IssueResult>(issueQuery, { owner, repo, number });
  const issue = result.repository?.issue;
  if (!issue) throw new Error(`Issue ${repository}#${number} not found`);
  const linked = [...issue.closedByPullRequestsReferences.nodes, ...issue.timelineItems.nodes.map(node => node?.source).filter((pr): pr is RawPR => !!pr)];
  const pullRequests: PullRequest[] = [...new Map(linked.map(pr => [pr.url, {
    number: pr.number, title: pr.title, url: pr.url, state: pr.state,
    checks: pr.commits.nodes.at(-1)?.commit.statusCheckRollup?.state ?? 'UNKNOWN'
  }])).values()];
  return { number: issue.number, title: issue.title, url: issue.url, body: issue.body, state: issue.state,
    labels: issue.labels.nodes.map(label => label.name),
    comments: issue.comments.nodes.map(comment => ({ author: comment.author?.login ?? 'unknown', body: comment.body, createdAt: comment.createdAt })),
    pullRequests };
}

export async function showCard(config: Config, number: number, client = new GitHubClient()): Promise<IssueDetail> {
  const board = await readBoard(config, client);
  const card = board.items.find(item => item.kind === 'Issue' && item.number === number);
  if (!card?.repository) throw new Error(`Issue card #${number} not found on project`);
  return readIssue(card.repository, number, client);
}

export async function moveCard(config: Config, number: number, column: string, client = new GitHubClient()): Promise<void> {
  const board = await readBoard(config, client);
  const item = board.items.find(candidate => candidate.number === number);
  if (!item) throw new Error(`Card #${number} not found on project`);
  if (!board.columns.includes(column)) throw new Error(`Unknown column ${column}`);
  const fields = await client.query<{ node?: { fields: { nodes: ({ id: string; name: string; options?: { id: string; name: string }[] } | null)[] } } }>(
    'query Fields($id:ID!) { node(id:$id) { ... on ProjectV2 { fields(first:100) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } } } } } }',
    { id: board.id }
  );
  const field = fields.node?.fields.nodes.find(candidate => candidate?.name === config.board.statusField);
  const option = field?.options?.find(candidate => candidate.name === column);
  if (!field || !option) throw new Error(`Status option ${column} not found on project`);
  await client.query('mutation Move($project:ID!,$item:ID!,$field:ID!,$option:String!) { updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:{singleSelectOptionId:$option}}) { projectV2Item { id } } }',
    { project: board.id, item: item.id, field: field.id, option: option.id });
}
