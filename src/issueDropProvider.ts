import * as vscode from 'vscode';
import { ISSUE_MIME, type DraggedIssues } from './tree/dragController';

const MARKDOWN_KIND = vscode.DocumentDropOrPasteEditKind.Text.append('githubIssue', 'markdown');
const LINK_KIND = vscode.DocumentDropOrPasteEditKind.Text.append('githubIssue', 'link');

/**
 * Editors skip their plain text drop when a URI is also present, so without
 * this a dragged issue would insert the path of its Markdown file.
 */
export class IssueDropProvider implements vscode.DocumentDropEditProvider {
  async provideDocumentDropEdits(
    _document: vscode.TextDocument,
    _position: vscode.Position,
    dataTransfer: vscode.DataTransfer,
  ): Promise<vscode.DocumentDropEdit[] | undefined> {
    const raw = await dataTransfer.get(ISSUE_MIME)?.asString();
    if (!raw) {
      return undefined;
    }
    const dragged = JSON.parse(raw) as DraggedIssues;
    return [
      new vscode.DocumentDropEdit(
        new vscode.SnippetString().appendText(dragged.markdown),
        'Insert Issue as Markdown',
        MARKDOWN_KIND,
      ),
      new vscode.DocumentDropEdit(
        new vscode.SnippetString().appendText(dragged.links),
        'Insert Issue Link',
        LINK_KIND,
      ),
    ];
  }
}

export function registerIssueDropProvider(): vscode.Disposable {
  return vscode.languages.registerDocumentDropEditProvider('*', new IssueDropProvider(), {
    dropMimeTypes: [ISSUE_MIME],
    providedDropEditKinds: [MARKDOWN_KIND, LINK_KIND],
  });
}
