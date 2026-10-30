export interface RepoRef {
  owner: string;
  name: string;
}

export interface IssueLabel {
  name: string;
  color: string;
}

export interface Issue {
  /** owner/name */
  repo: string;
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED';
  stateReason: string | null;
  url: string;
  body: string;
  author: string;
  labels: IssueLabel[];
  assignees: string[];
  milestone: string | null;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
}

export interface IssueComment {
  author: string;
  avatarUrl: string;
  body: string;
  /** Sanitized by GitHub. */
  bodyHTML: string;
  createdAt: string;
  url: string;
}

export interface IssueDetail extends Issue {
  /** Sanitized by GitHub. */
  bodyHTML: string;
  authorAvatarUrl: string;
  comments: IssueComment[];
}

export interface IssuePage {
  issues: Issue[];
  total: number;
  cursor: string | null;
  hasMore: boolean;
}

export type StateFilter = 'open' | 'closed' | 'all';

export interface IssueFilter {
  state: StateFilter;
  /** GitHub search syntax. Empty means no search. */
  query: string;
}

export function repoKey(repo: RepoRef): string {
  return `${repo.owner}/${repo.name}`;
}

export function issueKey(issue: Pick<Issue, 'repo' | 'number'>): string {
  return `${issue.repo}#${issue.number}`;
}
