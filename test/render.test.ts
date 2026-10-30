import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderErrorPage, renderIssuePage, type PageContext } from '../src/detail/render';
import type { IssueDetail } from '../src/types';

const context: PageContext = {
  cspSource: 'https://webview.example',
  nonce: 'abc123',
  styleUri: 'https://webview.example/detail.css',
  scriptUri: 'https://webview.example/detail.js',
};

const issue: IssueDetail = {
  repo: 'acme/app',
  number: 42,
  title: '<img src=x onerror=alert(1)>',
  state: 'OPEN',
  stateReason: null,
  url: 'https://github.com/acme/app/issues/42',
  body: 'body',
  bodyHTML: '<p>rendered <strong>body</strong></p>',
  author: 'octocat',
  authorAvatarUrl: 'https://avatars.example/1',
  labels: [
    { name: '<b>bug</b>', color: 'ffffff' },
    { name: 'dark', color: '000000' },
    { name: 'injected', color: 'red}body{display:none' },
  ],
  assignees: [],
  milestone: null,
  createdAt: '2026-01-02T10:00:00Z',
  updatedAt: '2026-01-05T10:00:00Z',
  commentCount: 0,
  comments: [],
};

test('escapes issue text but keeps GitHub-sanitized HTML', () => {
  const html = renderIssuePage(issue, context);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;b&gt;bug&lt;\/b&gt;/);
  assert.match(html, /<p>rendered <strong>body<\/strong><\/p>/);
});

test('locks the page down with a nonce-based CSP', () => {
  const html = renderIssuePage(issue, context);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'nonce-abc123'/);
  assert.doesNotMatch(html, /unsafe-inline/);
  assert.match(html, /<script nonce="abc123"/);
});

test('picks readable label text and refuses malformed colors', () => {
  const html = renderIssuePage(issue, context);
  assert.match(html, /\.label-0 \{ background: #ffffff; color: #1f2328; \}/);
  assert.match(html, /\.label-1 \{ background: #000000; color: #ffffff; \}/);
  assert.doesNotMatch(html, /display:none/);
});

test('falls back when there is no description', () => {
  assert.match(renderIssuePage({ ...issue, bodyHTML: '' }, context), /No description provided/);
});

test('escapes error messages', () => {
  const html = renderErrorPage(issue, '<script>alert(1)</script>', context);
  assert.doesNotMatch(html, /<script>alert/);
});

test('offers both copy actions and an accessible refresh', () => {
  const html = renderIssuePage(issue, context);
  assert.match(html, /data-action="copy"/);
  assert.match(html, /data-action="copyUrl"/);
  assert.match(html, /aria-label="Refresh"/);
});
