import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { RuntimeStatus, RuntimeAction, AgentSettings, Board, BoardItem, ControlState, IssueDetail, Job } from '@agent-board/core';
import './style.css';

const root = document.querySelector<HTMLDivElement>('#app')!;
let runtime: RuntimeStatus | null = null;
let runtimeError = '';
let runtimeBusy = false;
let refreshing = false;
let boardError = '';
let board: Board | undefined;
let jobs: Job[] = [];
let control: { state: ControlState; defaults: AgentSettings; limits: Record<string, number>; active: number[] } | undefined;
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

async function refreshControl(): Promise<void> { control = await window.agentBoard.control(); render(); }
function action(button: HTMLButtonElement, work: () => Promise<unknown>): void {
  button.addEventListener('click', event => {
    event.stopPropagation();
    button.disabled = true;
    void work().then(refreshControl).catch(error => { window.alert((error as Error).message); button.disabled = false; });
  });
}

function render(): void {
  root.replaceChildren();
  const header = element('header', 'topbar');
  const title = element('div');
  title.append(element('span', 'eyebrow', 'AGENT BOARD'), element('h1', '', board?.title ?? 'GitHub Project'));
  header.append(title);
  const pipeline = element('button', 'pipeline', control?.state.paused || control?.state.externalHold ? '▶ Reprendre' : '❚❚ Pause');
  pipeline.title = 'Pause globale des lancements';
  action(pipeline, () => window.agentBoard.pause(!(control?.state.paused || control?.state.externalHold)));
  header.append(pipeline);
  if (runtime || runtimeError) {
    pipeline.remove();
    const actions = element('div', 'runtime-actions');
    for (const [label, command] of [['Pause des départs', 'pause'], ['Reprendre', 'resume'], ['Arrêter les missions', 'stop'], ['Exécuter le prochain ticket', 'run']] as const) {
      const button = element('button', 'small-button', label);
      button.disabled = runtimeBusy || (!!runtimeError && command !== 'pause' && command !== 'stop') || (command === 'run' && !!runtime?.holds.length);
      button.addEventListener('click', () => { void runtimeAction(command); });
      actions.append(button);
    }
    header.append(actions);
  }
  root.append(header);
  if (runtime || runtimeError) {
    const panel = element('section', 'runtime-status');
    panel.append(element('strong', '', runtimeError ? 'Contrôleur indisponible — état inconnu' : runtime!.holds.length ? 'Exécution suspendue' : 'Contrôleur disponible'));
    if (runtimeError) panel.append(element('p', '', runtimeError));
    if (runtime) {
      panel.append(element('p', '', `${runtime.registered_jobs_count ?? 'Nombre inconnu de'} jobs enregistrés · état lu à ${new Date(runtime.observed_at * 1000).toLocaleTimeString()}`));
      for (const hold of runtime.holds) panel.append(element('p', 'hold-reason', hold.kind === 'safety' ? 'Contrôle de sécurité non résolu : reprise bloquée.' : hold.reason));
      if (runtime.missions.some(m => m.wait_reasons.some(r => r.startsWith('board périmé')))) panel.append(element('p', 'muted', 'Le cache du contrôleur doit être actualisé avant le prochain départ.'));
      if (runtime.unknown_sources.length) panel.append(element('p', 'error', `Sources inconnues : ${runtime.unknown_sources.join(', ')}`));
    }
    panel.append(element('p', 'muted', 'Reprendre retire la pause opérateur après vérification. Les suspensions de sécurité restent en place.'));
    root.append(panel);
  }
  if (!board) { root.append(element('p', boardError ? 'error' : 'loading', boardError || 'Chargement du projet…')); return; }
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
  const defaultSettings = element('details', 'default-settings');
  const summary = element('summary', '', 'Agent par défaut');
  const defaultForm = element('div', 'default-form');
  const engine = element('select') as HTMLSelectElement;
  engine.append(new Option('Codex', 'codex'), new Option('Cursor', 'cursor')); engine.value = control?.defaults.engine ?? 'codex';
  const model = element('input') as HTMLInputElement; model.value = control?.defaults.model ?? 'default'; model.placeholder = 'Modèle'; model.setAttribute('aria-label', 'Modèle par défaut');
  const effort = element('input') as HTMLInputElement; effort.value = control?.defaults.effort ?? 'medium'; effort.placeholder = 'Effort'; effort.setAttribute('aria-label', 'Effort par défaut');
  const saveDefault = element('button', 'small-button', 'Enregistrer');
  action(saveDefault, () => window.agentBoard.setDefaultAgent({ engine: engine.value as 'codex' | 'cursor', model: model.value.trim(), effort: effort.value.trim() }));
  defaultForm.append(engine, model, effort, saveDefault); defaultSettings.append(summary, defaultForm); if (!runtime && !runtimeError) toolbar.append(defaultSettings);
  const refresh = element('button', 'refresh', 'Actualiser');
  refresh.addEventListener('click', () => { void load(); });
  toolbar.append(refresh);
  root.append(toolbar);
  const grid = element('main', 'board');
  const visible = board.items.filter(item => (!statusFilter || item.status === statusFilter) && (!fieldName || !fieldValue || item.fields[fieldName] === fieldValue));
  for (const column of board.columns) {
    const section = element('section', 'column');
    section.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('text/plain')) event.preventDefault(); });
    section.addEventListener('drop', event => {
      event.preventDefault();
      const number = Number(event.dataTransfer?.getData('text/plain'));
      const current = board?.items.find(candidate => candidate.number === number);
      if (runtime || runtimeError || !current || current.status === column) return;
      void window.agentBoard.move(number, column).then(load).catch(error => window.alert((error as Error).message));
    });
    const items = visible.filter(item => item.status === column);
    const heading = element('div', 'column-title');
    const activeCount = board.items.filter(item => item.status === column && item.number && control?.active.includes(item.number)).length;
    const limit = control?.state.wip[column] ?? control?.limits[column];
    heading.append(element('h2', '', column), element('span', 'count', runtime || runtimeError ? `${items.length} tickets · ${runtimeError ? '?' : activeCount} actifs` : `${activeCount}/${limit ?? '∞'} actifs`));
    section.append(heading);
    const controls = element('div', 'column-controls');
    const pause = element('button', 'small-button', control?.state.columns.includes(column) ? '▶' : '❚❚');
    pause.title = control?.state.columns.includes(column) ? 'Reprendre cette colonne' : 'Mettre cette colonne en pause';
    action(pause, () => window.agentBoard.pause(!control?.state.columns.includes(column), { column }));
    const label = element('label', '', 'WIP');
    const input = element('input') as HTMLInputElement;
    input.type = 'number'; input.min = '0'; input.placeholder = '∞'; input.value = limit === undefined ? '' : String(limit); input.title = 'Limite de jobs actifs';
    input.addEventListener('change', () => {
      if (input.value === '') { input.value = limit === undefined ? '' : String(limit); return; }
      void window.agentBoard.setWip(column, Number(input.value)).then(refreshControl).catch(error => window.alert((error as Error).message));
    });
    label.append(input); controls.append(pause, label); if (!runtime && !runtimeError) section.append(controls);
    for (const item of items) {
      const card = element('button', 'card');
      if (item.number) {
        card.draggable = !runtime && !runtimeError;
        card.addEventListener('dragstart', event => event.dataTransfer?.setData('text/plain', String(item.number)));
      }
      card.append(element('span', 'card-number', item.number ? `#${item.number}` : 'Brouillon'), element('strong', '', item.title));
      const activeJob = jobs.find(job => job.cardNumber === item.number && item.number !== undefined);
      if (activeJob) card.append(element('span', 'job-badge', `${control?.active.includes(item.number!) ? '●' : '○'} ${activeJob.id}`));
      if (item.number) {
        const settings = runtime || runtimeError ? undefined : control?.state.agents[String(item.number)] ?? control?.defaults;
        if (settings) card.append(element('span', 'agent-badge', `${settings.engine} · ${settings.model} · ${settings.effort}`));
      }
      if (runtime && item.number) {
        const mission = runtime.missions.find(m => Number(m.issue) === item.number);
        const live = mission?.executors.filter(e => e.alive === true) ?? [];
        if (live.length) card.append(element('span', 'job-badge', `● ${live.map(e => e.engine ?? 'agent').join(', ')}`));
        const reason = mission?.wait_reasons.find(r => !r.startsWith('board périmé') && !/^(operator|safety):/.test(r));
        if (reason) card.append(element('span', 'card-reason', reason));
      }
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
  if (item.number && !runtime && !runtimeError) {
    const card = item.number;
    const controls = element('section', 'detail-section agent-controls');
    controls.append(element('h3', '', 'Agent et pipeline'));
    const settings = control?.state.agents[String(card)] ?? control?.defaults ?? { engine: 'codex', model: 'default', effort: 'medium' };
    const engine = element('select') as HTMLSelectElement;
    engine.append(new Option('Codex', 'codex'), new Option('Cursor', 'cursor')); engine.value = settings.engine;
    const model = element('input') as HTMLInputElement; model.value = settings.model; model.placeholder = 'Modèle'; model.setAttribute('aria-label', 'Modèle');
    const effort = element('input') as HTMLInputElement; effort.value = settings.effort; effort.placeholder = 'Effort'; effort.setAttribute('aria-label', 'Effort de raisonnement');
    const save = element('button', 'small-button', 'Enregistrer');
    action(save, () => window.agentBoard.setAgent(card, { engine: engine.value as 'codex' | 'cursor', model: model.value.trim(), effort: effort.value.trim() }));
    const pause = element('button', 'small-button', control?.state.cards.includes(card) ? '▶ Reprendre la carte' : '❚❚ Pause carte');
    action(pause, () => window.agentBoard.pause(!control?.state.cards.includes(card), { card }));
    const launch = element('button', 'small-button', '▶ Lancer');
    action(launch, () => window.agentBoard.launch(card));
    controls.append(engine, model, effort, save, pause, launch); drawer.append(controls);
  }
  if (runtime && item.number) {
    const section = element('section', 'detail-section');
    section.append(element('h3', '', 'Exécution'));
    const mission = runtime.missions.find(m => Number(m.issue) === item.number);
    for (const reason of mission?.wait_reasons ?? []) section.append(element('p', 'muted', reason));
    for (const [label, command] of [['Arrêter cette mission', 'stop'], ['Autoriser sa reprise', 'resume']] as const) {
      const button = element('button', 'small-button', label);
      button.disabled = runtimeBusy;
      button.addEventListener('click', () => { void runtimeAction(command, item.number); });
      section.append(button);
    }
    drawer.append(section);
  }
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
  if (refreshing) return;
  refreshing = true;
  try {
    await refreshRuntime();
    const results = await Promise.allSettled([window.agentBoard.board(), window.agentBoard.jobs(), window.agentBoard.control()] as const);
    if (results[0].status === 'fulfilled') { board = results[0].value; boardError = ''; }
    else boardError = `Board indisponible : ${String(results[0].reason)}`;
    if (results[1].status === 'fulfilled') jobs = results[1].value;
    if (results[2].status === 'fulfilled') control = results[2].value;
    if (!selected) render();
  } finally { refreshing = false; }
}

async function refreshRuntime(): Promise<void> {
  try { runtime = await window.agentBoard.runtime(); runtimeError = ''; }
  catch (error) { runtimeError = (error as Error).message; }
}
async function runtimeAction(command: RuntimeAction, issue?: number): Promise<void> {
  if (runtimeBusy) return;
  runtimeBusy = true; render();
  try { await window.agentBoard.runtimeAction(command, issue); }
  catch (error) { window.alert((error as Error).message); }
  finally { await refreshRuntime(); runtimeBusy = false; render(); }
}
void load();
setInterval(() => { if (!runtimeBusy) void load(); }, 15_000);
