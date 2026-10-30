import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { GitHubClient, GitHubError } from '../src/github/client';
import { buildSearchQuery } from '../src/github/search';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function respondWith(...responses: Response[]): { variables: Record<string, unknown>[] } {
  const calls = { variables: [] as Record<string, unknown>[] };
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    calls.variables.push(JSON.parse(String(init.body)).variables);
    return responses.shift() ?? jsonResponse({ data: null });
  }) as typeof fetch;
  return calls;
}

function clientWithToken(token: string | undefined = 'secret') {
  const rejected: string[] = [];
  const client = new GitHubClient({ token, tokenRejected: (value) => rejected.push(value) });
  return { client, rejected };
}

const rawIssue = {
  number: 1,
  title: 'First',
  state: 'OPEN',
  stateReason: null,
  url: 'https://github.com/a/b/issues/1',
  body: 'body',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  author: null,
  repository: { nameWithOwner: 'a/b' },
  labels: { nodes: [{ name: 'bug', color: 'ff0000' }] },
  assignees: { nodes: [{ login: 'hubot' }] },
  milestone: null,
  comments: { totalCount: 3 },
};

const repoPage = (overrides = {}) => ({
  data: {
    repository: {
      hasIssuesEnabled: true,
      issues: {
        totalCount: 1,
        pageInfo: { hasNextPage: false, endCursor: 'c1' },
        nodes: [rawIssue],
        ...overrides,
      },
    },
  },
});

test('maps issues and names deleted authors ghost', async () => {
  respondWith(jsonResponse(repoPage()));
  const { client } = clientWithToken();
  const page = await client.listRepoIssues({ owner: 'a', name: 'b' }, 'open', null);
  assert.equal(page.issues[0].author, 'ghost');
  assert.equal(page.issues[0].repo, 'a/b');
  assert.deepEqual(page.issues[0].assignees, ['hubot']);
  assert.equal(page.issues[0].commentCount, 3);
  assert.equal(page.cursor, 'c1');
});

test('sends null states for the all filter', async () => {
  const calls = respondWith(jsonResponse(repoPage()), jsonResponse(repoPage()));
  const { client } = clientWithToken();
  await client.listRepoIssues({ owner: 'a', name: 'b' }, 'all', null);
  await client.listRepoIssues({ owner: 'a', name: 'b' }, 'closed', 'cursor');
  assert.equal(calls.variables[0].states, null);
  assert.deepEqual(calls.variables[1].states, ['CLOSED']);
  assert.equal(calls.variables[1].after, 'cursor');
});

test('reports repositories with issues turned off', async () => {
  const body = repoPage();
  body.data.repository.hasIssuesEnabled = false;
  respondWith(jsonResponse(body));
  const { client } = clientWithToken();
  await assert.rejects(client.listRepoIssues({ owner: 'a', name: 'b' }, 'open', null), /turned off/);
});

test('reads every page of comments', async () => {
  const detail = (cursor: string | null, id: number) => ({
    data: {
      repository: {
        issue: {
          ...rawIssue,
          bodyHTML: '<p>body</p>',
          commentPage: {
            pageInfo: { hasNextPage: cursor !== null, endCursor: cursor },
            nodes: [
              {
                url: `u${id}`,
                body: `c${id}`,
                bodyHTML: '',
                createdAt: '2026-01-01T00:00:00Z',
                author: { login: 'hubot', avatarUrl: 'https://a/1' },
              },
            ],
          },
        },
      },
    },
  });
  const calls = respondWith(jsonResponse(detail('next', 1)), jsonResponse(detail(null, 2)));
  const { client } = clientWithToken();
  const result = await client.getIssue('a/b', 1);
  assert.deepEqual(result.comments.map((comment) => comment.body), ['c1', 'c2']);
  assert.equal(calls.variables[1].after, 'next');
});

test('drops empty search nodes', async () => {
  respondWith(
    jsonResponse({
      data: {
        search: { issueCount: 2, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [rawIssue, {}, null] },
      },
    }),
  );
  const { client } = clientWithToken();
  const page = await client.searchIssues('is:issue', null);
  assert.equal(page.issues.length, 1);
});

test('keeps partial search results when one organization is blocked', async () => {
  respondWith(
    jsonResponse({
      data: { search: { issueCount: 1, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [rawIssue] } },
      errors: [{ type: 'FORBIDDEN', message: 'SAML enforcement' }],
    }),
  );
  const { client } = clientWithToken();
  assert.equal((await client.searchIssues('is:issue', null)).issues.length, 1);
});

test('reports a 401 as a rejected token', async () => {
  respondWith(jsonResponse({ message: 'Bad credentials' }, 401));
  const { client, rejected } = clientWithToken('stale');
  await assert.rejects(client.searchIssues('q', null), (error: GitHubError) => error.kind === 'auth');
  assert.deepEqual(rejected, ['stale']);
});

test('tells rate limits apart from other 403s', async () => {
  respondWith(
    jsonResponse({ message: 'API rate limit exceeded' }, 403),
    jsonResponse({ message: 'Must have admin rights' }, 403),
  );
  const { client } = clientWithToken();
  await assert.rejects(client.searchIssues('q', null), (error: GitHubError) => error.kind === 'rateLimit');
  await assert.rejects(client.searchIssues('q', null), /Must have admin rights/);
});

test('maps a NOT_FOUND GraphQL error', async () => {
  respondWith(jsonResponse({ data: { repository: null }, errors: [{ type: 'NOT_FOUND', message: 'nope' }] }));
  const { client } = clientWithToken();
  await assert.rejects(
    client.listRepoIssues({ owner: 'a', name: 'b' }, 'open', null),
    (error: GitHubError) => error.kind === 'notFound',
  );
});

test('refuses to call GitHub without a token', async () => {
  const { client } = clientWithToken(undefined);
  Object.defineProperty(client, 'tokens', { value: { token: undefined, tokenRejected() {} } });
  await assert.rejects(client.searchIssues('q', null), (error: GitHubError) => error.kind === 'auth');
});

test('builds search queries', () => {
  assert.equal(
    buildSearchQuery('repo:a/b', { state: 'open', query: 'label:bug' }),
    'is:issue repo:a/b is:open label:bug sort:updated-desc',
  );
  assert.equal(buildSearchQuery('assignee:@me', { state: 'all', query: '' }), 'is:issue assignee:@me sort:updated-desc');
});
