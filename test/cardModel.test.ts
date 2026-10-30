import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toCard } from '../src/cards/cardModel';
import type { Issue } from '../src/types';

const issue: Issue = {
  repo: 'acme/app',
  number: 42,
  title: 'Login fails',
  state: 'OPEN',
  stateReason: null,
  url: 'https://github.com/acme/app/issues/42',
  body: 'a very long body that the card has no use for',
  author: 'octocat',
  labels: [{ name: 'bug', color: 'ff0000' }],
  assignees: ['hubot'],
  milestone: 'v2',
  createdAt: '2026-01-02T10:00:00Z',
  updatedAt: '2026-01-05T10:00:00Z',
  commentCount: 3,
};

const now = Date.parse('2026-01-08T10:00:00Z');

test('maps an issue to a card without its body', () => {
  const card = toCard(issue, { showRepo: false, now });
  assert.equal(card.key, 'acme/app#42');
  assert.equal(card.age, '3d');
  assert.equal(card.repo, null);
  assert.equal(card.state, 'open');
  assert.ok(!('body' in card));
});

test('names the repository only when a section mixes them', () => {
  assert.equal(toCard(issue, { showRepo: true, now }).repo, 'acme/app');
});

test('maps closed reasons to card states', () => {
  const closed = { ...issue, state: 'CLOSED' as const };
  assert.equal(toCard(closed, { showRepo: false, now }).state, 'closed');
  assert.equal(toCard({ ...closed, stateReason: 'NOT_PLANNED' }, { showRepo: false, now }).state, 'not-planned');
  assert.equal(toCard({ ...closed, stateReason: 'DUPLICATE' }, { showRepo: false, now }).state, 'not-planned');
});
