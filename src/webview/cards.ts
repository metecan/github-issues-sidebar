import type {
  Card,
  CardAction,
  CardGroup,
  CardsMessage,
  CardsState,
  CardsUpdate,
  CardState,
} from '../cards/cardModel';
import { ICONS } from '../icons';

declare function acquireVsCodeApi(): { postMessage(message: CardsMessage): void };

const CONFIRMATION_MS = 1500;

const STATE_ICONS: Record<CardState, string> = {
  open: ICONS.issueOpen,
  closed: ICONS.issueClosed,
  'not-planned': ICONS.issueSkipped,
};

const CARD_ACTIONS: { action: CardAction; title: string; icon: string }[] = [
  { action: 'copyMarkdown', title: 'Copy as Markdown', icon: ICONS.copy },
  { action: 'copyUrl', title: 'Copy URL', icon: ICONS.link },
  { action: 'openOnGitHub', title: 'Open on GitHub', icon: ICONS.external },
];

const vscode = acquireVsCodeApi();
const root = document.getElementById('root') as HTMLElement;

let state: CardsState = { flat: true, groups: [] };
let selectedKey: string | undefined;
const toggledGroups = new Map<string, boolean>();
const cardNodes = new Map<string, { snapshot: string; node: HTMLElement }>();
const groupBodies = new Map<string, HTMLElement>();

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function iconElement(svg: string, className = ''): HTMLElement {
  const node = element('span', `icon ${className}`);
  node.innerHTML = svg;
  return node;
}

function textButton(label: string, onClick: () => void): HTMLElement {
  const button = element('button', 'text-button', label);
  button.addEventListener('click', onClick);
  return button;
}

function select(key: string): void {
  selectedKey = key;
  for (const card of root.querySelectorAll<HTMLElement>('.card')) {
    card.classList.toggle('selected', card.dataset.key === key);
  }
}

function openCard(key: string): void {
  select(key);
  vscode.postMessage({ type: 'open', key });
}

function renderTags(card: Card): HTMLElement | undefined {
  if (card.milestone) {
    const tags = element('span', 'tags');
    tags.append(iconElement(ICONS.milestone), element('span', 'tag-text', card.milestone));
    return tags;
  }
  if (card.labels.length === 0) {
    return undefined;
  }
  return renderLabels(card, 'tags');
}

function renderLabels(card: Card, className: string): HTMLElement {
  const labels = element('span', className);
  for (const label of card.labels) {
    const tag = element('span', 'label');
    const dot = element('span', 'label-dot');
    if (/^[0-9a-f]{6}$/i.test(label.color)) {
      dot.style.background = `#${label.color}`;
    }
    tag.append(dot, element('span', 'tag-text', label.name));
    labels.append(tag);
  }
  return labels;
}

function renderActions(card: Card): HTMLElement {
  const actions = element('div', 'card-actions');
  for (const { action, title, icon } of CARD_ACTIONS) {
    const button = element('button', 'card-action');
    button.title = title;
    button.setAttribute('aria-label', title);
    button.dataset.action = action;
    button.append(iconElement(icon, 'idle'), iconElement(ICONS.check, 'confirmed'));
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      vscode.postMessage({ type: 'action', action, key: card.key });
    });
    actions.append(button);
  }
  return actions;
}

function metaItem(svg: string, text: string): HTMLElement {
  const item = element('span', 'meta-item');
  item.append(iconElement(svg), element('span', 'meta-text', text));
  return item;
}

function renderCard(card: Card): HTMLElement {
  const node = element('div', 'card');
  node.dataset.key = card.key;
  node.tabIndex = 0;
  node.setAttribute('role', 'listitem');
  node.classList.toggle('selected', card.key === selectedKey);

  const head = element('div', 'card-head');
  const stateIcon = iconElement(STATE_ICONS[card.state], `state ${card.state}`);
  stateIcon.title = card.stateLabel;
  head.append(stateIcon, element('span', 'number', `#${card.number}`));
  const tags = renderTags(card);
  if (tags) {
    head.append(element('span', 'dash', '-'), tags);
  }
  head.append(element('span', 'age', card.age), renderActions(card));

  const title = element('div', 'card-title', card.title);
  title.title = card.title;
  node.append(head, title);

  // The head shows the milestone instead of labels, so they get their own row.
  if (card.milestone && card.labels.length) {
    node.append(renderLabels(card, 'card-labels'));
  }

  const meta = element('div', 'card-meta');
  meta.append(metaItem(ICONS.person, card.author));
  if (card.commentCount > 0) {
    meta.append(metaItem(ICONS.comment, card.commentCount.toLocaleString()));
  }
  if (card.assignees.length) {
    meta.append(element('span', 'meta-text', `→ ${card.assignees.join(', ')}`));
  }
  if (card.repo) {
    meta.append(element('span', 'meta-text repo', card.repo));
  }
  node.append(meta);

  node.addEventListener('click', () => openCard(card.key));
  return node;
}

/**
 * Pages arrive while people are clicking, and a click is lost if the element
 * is replaced between press and release, so unchanged cards keep their node.
 */
