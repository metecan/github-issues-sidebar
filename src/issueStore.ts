import * as vscode from 'vscode';
import type { GitHubClient } from './github/client';
import { issueToMarkdown } from './markdown';
import { mapWithLimit } from './mapWithLimit';
import { issueKey, type Issue, type IssueDetail } from './types';

// Selecting a whole list would otherwise trip GitHub's secondary rate limit.
const MAX_CONCURRENT_REQUESTS = 6;

export class IssueStore {
  private readonly details = new Map<string, IssueDetail>();

  constructor(private readonly client: GitHubClient) {}

  async getDetail(issue: Issue, options: { force?: boolean } = {}): Promise<IssueDetail> {
    const key = issueKey(issue);
    const cached = this.details.get(key);
    if (cached && !options.force && cached.updatedAt === issue.updatedAt) {
      return cached;
    }
    const detail = await this.client.getIssue(issue.repo, issue.number);
    this.details.set(key, detail);
    return detail;
  }

  toMarkdownAll(issues: readonly Issue[]): Promise<string[]> {
    return mapWithLimit(issues, MAX_CONCURRENT_REQUESTS, (issue) => this.toMarkdown(issue));
  }

  /** Falls back to the list data if comments cannot be fetched. */
  private async toMarkdown(issue: Issue): Promise<string> {
    const includeComments = vscode.workspace.getConfiguration('ghIssues').get<boolean>('includeComments', true);
    if (!includeComments || issue.commentCount === 0) {
      return issueToMarkdown(issue, []);
    }
    try {
      const detail = await this.getDetail(issue);
      return issueToMarkdown(detail, detail.comments);
    } catch {
      return issueToMarkdown(issue);
    }
  }
}
