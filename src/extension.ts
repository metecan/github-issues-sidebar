import * as vscode from 'vscode';
import { AuthManager } from './auth';
import type { CardAction } from './cards/cardModel';
import { IssueCardsView } from './cards/cardsView';
import { IssueDetailPanel } from './detail/detailPanel';
import { FilterState, STATE_LABELS } from './filterState';
import { GitHubClient } from './github/client';
import { parseRepo } from './github/repoRef';
import { buildSearchQuery } from './github/search';
import { registerIssueDropProvider } from './issueDropProvider';
import { IssueFiles } from './issueFiles';
import { IssueList, type IssueGroup, type IssueSource } from './issueList';
import { IssueStore } from './issueStore';
import { joinMarkdown } from './markdown';
import { RepositoryService } from './repositories';
import { IssueDragController } from './tree/dragController';
import { IssuesTreeProvider, issuesIn, type IssueNode, type TreeNode } from './tree/issuesTree';
import { repoKey, type Issue, type StateFilter } from './types';

const MY_ISSUES = [
  { id: 'assigned', label: 'Assigned to Me', icon: 'account', qualifier: 'assignee:@me', expanded: true },
  { id: 'created', label: 'Created by Me', icon: 'edit', qualifier: 'author:@me', expanded: false },
  { id: 'mentioned', label: 'Mentioned', icon: 'mention', qualifier: 'mentions:@me', expanded: false },
];

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('GitHub Issues', { log: true });
  const auth = new AuthManager(log);
  const client = new GitHubClient(auth);
  const repositories = new RepositoryService();
  const filter = new FilterState(context.workspaceState);
  const store = new IssueStore(client);
  const files = new IssueFiles(context.globalStorageUri);
  const isSignedIn = () => auth.current.status === 'signedIn';

  const repoSources = (): IssueSource[] =>
    repositories.repositories.map(({ ref, manual }) => ({
      id: repoKey(ref).toLowerCase(),
      label: repoKey(ref),
      icon: 'repo',
      contextValue: manual ? 'repository.manual' : 'repository',
      expanded: true,
      removableRepo: manual ? ref : undefined,
      fetchPage: (issueFilter, after) =>
        issueFilter.query
          ? client.searchIssues(buildSearchQuery(`repo:${repoKey(ref)}`, issueFilter), after)
          : client.listRepoIssues(ref, issueFilter.state, after),
    }));

  const mySources = (): IssueSource[] =>
    MY_ISSUES.map(({ id, label, icon, qualifier, expanded }) => ({
      id,
      label,
      icon,
      contextValue: 'search',
      expanded,
      fetchPage: (issueFilter, after) =>
        client.searchIssues(buildSearchQuery(`${qualifier} archived:false`, issueFilter), after),
    }));

  const repoList = new IssueList(repoSources, isSignedIn, filter, { flattenSingleSource: true });
  const myList = new IssueList(mySources, isSignedIn, filter, { flattenSingleSource: false });

  const dragAndDropController = new IssueDragController(store, files);
  const repoView = vscode.window.createTreeView('ghIssues.repoIssues', {
    treeDataProvider: new IssuesTreeProvider(repoList, files, { showRepo: false }),
    dragAndDropController,
    canSelectMany: true,
  });
  const myView = vscode.window.createTreeView('ghIssues.myIssues', {
    treeDataProvider: new IssuesTreeProvider(myList, files, { showRepo: true }),
    dragAndDropController,
    canSelectMany: true,
    showCollapseAll: true,
  });

  const updateDescriptions = () => {
    repoView.description = repoList.summary;
    myView.description = myList.summary;
  };
  const refreshLists = () => {
    repoList.refresh();
    myList.refresh();
  };
  const refresh = async () => {
    await auth.check();
    refreshLists();
  };

  const syncIssueStyle = () => {
    const style = vscode.workspace.getConfiguration('ghIssues').get<string>('issueStyle', 'list');
    void vscode.commands.executeCommand('setContext', 'ghIssues.issueStyle', style);
  };
  const setIssueStyle = (style: 'list' | 'cards') =>
    vscode.workspace.getConfiguration('ghIssues').update('issueStyle', style, vscode.ConfigurationTarget.Global);

  // Cmd+C has no arguments, so remember what the user last selected.
  let lastSelection: readonly TreeNode[] = [];
  const trackSelection = (event: vscode.TreeViewSelectionChangeEvent<TreeNode>) => {
    lastSelection = event.selection;
  };

  const issuesFrom = (node?: TreeNode, nodes?: readonly TreeNode[]): Issue[] => {
    return issuesIn(node ? (nodes?.includes(node) ? nodes : [node]) : lastSelection);
  };

  const subjectOf = (issues: readonly Issue[]) =>
    issues.length === 1 ? `#${issues[0].number}` : `${issues.length} issues`;

  const copyAsMarkdown = async (issues: readonly Issue[]) => {
    if (issues.length === 0) {
      return;
    }
    const documents = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window }, () =>
      store.toMarkdownAll(issues),
    );
    await vscode.env.clipboard.writeText(joinMarkdown(documents));
    vscode.window.setStatusBarMessage(`$(check) Copied ${subjectOf(issues)} as Markdown`, 3000);
  };

  const copyUrls = async (issues: readonly Issue[]) => {
    if (issues.length === 0) {
      return;
    }
    await vscode.env.clipboard.writeText(issues.map((issue) => issue.url).join('\n'));
    const noun = issues.length === 1 ? 'URL' : 'URLs';
    vscode.window.setStatusBarMessage(`$(check) Copied ${noun} for ${subjectOf(issues)}`, 3000);
  };

  const details = new IssueDetailPanel(context.extensionUri, store, {
    copyAsMarkdown: (issue) => copyAsMarkdown([issue]),
    copyUrl: (issue) => copyUrls([issue]),
  });

  const openOnGitHub = async (issue: Issue) => {
    await vscode.env.openExternal(vscode.Uri.parse(issue.url));
  };

  const cardActions: Record<CardAction, (issue: Issue) => Promise<void>> = {
    copyMarkdown: (issue) => copyAsMarkdown([issue]),
    copyUrl: (issue) => copyUrls([issue]),
    openOnGitHub,
  };
  const cardHandlers = {
    open: (issue: Issue) => details.show(issue),
    run: (action: CardAction, issue: Issue) => cardActions[action](issue),
    removeRepository: (repo: Parameters<typeof repositories.remove>[0]) => repositories.remove(repo),
    refresh,
  };
  const repoCards = new IssueCardsView(context.extensionUri, repoList, { showRepo: false }, cardHandlers);
  const myCards = new IssueCardsView(context.extensionUri, myList, { showRepo: true }, cardHandlers);
  const retainCards = { webviewOptions: { retainContextWhenHidden: true } };

  const register = (command: string, handler: (...args: never[]) => unknown) =>
    vscode.commands.registerCommand(command, handler);

  context.subscriptions.push(
    log,
    auth,
    repositories,
    filter,
    repoList,
    myList,
    repoView,
    myView,
    repoCards,
    myCards,
    details,
    vscode.window.registerWebviewViewProvider('ghIssues.repoCards', repoCards, retainCards),
    vscode.window.registerWebviewViewProvider('ghIssues.myCards', myCards, retainCards),
    registerIssueDropProvider(),
    repoView.onDidChangeSelection(trackSelection),
    myView.onDidChangeSelection(trackSelection),
    repoList.onDidChange(updateDescriptions),
    myList.onDidChange(updateDescriptions),
    auth.onDidChange(refreshLists),
    filter.onDidChange(refreshLists),
    repositories.onDidChange(() => repoList.refresh()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('ghIssues.issueStyle')) {
        syncIssueStyle();
      }
    }),

    register('ghIssues.refresh', refresh),
    register('ghIssues.useCards', () => setIssueStyle('cards')),
    register('ghIssues.useList', () => setIssueStyle('list')),
    register('ghIssues.setStateFilter', async () => {
      const current = filter.value.state;
      const choices = (Object.keys(STATE_LABELS) as StateFilter[]).map((state) => ({
        label: STATE_LABELS[state],
        description: state === current ? 'Current' : undefined,
        state,
      }));
      const picked = await vscode.window.showQuickPick(choices, { placeHolder: 'Show issues with state' });
      if (picked) {
        filter.update({ state: picked.state });
      }
    }),
    register('ghIssues.search', async () => {
      const query = await vscode.window.showInputBox({
        title: 'Search Issues',
        prompt: 'Text or GitHub search syntax, such as label:bug author:octocat',
        value: filter.value.query,
      });
      if (query !== undefined) {
        filter.update({ query: query.trim() });
      }
    }),
    register('ghIssues.clearSearch', () => filter.update({ query: '' })),
    register('ghIssues.addRepository', async () => {
      const input = await vscode.window.showInputBox({
        title: 'Add Repository',
        prompt: 'owner/name or a GitHub URL',
        validateInput: (value) => (parseRepo(value) ? undefined : 'Enter owner/name or a GitHub URL'),
      });
      const repo = input ? parseRepo(input) : undefined;
      if (repo) {
        await repositories.add(repo);
      }
    }),
    register('ghIssues.removeRepository', async (group: IssueGroup) => {
      if (group.source.removableRepo) {
        await repositories.remove(group.source.removableRepo);
      }
    }),
    register('ghIssues.openIssue', async (node: IssueNode) => {
      await details.show(node.issue);
    }),
    register('ghIssues.copyAsMarkdown', (node?: TreeNode, nodes?: readonly TreeNode[]) =>
      copyAsMarkdown(issuesFrom(node, nodes)),
    ),
    register('ghIssues.copyUrl', (node?: TreeNode, nodes?: readonly TreeNode[]) =>
      copyUrls(issuesFrom(node, nodes)),
    ),
    register('ghIssues.openOnGitHub', (node: IssueNode) => openOnGitHub(node.issue)),
    register('ghIssues.loadMore', (group: IssueGroup) =>
      (myList.owns(group) ? myList : repoList).loadMore(group),
    ),
    register('ghIssues.loginWithGh', () => auth.loginWithGh()),
    register('ghIssues.loginWithVSCode', () => auth.loginWithVSCode()),
  );

  syncIssueStyle();
  updateDescriptions();
  void auth.check();
}

export function deactivate(): void {}
