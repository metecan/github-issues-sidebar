import * as vscode from 'vscode';
import { STATE_LABELS, type FilterState } from './filterState';
import { issueKey, type Issue, type IssueFilter, type IssuePage, type RepoRef } from './types';

/** Where a group of issues comes from: a repository, or a saved search. */
export interface IssueSource {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly contextValue: string;
  readonly expanded: boolean;
  /** Set when the user added this repository and can remove it again. */
  readonly removableRepo?: RepoRef;
  fetchPage(filter: IssueFilter, after: string | null): Promise<IssuePage>;
}

export class IssueGroup {
  issues: Issue[] = [];
  total = 0;
  cursor: string | null = null;
  hasMore = false;
  error: string | undefined;
  loaded = false;
  loading = false;
  firstPage: Promise<void> | undefined;

  constructor(
    readonly source: IssueSource,
    public limit: number,
  ) {}
}

function maxIssuesPerList(): number {
  return vscode.workspace.getConfiguration('ghIssues').get<number>('maxIssuesPerList', 1000);
}

/** The issues behind one sidebar section. The list and card styles both read this. */
export class IssueList implements vscode.Disposable {
  private groups = new Map<string, IssueGroup>();
  private readonly changed = new vscode.EventEmitter<IssueGroup | undefined>();

  readonly onDidChange = this.changed.event;

  constructor(
    private readonly getSources: () => IssueSource[],
    private readonly isSignedIn: () => boolean,
    private readonly filter: FilterState,
    private readonly options: { flattenSingleSource: boolean },
  ) {}

  /** Drops everything loaded so far and starts over. */
  refresh(): void {
    this.groups = new Map();
    this.changed.fire(undefined);
  }

  /** e.g. "Open · 1,204 issues · label:bug" */
  get summary(): string {
    const { state, query } = this.filter.value;
    const parts = [STATE_LABELS[state]];
    const groups = [...this.groups.values()];
    if (groups.length === 1 && groups[0].loaded && !groups[0].error) {
      parts.push(`${groups[0].total.toLocaleString()} issues`);
    }
    if (query) {
      parts.push(query);
    }
    return parts.join(' · ');
  }

  /** A lone repository shows its issues directly, with no heading above them. */
  get isFlat(): boolean {
    return this.options.flattenSingleSource && this.groups.size === 1;
  }

  getGroups(): IssueGroup[] {
    if (!this.isSignedIn()) {
      return [];
    }
    const next = new Map<string, IssueGroup>();
    for (const source of this.getSources()) {
      next.set(source.id, this.groups.get(source.id) ?? new IssueGroup(source, maxIssuesPerList()));
    }
    this.groups = next;
    return [...next.values()];
  }

  findGroup(id: string): IssueGroup | undefined {
    return this.groups.get(id);
  }

  findIssue(key: string): Issue | undefined {
    for (const group of this.groups.values()) {
      const issue = group.issues.find((candidate) => issueKey(candidate) === key);
      if (issue) {
        return issue;
      }
    }
    return undefined;
  }

  owns(group: IssueGroup): boolean {
    return this.groups.get(group.source.id) === group;
  }

  /** Resolves with the first page. Later pages keep arriving through onDidChange. */
  load(group: IssueGroup): Promise<void> {
    group.firstPage ??= this.fetchNextPage(group).then(() => {
      void this.loadRemaining(group);
    });
    return group.firstPage;
  }

  async loadMore(group: IssueGroup): Promise<void> {
    group.limit += maxIssuesPerList();
    await this.loadRemaining(group);
  }

  dispose(): void {
    this.changed.dispose();
  }

  private async fetchNextPage(group: IssueGroup): Promise<void> {
    try {
      const page = await group.source.fetchPage(this.filter.value, group.cursor);
      // Search pages by offset, so an update during loading can repeat an
      // issue, and a tree throws on duplicate ids.
      const loaded = new Set(group.issues.map(issueKey));
      group.issues.push(...page.issues.filter((issue) => !loaded.has(issueKey(issue))));
      group.total = page.total;
      group.cursor = page.cursor;
      group.hasMore = page.hasMore;
    } catch (error) {
      group.error = (error as Error).message;
    }
    group.loaded = true;
  }

  /** Issues appear page by page so a large repository is usable right away. */
  private async loadRemaining(group: IssueGroup): Promise<void> {
    const canContinue = () =>
      this.owns(group) && group.hasMore && !group.error && group.issues.length < group.limit;
    group.loading = canContinue();
    this.fire(group);
    while (canContinue()) {
      await this.fetchNextPage(group);
      group.loading = canContinue();
      if (this.owns(group)) {
        this.fire(group);
      }
    }
  }

  private fire(group: IssueGroup): void {
    // A flat list has no heading item of its own to refresh.
    this.changed.fire(this.isFlat ? undefined : group);
  }
}
