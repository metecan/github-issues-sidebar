import * as vscode from 'vscode';
import { issueFileName } from './markdown';
import type { Issue } from './types';

/**
 * Issues as Markdown files on disk. A tree item drag can only hand a webview
 * a resource URI, never text, so a real file is what lets agent inputs,
 * terminals and the Explorer accept a dragged issue.
 */
export class IssueFiles {
  private readonly root: vscode.Uri;

  constructor(globalStorageUri: vscode.Uri) {
    // On desktop this is a vscode-userdata: URI, which only VS Code can read.
    // Other extensions' webviews ignore anything but file: and vscode-remote:.
    const storage =
      globalStorageUri.scheme === 'vscode-userdata' ? vscode.Uri.file(globalStorageUri.fsPath) : globalStorageUri;
    this.root = vscode.Uri.joinPath(storage, 'issues');
  }

  uriFor(issue: Issue): vscode.Uri {
    const [owner, name] = issue.repo.split('/');
    return vscode.Uri.joinPath(this.root, owner, name, issueFileName(issue));
  }

  async write(issue: Issue, markdown: string): Promise<void> {
    await vscode.workspace.fs.writeFile(this.uriFor(issue), new TextEncoder().encode(markdown));
  }
}
