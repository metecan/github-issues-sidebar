import * as vscode from 'vscode';
import type { IssueFiles } from '../issueFiles';
import { IssueGroup, type IssueList } from '../issueList';
import { issueDescription, stateLabel } from '../markdown';
import { issueKey, type Issue } from '../types';

export class IssueNode {
  constructor(
    readonly issue: Issue,
    readonly sourceId: string,
  ) {}
}

export class LoadMoreNode {
  constructor(readonly parent: IssueGroup) {}
}

export class MessageNode {
  constructor(
    readonly text: string,
    readonly icon: string,
    readonly id: string,
    readonly command?: vscode.Command,
  ) {}
}

export type TreeNode = IssueGroup | IssueNode | LoadMoreNode | MessageNode;

/** My Issues can show one issue in several sections. */
export function issuesIn(nodes: readonly TreeNode[]): Issue[] {
  const issues = new Map<string, Issue>();
  for (const node of nodes) {
    if (node instanceof IssueNode) {
      issues.set(issueKey(node.issue), node.issue);
    }
  }
  return [...issues.values()];
}

function issueIcon(issue: Issue): vscode.ThemeIcon {
  if (issue.state === 'OPEN') {
    return new vscode.ThemeIcon('issues', new vscode.ThemeColor('charts.green'));
  }
  if (issue.stateReason === 'NOT_PLANNED' || issue.stateReason === 'DUPLICATE') {
    return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('descriptionForeground'));
  }
  return new vscode.ThemeIcon('issue-closed', new vscode.ThemeColor('charts.purple'));
}

function issueTooltip(issue: Issue): vscode.MarkdownString {
  // appendText escapes: issue text is written by strangers.
  const tooltip = new vscode.MarkdownString();
  tooltip.appendText(`${issue.repo}#${issue.number}: ${issue.title}\n\n`);
  tooltip.appendText(`${stateLabel(issue)} · @${issue.author} · ${issue.commentCount} comment(s)\n\n`);
  if (issue.labels.length) {
    tooltip.appendText(`${issue.labels.map((label) => label.name).join(', ')}\n\n`);
  }
  const excerpt = issue.body.trim().slice(0, 300);
  if (excerpt) {
    tooltip.appendText(excerpt);
  }
  return tooltip;
}

/** The one-line style. Native rows are the only ones that can be dragged out. */
export class IssuesTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined>;

  constructor(
    private readonly list: IssueList,
    private readonly files: IssueFiles,
    private readonly options: { showRepo: boolean },
  ) {
    this.onDidChangeTreeData = list.onDidChange;
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node instanceof IssueNode) {
      return this.issueItem(node);
    }
    if (node instanceof IssueGroup) {
      const { source } = node;
      const item = new vscode.TreeItem(
        source.label,
        source.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.id = `source:${source.id}`;
      item.iconPath = new vscode.ThemeIcon(source.icon);
      item.contextValue = source.contextValue;
      item.description = node.loaded && !node.error ? node.total.toLocaleString() : undefined;
      return item;
    }
    if (node instanceof LoadMoreNode) {
      const { parent } = node;
      const item = new vscode.TreeItem(
        `Load more (${parent.issues.length.toLocaleString()} of ${parent.total.toLocaleString()})`,
      );
      item.id = `more:${parent.source.id}`;
      item.iconPath = new vscode.ThemeIcon('chevron-down');
      item.command = { command: 'ghIssues.loadMore', title: 'Load More', arguments: [parent] };
      return item;
    }
    const item = new vscode.TreeItem(node.text);
    item.id = node.id;
    item.iconPath = new vscode.ThemeIcon(node.icon);
    item.command = node.command;
    item.tooltip = node.text;
    return item;
  }

  async getChildren(node?: TreeNode): Promise<TreeNode[]> {
    if (node instanceof IssueGroup) {
      return this.childrenOf(node);
    }
    if (node) {
      return [];
    }
    const groups = this.list.getGroups();
    return this.list.isFlat ? this.childrenOf(groups[0]) : groups;
  }

  private async childrenOf(group: IssueGroup): Promise<TreeNode[]> {
    await this.list.load(group);

    const id = group.source.id;
    if (group.error) {
      return [new MessageNode(group.error, 'warning', `error:${id}`, { command: 'ghIssues.refresh', title: 'Retry' })];
    }
    const children: TreeNode[] = group.issues.map((issue) => new IssueNode(issue, id));
    if (children.length === 0 && !group.loading) {
      return [new MessageNode('No issues found', 'info', `empty:${id}`)];
    }
    if (group.loading) {
      const progress = `Loading ${group.issues.length.toLocaleString()} of ${group.total.toLocaleString()}…`;
      children.push(new MessageNode(progress, 'loading~spin', `loading:${id}`));
    } else if (group.hasMore) {
      children.push(new LoadMoreNode(group));
    }
    return children;
  }

  private issueItem(node: IssueNode): vscode.TreeItem {
    const { issue } = node;
    const item = new vscode.TreeItem(issue.title);
    item.id = `${node.sourceId}:${issueKey(issue)}`;
    item.description = issueDescription(issue, { showRepo: this.options.showRepo });
    item.iconPath = issueIcon(issue);
    item.tooltip = issueTooltip(issue);
    item.contextValue = 'issue';
    item.resourceUri = this.files.uriFor(issue);
    item.command = { command: 'ghIssues.openIssue', title: 'Open Issue Details', arguments: [node] };
    return item;
  }
}
