import type { IssueGroup } from '../issueList';
import { relativeTime, stateLabel } from '../markdown';
import { issueKey, type Issue, type IssueLabel } from '../types';

// Shared between the extension and the cards webview, so this file stays free
// of runtime dependencies on either.

export type CardState = 'open' | 'closed' | 'not-planned';

export interface Card {
  key: string;
  number: number;
  title: string;
  /** Set when a section mixes repositories. */
  repo: string | null;
  state: CardState;
  stateLabel: string;
  milestone: string | null;
  labels: IssueLabel[];
  author: string;
  assignees: string[];
  commentCount: number;
  age: string;
}

export interface CardGroup {
  id: string;
  label: string;
  expanded: boolean;
  removable: boolean;
  total: number;
  loaded: boolean;
  loading: boolean;
  hasMore: boolean;
  error: string | null;
  cards: Card[];
}

export interface CardsState {
  flat: boolean;
  groups: CardGroup[];
}

export type CardAction = 'copyMarkdown' | 'copyUrl' | 'openOnGitHub';

export type CardsMessage =
  | { type: 'ready' }
  | { type: 'open'; key: string }
  | { type: 'action'; action: CardAction; key: string }
  | { type: 'expand'; groupId: string }
  | { type: 'loadMore'; groupId: string }
  | { type: 'remove'; groupId: string }
  | { type: 'retry' };

export type CardsUpdate =
  | { type: 'state'; state: CardsState }
  | { type: 'done'; action: CardAction; key: string };

function cardState(issue: Issue): CardState {
  if (issue.state === 'OPEN') {
    return 'open';
  }
  return issue.stateReason === 'NOT_PLANNED' || issue.stateReason === 'DUPLICATE' ? 'not-planned' : 'closed';
}

export function toCard(issue: Issue, options: { showRepo: boolean; now?: number }): Card {
  return {
    key: issueKey(issue),
    number: issue.number,
    title: issue.title,
    repo: options.showRepo ? issue.repo : null,
    state: cardState(issue),
    stateLabel: stateLabel(issue),
    milestone: issue.milestone,
    labels: issue.labels,
    author: issue.author,
    assignees: issue.assignees,
    commentCount: issue.commentCount,
    age: relativeTime(issue.updatedAt, options.now),
  };
}

export function toCardGroup(group: IssueGroup, options: { showRepo: boolean }): CardGroup {
  return {
    id: group.source.id,
    label: group.source.label,
    expanded: group.source.expanded,
    removable: group.source.removableRepo !== undefined,
    total: group.total,
    loaded: group.loaded,
    loading: group.loading,
    hasMore: group.hasMore,
    error: group.error ?? null,
    cards: group.issues.map((issue) => toCard(issue, options)),
  };
}
