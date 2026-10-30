import { ICONS } from '../icons';
import { stateLabel } from '../markdown';
import type { Issue, IssueComment, IssueDetail, IssueLabel } from '../types';

export interface PageContext {
  cspSource: string;
  nonce: string;
  styleUri: string;
  scriptUri: string;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Both states stay in the layout, so the toolbar does not shift on confirmation. */
function copyButton(action: string, label: string, buttonIcon: string): string {
  return `<button data-action="${action}">
    <span class="swap"><span class="idle">${buttonIcon}</span><span class="confirmed">${ICONS.check}</span></span>
    <span class="swap"><span class="idle">${label}</span><span class="confirmed">Copied</span></span>
  </button>`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function page(context: PageContext, title: string, body: string, extraStyle = ''): string {
  const { cspSource, nonce, styleUri, scriptUri } = context;
  const csp = [
    "default-src 'none'",
    'img-src https: data:',
    'media-src https:',
    `style-src ${cspSource} 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${styleUri}">
  <style nonce="${nonce}">${extraStyle}</style>
</head>
<body>
  ${body}
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function stateClass(issue: Issue): string {
  if (issue.state === 'OPEN') {
    return 'state-open';
  }
  return issue.stateReason === 'NOT_PLANNED' || issue.stateReason === 'DUPLICATE'
    ? 'state-not-planned'
    : 'state-closed';
}

function labelStyles(labels: readonly IssueLabel[]): string {
  return labels
    .map((label, index) => {
      if (!/^[0-9a-f]{6}$/i.test(label.color)) {
        return '';
      }
      const channel = (offset: number) => parseInt(label.color.slice(offset, offset + 2), 16);
      const luminance = 0.299 * channel(0) + 0.587 * channel(2) + 0.114 * channel(4);
      return `.label-${index} { background: #${label.color}; color: ${luminance > 150 ? '#1f2328' : '#ffffff'}; }`;
    })
    .join('\n');
}

function people(logins: readonly string[]): string {
  return logins.map((login) => `<span class="person">@${escapeHtml(login)}</span>`).join(' ');
}

function avatar(url: string): string {
  return url ? `<img class="avatar" src="${escapeHtml(url)}" alt="">` : '<span class="avatar"></span>';
}

function post(author: string, avatarUrl: string, createdAt: string, bodyHTML: string, url?: string): string {
  const date = escapeHtml(formatDate(createdAt));
  return `
    <article class="post">
      <header class="post-header">
        ${avatar(avatarUrl)}
        <strong>${escapeHtml(author)}</strong>
        ${url ? `<a class="muted" href="${escapeHtml(url)}">${date}</a>` : `<span class="muted">${date}</span>`}
      </header>
      <div class="post-body">${bodyHTML || '<p class="muted"><em>No description provided.</em></p>'}</div>
    </article>`;
}

function comment(item: IssueComment): string {
  return post(item.author, item.avatarUrl, item.createdAt, item.bodyHTML, item.url);
}

function sidebarRow(title: string, content: string): string {
  return `<div class="sidebar-row"><h2>${title}</h2>${content}</div>`;
}

/** `bodyHTML` is GitHub's sanitized output. All other values are escaped here. */
export function renderIssuePage(issue: IssueDetail, context: PageContext): string {
  const labels = issue.labels
    .map((label, index) => `<span class="label label-${index}">${escapeHtml(label.name)}</span>`)
    .join(' ');
  const none = '<span class="muted">None</span>';

  const body = `
    <h1>${escapeHtml(issue.title)} <span class="muted">#${issue.number}</span></h1>
    <div class="action-bar">
      <p class="summary">
        <span class="state ${stateClass(issue)}">${escapeHtml(stateLabel(issue))}</span>
        <span class="muted">${escapeHtml(issue.repo)} · opened by @${escapeHtml(issue.author)}
        on ${escapeHtml(formatDate(issue.createdAt))} · ${issue.comments.length} comment(s)</span>
      </p>
      <div class="toolbar" role="toolbar" aria-label="Issue actions">
        ${copyButton('copy', 'Copy as Markdown', ICONS.copy)}
        ${copyButton('copyUrl', 'Copy URL', ICONS.link)}
        <span class="divider"></span>
        <button data-action="open">${ICONS.external}Open on GitHub</button>
        <button data-action="refresh" class="icon-only" title="Refresh" aria-label="Refresh">${ICONS.refresh}</button>
      </div>
    </div>
    <div class="layout">
      <main>
        ${post(issue.author, issue.authorAvatarUrl, issue.createdAt, issue.bodyHTML)}
        ${issue.comments.map(comment).join('')}
      </main>
      <aside>
        ${sidebarRow('Assignees', issue.assignees.length ? people(issue.assignees) : none)}
        ${sidebarRow('Labels', labels || none)}
        ${sidebarRow('Milestone', issue.milestone ? escapeHtml(issue.milestone) : none)}
      </aside>
    </div>`;
  return page(context, issue.title, body, labelStyles(issue.labels));
}

export function renderLoadingPage(issue: Issue, context: PageContext): string {
  return page(
    context,
    issue.title,
    `<h1>${escapeHtml(issue.title)} <span class="muted">#${issue.number}</span></h1>
     <p class="muted">Loading issue…</p>`,
  );
}

export function renderErrorPage(issue: Issue, message: string, context: PageContext): string {
  return page(
    context,
    issue.title,
    `<h1>${escapeHtml(issue.title)} <span class="muted">#${issue.number}</span></h1>
     <p class="error">${escapeHtml(message)}</p>
     <div class="error-actions">
       <button data-action="refresh" class="primary">Try Again</button>
       <button data-action="open">Open on GitHub</button>
     </div>`,
  );
}