function cardNode(group: CardGroup, card: Card, seen: Set<string>): HTMLElement {
  const id = `${group.id}|${card.key}`;
  seen.add(id);
  const snapshot = JSON.stringify(card);
  const cached = cardNodes.get(id);
  if (cached?.snapshot === snapshot) {
    cached.node.classList.toggle('selected', card.key === selectedKey);
    return cached.node;
  }
  const node = renderCard(card);
  cardNodes.set(id, { snapshot, node });
  return node;
}

function syncChildren(parent: HTMLElement, children: readonly HTMLElement[]): void {
  let cursor = parent.firstElementChild;
  for (const child of children) {
    if (child === cursor) {
      cursor = cursor.nextElementSibling;
    } else {
      parent.insertBefore(child, cursor);
    }
  }
  while (cursor) {
    const next: Element | null = cursor.nextElementSibling;
    cursor.remove();
    cursor = next;
  }
}

function isExpanded(group: CardGroup): boolean {
  return toggledGroups.get(group.id) ?? group.expanded;
}

function renderGroupHeader(group: CardGroup): HTMLElement {
  const expanded = isExpanded(group);
  const header = element('button', 'group-header');
  header.setAttribute('aria-expanded', String(expanded));
  header.append(iconElement(ICONS.chevron, expanded ? 'chevron open' : 'chevron'));
  header.append(element('span', 'group-label', group.label));
  if (group.loaded && !group.error) {
    header.append(element('span', 'group-count', group.total.toLocaleString()));
  }
  header.addEventListener('click', () => {
    toggledGroups.set(group.id, !expanded);
    if (!expanded) {
      vscode.postMessage({ type: 'expand', groupId: group.id });
    }
    render();
  });

  if (!group.removable) {
    return header;
  }
  const row = element('div', 'group-row');
  const remove = element('button', 'group-remove');
  remove.title = 'Remove Repository';
  remove.setAttribute('aria-label', 'Remove Repository');
  remove.append(iconElement(ICONS.close));
  remove.addEventListener('click', () => vscode.postMessage({ type: 'remove', groupId: group.id }));
  row.append(header, remove);
  return row;
}

function groupBodyChildren(group: CardGroup, seen: Set<string>): HTMLElement[] {
  if (group.error) {
    const message = element('div', 'message error', group.error);
    message.append(textButton('Try Again', () => vscode.postMessage({ type: 'retry' })));
    return [message];
  }
  if (!group.loaded) {
    return [element('div', 'message', 'Loading issues…')];
  }
  const children = group.cards.map((card) => cardNode(group, card, seen));
  if (group.cards.length === 0 && !group.loading) {
    children.push(element('div', 'message', 'No issues found'));
  }
  const progress = `${group.cards.length.toLocaleString()} of ${group.total.toLocaleString()}`;
  if (group.loading) {
    children.push(element('div', 'message', `Loading ${progress}…`));
  } else if (group.hasMore) {
    children.push(
      textButton(`Load more (${progress})`, () => vscode.postMessage({ type: 'loadMore', groupId: group.id })),
    );
  }
  return children;
}

function renderGroupBody(group: CardGroup, seen: Set<string>): HTMLElement {
  let body = groupBodies.get(group.id);
  if (!body) {
    body = element('div', 'cards');
    body.setAttribute('role', 'list');
    groupBodies.set(group.id, body);
  }
  syncChildren(body, groupBodyChildren(group, seen));
  return body;
}

function render(): void {
  const active = document.activeElement as HTMLElement | null;
  const focusedKey = active?.dataset.key;
  const seen = new Set<string>();

  const content: HTMLElement[] = [];
  for (const group of state.groups) {
    if (!state.flat) {
      content.push(renderGroupHeader(group));
    }
    if (state.flat || isExpanded(group)) {
      content.push(renderGroupBody(group, seen));
    }
  }
  syncChildren(root, content);

  for (const id of cardNodes.keys()) {
    if (!seen.has(id)) {
      cardNodes.delete(id);
    }
  }
  if (focusedKey && document.activeElement !== active) {
    root.querySelector<HTMLElement>(`.card[data-key="${CSS.escape(focusedKey)}"]`)?.focus();
  }
}

function confirmAction(key: string, action: CardAction): void {
  const card = root.querySelector(`.card[data-key="${CSS.escape(key)}"]`);
  const button = card?.querySelector(`[data-action="${action}"]`);
  button?.classList.add('done');
  setTimeout(() => button?.classList.remove('done'), CONFIRMATION_MS);
}

function moveFocus(from: HTMLElement, step: number): void {
  const cards = [...root.querySelectorAll<HTMLElement>('.card')];
  cards[cards.indexOf(from) + step]?.focus();
}

root.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement;
  const card = target.closest<HTMLElement>('.card');
  const key = card?.dataset.key;
  if (!card || !key) {
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    moveFocus(card, event.key === 'ArrowDown' ? 1 : -1);
  } else if (event.key === 'Enter' && target === card) {
    openCard(key);
  } else if ((event.metaKey || event.ctrlKey) && event.key === 'c' && !window.getSelection()?.toString()) {
    event.preventDefault();
    vscode.postMessage({ type: 'action', action: 'copyMarkdown', key });
  }
});

window.addEventListener('message', ({ data }: MessageEvent<CardsUpdate>) => {
  if (data.type === 'state') {
    state = data.state;
    render();
  } else {
    confirmAction(data.key, data.action);
  }
});

vscode.postMessage({ type: 'ready' });
