import * as vscode from 'vscode';
import type { IssueFiles } from '../issueFiles';
import type { IssueStore } from '../issueStore';
import { issueLink, issueToMarkdown, joinMarkdown } from '../markdown';
import { issuesIn, type TreeNode } from './issuesTree';

export const ISSUE_MIME = 'application/vnd.github-issues-sidebar.issues+json';

export interface DraggedIssues {
  markdown: string;
  links: string;
}

export class IssueDragController implements vscode.TreeDragAndDropController<TreeNode> {
  // text/uri-list must stay out of this list. VS Code would blank the
  // ResourceURLs entry it derives from each item's resourceUri, and that entry
  // is what webview agent inputs and terminals read.
  readonly dragMimeTypes = ['text/plain', ISSUE_MIME];
  readonly dropMimeTypes: string[] = [];

  constructor(
    private readonly store: IssueStore,
    private readonly files: IssueFiles,
  ) {}

  async handleDrag(source: readonly TreeNode[], dataTransfer: vscode.DataTransfer): Promise<void> {
    const issues = issuesIn(source);
    if (issues.length === 0) {
      return;
    }

    // File targets read the file as soon as the drop lands, so put what is
    // already known on disk before waiting on the network for comments.
    await Promise.all(issues.map((issue) => this.files.write(issue, issueToMarkdown(issue))));

    const documents = await this.store.toMarkdownAll(issues);
    await Promise.all(issues.map((issue, index) => this.files.write(issue, documents[index])));

    const markdown = joinMarkdown(documents);
    const dragged: DraggedIssues = { markdown, links: issues.map(issueLink).join('\n') };
    const uris = issues.map((issue) => this.files.uriFor(issue).toString());
    dataTransfer.set('text/plain', new vscode.DataTransferItem(markdown));
    dataTransfer.set(ISSUE_MIME, new vscode.DataTransferItem(JSON.stringify(dragged)));
    // Undeclared on purpose (see dragMimeTypes). An editor group opens this on
    // a drop without Shift; VS Code only logs a warning about it.
    dataTransfer.set('text/uri-list', new vscode.DataTransferItem(uris.join('\r\n')));
  }
}
