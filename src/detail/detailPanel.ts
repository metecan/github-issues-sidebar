import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { IssueStore } from '../issueStore';
import type { Issue } from '../types';
import { renderErrorPage, renderIssuePage, renderLoadingPage, type PageContext } from './render';

export interface IssueActions {
  copyAsMarkdown(issue: Issue): Promise<void>;
  copyUrl(issue: Issue): Promise<void>;
}

/** A single panel that follows the clicked issue, like a preview tab. */
export class IssueDetailPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private issue: Issue | undefined;
  private renderId = 0;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: IssueStore,
    private readonly actions: IssueActions,
  ) {}

  async show(issue: Issue): Promise<void> {
    this.issue = issue;
    const panel = this.panel ?? this.createPanel();
    panel.title = `#${issue.number} ${issue.title}`;
    panel.reveal(undefined, true);
    await this.render(issue, false);
  }

  dispose(): void {
    this.panel?.dispose();
  }

  private createPanel(): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
      'ghIssues.detail',
      'GitHub Issue',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'media'),
          vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
        ],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'tab.svg');
    panel.onDidDispose(() => {
      this.panel = undefined;
    });
    panel.webview.onDidReceiveMessage((message: { type?: string }) => {
      void this.handleAction(message.type);
    });
    this.panel = panel;
    return panel;
  }

  private async handleAction(action: string | undefined): Promise<void> {
    const issue = this.issue;
    if (!issue) {
      return;
    }
    if (action === 'copy' || action === 'copyUrl') {
      await (action === 'copy' ? this.actions.copyAsMarkdown(issue) : this.actions.copyUrl(issue));
      void this.panel?.webview.postMessage({ type: 'done', action });
    } else if (action === 'open') {
      await vscode.env.openExternal(vscode.Uri.parse(issue.url));
    } else if (action === 'refresh') {
      await this.render(issue, true);
    }
  }

  private async render(issue: Issue, force: boolean): Promise<void> {
    const panel = this.panel;
    if (!panel) {
      return;
    }
    const renderId = ++this.renderId;
    const context = this.pageContext(panel.webview);
    panel.webview.html = renderLoadingPage(issue, context);
    try {
      const detail = await this.store.getDetail(issue, { force });
      if (renderId === this.renderId) {
        panel.webview.html = renderIssuePage(detail, context);
      }
    } catch (error) {
      if (renderId === this.renderId) {
        panel.webview.html = renderErrorPage(issue, (error as Error).message, context);
      }
    }
  }

  private pageContext(webview: vscode.Webview): PageContext {
    const resource = (...path: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, ...path));
    return {
      cspSource: webview.cspSource,
      nonce: randomBytes(16).toString('base64'),
      styleUri: resource('media', 'detail.css').toString(),
      scriptUri: resource('dist', 'webview', 'detail.js').toString(),
    };
  }
}
