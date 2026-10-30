import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  issueDescription,
  issueFileName,
  issueLink,
  issueTags,
  issueToMarkdown,
  joinMarkdown,
  relativeTime,
} from '../src/markdown';
import type { Issue, IssueComment } from '../src/types';

const issue: Issue = {
  repo: 'acme/app',
  number: 42,
  title: 'Login fails on Safari',
  state: 'OPEN',
  stateReason: null,
  url: 'https://github.com/acme/app/issues/42',
  body: 'Steps to reproduce\n',
  author: 'octocat',
  labels: [{ name: 'bug', color: 'ff0000' }],
  assignees: ['hubot', 'monalisa'],
  milestone: 'v2',
  createdAt: '2026-01-02T10:00:00Z',
  updatedAt: '2026-01-05T10:00:00Z',
  commentCount: 1,
};

const comment: IssueComment = {
  author: 'hubot',
  avatarUrl: '',
  body: 'Confirmed.',
  bodyHTML: '<p>Confirmed.</p>',
  createdAt: '2026-01-03T10:00:00Z',
  url: 'https://github.com/acme/app/issues/42#issuecomment-1',
};

test('renders metadata, body and comments', () => {
  const markdown = issueToMarkdown(issue, [comment]);
  assert.match(markdown, /^# Login fails on Safari \(#42\)\n/);
  assert.match(markdown, /- \*\*URL:\*\* https:\/\/github\.com\/acme\/app\/issues\/42\n/);
  assert.match(markdown, /- \*\*Assignees:\*\* @hubot, @monalisa\n/);
  assert.match(markdown, /- \*\*Labels:\*\* bug\n/);
  assert.match(markdown, /- \*\*Milestone:\*\* v2\n/);
  assert.match(markdown, /## Description\n\nSteps to reproduce\n/);
  assert.match(markdown, /## Comments \(1\)\n\n### @hubot on 2026-01-03\n\nConfirmed\.\n$/);
});

test('omits empty optional metadata', () => {
  const markdown = issueToMarkdown({ ...issue, assignees: [], labels: [], milestone: null, body: '' }, []);
  assert.doesNotMatch(markdown, /Assignees|Labels|Milestone|## Comments/);
  assert.match(markdown, /_No description provided\._/);
});

test('says when comments were not loaded instead of silently dropping them', () => {
  assert.match(issueToMarkdown(issue), /_1 comment\(s\) not included\. See the URL above\._/);
  assert.doesNotMatch(issueToMarkdown(issue, []), /not included/);
});

test('reports closed-state reasons', () => {
  const closed = { ...issue, state: 'CLOSED' as const };
  assert.match(issueToMarkdown(closed, []), /\*\*State:\*\* Closed\n/);
  assert.match(issueToMarkdown({ ...closed, stateReason: 'NOT_PLANNED' }, []), /Closed \(not planned\)/);
});

test('separates multiple issues with a rule that cannot become a setext heading', () => {
  const joined = joinMarkdown([issueToMarkdown(issue, []), issueToMarkdown(issue, [])]);
  assert.match(joined, /\n\n---\n\n# Login/);
});

test('escapes brackets in links', () => {
  assert.equal(
    issueLink({ ...issue, title: 'Fix [auth] flow' }),
    '[acme/app#42: Fix \\[auth\\] flow](https://github.com/acme/app/issues/42)',
  );
});

test('builds file names that are safe for agent mention syntax', () => {
  assert.equal(issueFileName({ number: 42, title: 'Login fails on Safari!' }), 'issue-42-login-fails-on-safari.md');
  assert.equal(issueFileName({ number: 7, title: '../../etc/passwd #1' }), 'issue-7-etc-passwd-1.md');
  assert.equal(issueFileName({ number: 9, title: '日本語のタイトル' }), 'issue-9.md');
  assert.equal(issueFileName({ number: 1, title: 'Çözüm ğü' }), 'issue-1-cozum-gu.md');
  const long = issueFileName({ number: 3, title: 'word '.repeat(50) });
  assert.ok(long.length < 80, long);
  assert.doesNotMatch(long, /-\.md$/);
});

test('formats relative time', () => {
  const now = Date.parse('2026-06-15T12:00:00Z');
  assert.equal(relativeTime('2026-06-15T11:59:50Z', now), 'now');
  assert.equal(relativeTime('2026-06-15T11:30:00Z', now), '30m');
  assert.equal(relativeTime('2026-06-15T09:00:00Z', now), '3h');
  assert.equal(relativeTime('2026-06-13T12:00:00Z', now), '2d');
  assert.equal(relativeTime('2026-06-01T12:00:00Z', now), '2w');
  assert.equal(relativeTime('2026-03-15T12:00:00Z', now), '3mo');
  assert.equal(relativeTime('2024-06-15T12:00:00Z', now), '2y');
});

test('prefers the milestone over labels on list rows', () => {
  assert.equal(issueTags(issue), 'v2');
  assert.equal(issueTags({ ...issue, milestone: null }), 'bug');
  assert.equal(issueTags({ milestone: null, labels: [] }), '');
});

test('builds the list row description', () => {
  const now = Date.parse('2026-01-08T10:00:00Z');
  assert.equal(issueDescription(issue, { showRepo: false, now }), '#42 - v2 · 3d');
  assert.equal(issueDescription(issue, { showRepo: true, now }), 'acme/app#42 - v2 · 3d');
  assert.equal(
    issueDescription({ ...issue, milestone: null, labels: [] }, { showRepo: false, now }),
    '#42 · 3d',
  );
});
