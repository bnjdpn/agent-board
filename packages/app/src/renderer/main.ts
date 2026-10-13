import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { Board, BoardItem, IssueDetail, Job } from '@agent-board/core';
import './style.css';

const root = document.querySelector<HTMLDivElement>('#app')!;
let board: Board | undefined;
let jobs: Job[] = [];
let statusFilter = '';
let fieldName = '';
let fieldValue = '';
let selected: BoardItem | undefined;
let removeTailEntry: (() => void) | undefined;
let removeTailError: (() => void) | undefined;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function markdown(value: string): HTMLElement {
  const container = element('div', 'markdown');
  container.innerHTML = DOMPurify.sanitize(marked.parse(value, { async: false }) as string);
  container.querySelectorAll('a').forEach(link => {
    const url = link.href;
    link.removeAttribute('href');
    link.addEventListener('click', () => { if (url.startsWith('https://github.com/')) void window.agentBoard.openLink(url); });
  });
  return container;
}

function stopTail(): void {
  removeTailEntry?.(); removeTailError?.(); removeTailEntry = undefined; removeTailError = undefined;
  void window.agentBoard.stopTail();
}

function render(): void {
  root.replaceChildren();
  const header = element('header', 'topbar');
  const title = element('div');
  title.append(element('span', 'eyebrow', 'AGENT BOARD'), element('h1', '', board?.title ?? 'GitHub Project'));
  header.append(title);
  const metrics = element('div', 'metrics');
  metrics.append(element('div', 'metric', 'Releases / semaine  —'), element('div', 'metric', 'MRR  —'));
  header.append(metrics);
  root.append(header);
  if (!board) { root.append(element('p', 'loading', 'Chargement du projet…')); return; }
  const toolbar = element('section', 'toolbar');
  const statusSelect = element('select') as HTMLSelectElement;
  statusSelect.append(new Option('Tous les statuts', ''));
  for (const column of board.columns) statusSelect.append(new Option(column, column));
  statusSelect.value = statusFilter;
  statusSelect.addEventListener('change', () => { statusFilter = statusSelect.value; render(); });
  toolbar.append(statusSelect);
  const fields = Object.keys(board.filters);
  if (fields.length) {
    const nameSelect = element('select') as HTMLSelectElement;
    nameSelect.append(new Option('Tous les champs', ''));
    for (const name of fields) nameSelect.append(new Option(name, name));
    nameSelect.value = fieldName;
    nameSelect.addEventListener('change', () => { fieldName = nameSelect.value; fieldValue = ''; render(); });
    toolbar.append(nameSelect);
    if (fieldName) {
      const valueSelect = element('select') as HTMLSelectElement;
      valueSelect.append(new Option('Toutes les valeurs', ''));
      for (const value of board.filters[fieldName] ?? []) valueSelect.append(new Option(value, value));
      valueSelect.value = fieldValue;
      valueSelect.addEventListener('change', () => { fieldValue = valueSelect.value; render(); });
      toolbar.append(valueSelect);
    }
  }
  const refresh = element('button', 'refresh', 'Actualiser');
  refresh.addEventListener('click', () => { void load(); });
  toolbar.append(refresh);
  root.append(toolbar);
  const grid = element('main', 'board');
  const visible = board.items.filter(item => (!statusFilter || item.status === statusFilter) && (!fieldName || !fieldValue || item.fields[fieldName] === fieldValue));
  for (const column of board.columns) {
    const section = element('section', 'column');
    const items = visible.filter(item => item.status === column);
    const heading = element('div', 'column-title');
    heading.append(element('h2', '', column), element('span', 'count', String(items.length)));
    section.append(heading);
    for (const item of items) {
      const card = element('button', 'card');
      card.append(element('span', 'card-number', item.number ? `#${item.number}` : 'Brouillon'), element('strong', '', item.title));
      const activeJob = jobs.find(job => job.cardNumber === item.number && item.number !== undefined);
      if (activeJob) card.append(element('span', 'job-badge', `● ${activeJob.id}`));
      card.addEventListener('click', () => { selected = item; void showDetail(item); });
      section.append(card);
    }
    grid.append(section);
  }
  root.append(grid);
  if (selected) void showDetail(selected);
}

async function showDetail(item: BoardItem): Promise<void> {
  stopTail();
  document.querySelector('.drawer')?.remove();
  const drawer = element('aside', 'drawer');
  const head = element('div', 'drawer-head');
  head.append(element('span', 'card-number', item.number ? `#${item.number}` : 'Brouillon'));
  const close = element('button', 'close', '×');
  close.setAttribute('aria-label', 'Fermer');
  close.addEventListener('click', () => { selected = undefined; stopTail(); drawer.remove(); });
  head.append(close);
  drawer.append(head, element('h2', 'detail-title', item.title));
  document.body.append(drawer);
  if (!item.repository || !item.number || item.kind !== 'Issue') { drawer.append(element('p', 'muted', 'Détail disponible pour les issues GitHub.')); return; }
  drawer.append(element('p', 'muted', 'Chargement du détail…'));
  try {
    const detail = await window.agentBoard.detail(item.repository, item.number);
    if (!drawer.isConnected) return;
    drawer.querySelector('.muted')?.remove();
    renderDetail(drawer, detail);
    const job = jobs.find(job => job.cardNumber === item.number);
    if (job) await showLog(drawer, job);
  } catch (error) { drawer.append(element('p', 'error', (error as Error).message)); }
}

function renderDetail(drawer: HTMLElement, detail: IssueDetail): void {
  const labels = element('div', 'labels');
  for (const label of detail.labels) labels.append(element('span', 'label', label));
  drawer.append(labels, markdown(detail.body || '_Aucune description._'));
  const prSection = element('section', 'detail-section');
  prSection.append(element('h3', '', `Pull requests liées (${detail.pullRequests.length})`));
  for (const pr of detail.pullRequests) {
    const row = element('button', 'pr-row', `#${pr.number} ${pr.title} · ${pr.state} · checks ${pr.checks}`);
    row.addEventListener('click', () => { void window.agentBoard.openLink(pr.url); });
    prSection.append(row);
  }
  drawer.append(prSection);
  const comments = element('section', 'detail-section');
  comments.append(element('h3', '', `Commentaires (${detail.comments.length})`));
  for (const comment of detail.comments) {
    const block = element('article', 'comment');
    block.append(element('strong', '', comment.author), element('time', '', new Date(comment.createdAt).toLocaleString()), markdown(comment.body));
    comments.append(block);
  }
  drawer.append(comments);
}

async function showLog(drawer: HTMLElement, job: Job): Promise<void> {
  const section = element('section', 'detail-section log-section');
  section.append(element('h3', '', `Job ${job.id}`));
  const log = element('pre', 'log');
  section.append(log);
  drawer.append(section);
  removeTailEntry = window.agentBoard.onTailEntry(entry => {
    log.textContent += `[${entry.file}] ${entry.text}\n`;
    if (log.textContent.length > 200_000) log.textContent = log.textContent.slice(-150_000);
    log.scrollTop = log.scrollHeight;
  });
  removeTailError = window.agentBoard.onTailError(message => { log.textContent += `ERROR: ${message}\n`; });
  await window.agentBoard.startTail(job.id);
}

async function load(): Promise<void> {
  selected = undefined; stopTail(); board = undefined; render();
  try {
    [board, jobs] = await Promise.all([window.agentBoard.board(), window.agentBoard.jobs()]);
    render();
  } catch (error) { root.replaceChildren(element('p', 'error', `Impossible de charger le projet : ${(error as Error).message}`)); }
}

void load();
