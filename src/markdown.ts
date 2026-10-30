import type { Issue, IssueComment } from './types';

const SLUG_MAX_LENGTH = 60;

export function stateLabel(issue: Issue): string {
  if (issue.state === 'OPEN') {
    return 'Open';
  }
  if (issue.stateReason === 'NOT_PLANNED') {
    return 'Closed (not planned)';
  }
  if (issue.stateReason === 'DUPLICATE') {
    return 'Closed (duplicate)';
  }
  return 'Closed';
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

function mentions(logins: readonly string[]): string {
  return logins.map((login) => `@${login}`).join(', ');
}

/**
 * Pass `comments` once they have been fetched, or an empty list to leave them
 * out. Without it the output says how many comments are missing, so a reader
 * knows the conversation is not all there.
 */
export function issueToMarkdown(issue: Issue, comments?: readonly IssueComment[]): string {
  const meta: [string, string][] = [
    ['Repository', issue.repo],
    ['URL', issue.url],
    ['State', stateLabel(issue)],
    ['Author', `@${issue.author}`],
  ];
  if (issue.assignees.length) {
    meta.push(['Assignees', mentions(issue.assignees)]);
  }
  if (issue.labels.length) {
    meta.push(['Labels', issue.labels.map((label) => label.name).join(', ')]);
  }
  if (issue.milestone) {
    meta.push(['Milestone', issue.milestone]);
  }
  meta.push(['Created', day(issue.createdAt)], ['Updated', day(issue.updatedAt)]);

  const sections = [
    `# ${issue.title} (#${issue.number})`,
    meta.map(([name, value]) => `- **${name}:** ${value}`).join('\n'),
    '## Description',
    issue.body.trim() || '_No description provided._',
  ];

  if (comments === undefined && issue.commentCount > 0) {
    sections.push('## Comments', `_${issue.commentCount} comment(s) not included. See the URL above._`);
  } else if (comments?.length) {
    sections.push(`## Comments (${comments.length})`);
    for (const comment of comments) {
      sections.push(`### @${comment.author} on ${day(comment.createdAt)}`, comment.body.trim());
    }
  }
  return `${sections.join('\n\n')}\n`;
}

export function joinMarkdown(documents: readonly string[]): string {
  return documents.join('\n---\n\n');
}

export function issueLink(issue: Issue): string {
  const title = issue.title.replace(/[[\]\\]/g, '\\$&');
  return `[${issue.repo}#${issue.number}: ${title}](${issue.url})`;
}

/** Stays free of `#` and spaces, which AI agent inputs treat as mention syntax. */
export function issueFileName(issue: Pick<Issue, 'number' | 'title'>): string {
  const slug = issue.title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/^-+|-+$/g, '');
  return slug ? `issue-${issue.number}-${slug}.md` : `issue-${issue.number}.md`;
}

/** The milestone if the issue has one, otherwise its labels. */
export function issueTags(issue: Pick<Issue, 'milestone' | 'labels'>): string {
  return issue.milestone ?? issue.labels.map((label) => label.name).join(', ');
}

/** Follows the title on a list row, as in "#12 - bug, ui · 3h". */
export function issueDescription(
  issue: Pick<Issue, 'repo' | 'number' | 'milestone' | 'labels' | 'updatedAt'>,
  options: { showRepo: boolean; now?: number },
): string {
  const reference = options.showRepo ? `${issue.repo}#${issue.number}` : `#${issue.number}`;
  const tags = issueTags(issue);
  const age = relativeTime(issue.updatedAt, options.now);
  return tags ? `${reference} - ${tags} · ${age}` : `${reference} · ${age}`;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  const units: [number, string][] = [
    [31_536_000, 'y'],
    [2_592_000, 'mo'],
    [604_800, 'w'],
    [86_400, 'd'],
    [3_600, 'h'],
    [60, 'm'],
  ];
  for (const [size, suffix] of units) {
    if (seconds >= size) {
      return `${Math.floor(seconds / size)}${suffix}`;
    }
  }
  return 'now';
}
