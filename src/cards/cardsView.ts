import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { IssueList } from '../issueList';
import type { Issue, RepoRef } from '../types';
import { toCardGroup, type CardAction, type CardsMessage, type CardsUpdate } from './cardModel';

export interface CardHandlers {
  open(issue: Issue): Promise<void>;
  run(action: CardAction, issue: Issue): Promise<void>;
  removeRepository(repo: RepoRef): Promise<void>;
  refresh(): Promise<void>;
}

/**
 * The detailed style. Chromium blocks drags from a webview into the rest of
 * the window (crbug.com/59081), so cards offer copy actions instead of drag.
 */
export class IssueCardsView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private readonly subscription: vscode.Disposable;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly list: IssueList,
    private readonly options: { showRepo: boolean },
    private readonly handlers: CardHandlers,
  ) {
    this.subscription = list.onDidChange(() => this.publish());
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const root = (...path: string[]) => vscode.Uri.joinPath(this.extensionUri, ...path);
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [root('media'), root('dist', 'webview')],
    };
    const nonce = randomBytes(16).toString('base64');
    const style = view.webview.asWebviewUri(root('media', 'cards.css'));
    const script = view.webview.asWebviewUri(root('dist', 'webview', 'cards.js'));
    view.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}'">
  <link rel="stylesheet" href="${style}">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
    view.webview.onDidReceiveMessage((message: CardsMessage) => void this.handle(message));
    view.onDidDispose(() => {
      this.view = undefined;
    });
  }

  dispose(): void {
    this.subscription.dispose();
  }

  private publish(): void {
    const view = this.view;
    if (!view) {
      return;
    }
    view.description = this.list.summary;
    const groups = this.list.getGroups();
    for (const group of groups) {
      if (group.source.expanded) {
        void this.list.load(group);
      }
    }
    this.post({
      type: 'state',
      state: {
        flat: this.list.isFlat,
        groups: groups.map((group) => toCardGroup(group, this.options)),
      },
    });
  }

  private post(update: CardsUpdate): void {
    void this.view?.webview.postMessage(update);
  }

  private async handle(message: CardsMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.publish();
        break;
      case 'open': {
        const issue = this.list.findIssue(message.key);
        if (issue) {
          await this.handlers.open(issue);
        }
        break;
      }
      case 'action': {
        const issue = this.list.findIssue(message.key);
        if (issue) {
          await this.handlers.run(message.action, issue);
          this.post({ type: 'done', action: message.action, key: message.key });
        }
        break;
      }
      case 'expand': {
        const group = this.list.findGroup(message.groupId);
        if (group) {
          await this.list.load(group);
        }
        break;
      }
      case 'loadMore': {
        const group = this.list.findGroup(message.groupId);
        if (group) {
          await this.list.loadMore(group);
        }
        break;
      }
      case 'remove': {
        const repo = this.list.findGroup(message.groupId)?.source.removableRepo;
        if (repo) {
          await this.handlers.removeRepository(repo);
        }
        break;
      }
      case 'retry':
        await this.handlers.refresh();
        break;
    }
  }
}
