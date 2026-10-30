import type {
  Issue,
  IssueComment,
  IssueDetail,
  IssuePage,
  RepoRef,
  StateFilter,
} from '../types';

const ENDPOINT = 'https://api.github.com/graphql';
const PAGE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 30_000;

const ISSUE_FIELDS = `
  fragment IssueFields on Issue {
    number title state stateReason url body createdAt updatedAt
    author { login }
    repository { nameWithOwner }
    labels(first: 20) { nodes { name color } }
    assignees(first: 10) { nodes { login } }
    milestone { title }
    comments { totalCount }
  }`;

const REPO_ISSUES_QUERY = `
  query($owner: String!, $name: String!, $states: [IssueState!], $first: Int!, $after: String) {
    repository(owner: $owner, name: $name) {
      hasIssuesEnabled
      issues(first: $first, after: $after, states: $states, orderBy: { field: UPDATED_AT, direction: DESC }) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { ...IssueFields }
      }
    }
  }
  ${ISSUE_FIELDS}`;

const SEARCH_QUERY = `
  query($query: String!, $first: Int!, $after: String) {
    search(query: $query, type: ISSUE, first: $first, after: $after) {
      issueCount
      pageInfo { hasNextPage endCursor }
      nodes { ... on Issue { ...IssueFields } }
    }
  }
  ${ISSUE_FIELDS}`;

const ISSUE_DETAIL_QUERY = `
  query($owner: String!, $name: String!, $number: Int!, $first: Int!, $after: String) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        ...IssueFields
        bodyHTML
        author { login avatarUrl }
        commentPage: comments(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { url body bodyHTML createdAt author { login avatarUrl } }
        }
      }
    }
  }
  ${ISSUE_FIELDS}`;

export type ErrorKind = 'auth' | 'rateLimit' | 'notFound' | 'network' | 'api';

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly kind: ErrorKind,
  ) {
    super(message);
  }
}

export interface TokenProvider {
  readonly token: string | undefined;
  tokenRejected(token: string): void;
}

interface RawConnection<T> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: T[];
}

interface RawIssue {
  number: number;
  title: string;
  state: Issue['state'];
  stateReason: string | null;
  url: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  author: { login: string; avatarUrl?: string } | null;
  repository: { nameWithOwner: string };
  labels: { nodes: Issue['labels'] } | null;
  assignees: { nodes: { login: string }[] };
  milestone: { title: string } | null;
  comments: { totalCount: number };
}

interface RawComment {
  url: string;
  body: string;
  bodyHTML: string;
  createdAt: string;
  author: { login: string; avatarUrl?: string } | null;
}

interface RawIssueDetail extends RawIssue {
  bodyHTML: string;
  commentPage: RawConnection<RawComment>;
}

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: { type?: string; message: string }[];
}

// Deleted accounts come back as a null author.
const GHOST = 'ghost';

function toIssue(raw: RawIssue): Issue {
  return {
    repo: raw.repository.nameWithOwner,
    number: raw.number,
    title: raw.title,
    state: raw.state,
    stateReason: raw.stateReason,
    url: raw.url,
    body: raw.body,
    author: raw.author?.login ?? GHOST,
    labels: raw.labels?.nodes ?? [],
    assignees: raw.assignees.nodes.map((assignee) => assignee.login),
    milestone: raw.milestone?.title ?? null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    commentCount: raw.comments.totalCount,
  };
}

function toComment(raw: RawComment): IssueComment {
  return {
    author: raw.author?.login ?? GHOST,
    avatarUrl: raw.author?.avatarUrl ?? '',
    body: raw.body,
    bodyHTML: raw.bodyHTML,
    createdAt: raw.createdAt,
    url: raw.url,
  };
}

function statesFor(state: StateFilter): string[] | null {
  if (state === 'all') {
    return null;
  }
  return [state.toUpperCase()];
}

export class GitHubClient {
  constructor(private readonly tokens: TokenProvider) {}

  async listRepoIssues(repo: RepoRef, state: StateFilter, after: string | null): Promise<IssuePage> {
    const data = await this.graphql<{
      repository: {
        hasIssuesEnabled: boolean;
        issues: RawConnection<RawIssue> & { totalCount: number };
      };
    }>(REPO_ISSUES_QUERY, {
      owner: repo.owner,
      name: repo.name,
      states: statesFor(state),
      first: PAGE_SIZE,
      after,
    });
    if (!data.repository.hasIssuesEnabled) {
      throw new GitHubError('Issues are turned off for this repository.', 'api');
    }
    const { issues } = data.repository;
    return {
      issues: issues.nodes.map(toIssue),
      total: issues.totalCount,
      cursor: issues.pageInfo.endCursor,
      hasMore: issues.pageInfo.hasNextPage,
    };
  }

  async searchIssues(query: string, after: string | null): Promise<IssuePage> {
    const { search } = await this.graphql<{
      search: RawConnection<RawIssue | null> & { issueCount: number };
    }>(SEARCH_QUERY, { query, first: PAGE_SIZE, after });
    return {
      // Results the token cannot read come back as empty nodes.
      issues: search.nodes.filter((node): node is RawIssue => Boolean(node?.number)).map(toIssue),
      total: search.issueCount,
      cursor: search.pageInfo.endCursor,
      hasMore: search.pageInfo.hasNextPage,
    };
  }

  async getIssue(repo: string, number: number): Promise<IssueDetail> {
    const [owner, name] = repo.split('/');
    const comments: IssueComment[] = [];
    let issue: RawIssueDetail;
    let after: string | null = null;
    do {
      const data: { repository: { issue: RawIssueDetail | null } } = await this.graphql(ISSUE_DETAIL_QUERY, {
        owner,
        name,
        number,
        first: PAGE_SIZE,
        after,
      });
      if (!data.repository.issue) {
        throw new GitHubError(`Issue ${repo}#${number} was not found.`, 'notFound');
      }
      issue = data.repository.issue;
      comments.push(...issue.commentPage.nodes.map(toComment));
      after = issue.commentPage.pageInfo.hasNextPage ? issue.commentPage.pageInfo.endCursor : null;
    } while (after);

    return {
      ...toIssue(issue),
      bodyHTML: issue.bodyHTML,
      authorAvatarUrl: issue.author?.avatarUrl ?? '',
      comments,
    };
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const token = this.tokens.token;
    if (!token) {
      throw new GitHubError('Not signed in to GitHub.', 'auth');
    }

    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'github-issues-sidebar',
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new GitHubError(`Could not reach GitHub: ${(error as Error).message}`, 'network');
    }

    if (response.status === 401) {
      this.tokens.tokenRejected(token);
      throw new GitHubError('GitHub rejected the sign-in. Please sign in again.', 'auth');
    }
    if (response.status === 403 || response.status === 429) {
      const detail = await response.json().catch(() => undefined);
      const message: string = detail?.message ?? '';
      if (response.status === 429 || /rate limit/i.test(message)) {
        throw new GitHubError('GitHub rate limit reached. Try again in a few minutes.', 'rateLimit');
      }
      throw new GitHubError(message || 'GitHub denied access to this resource.', 'api');
    }
    if (!response.ok) {
      throw new GitHubError(`GitHub returned ${response.status} ${response.statusText}.`, 'api');
    }

    const body = (await response.json()) as GraphQLResponse<T>;
    const error = body.errors?.[0];
    // Search keeps partial data when one org's SAML policy hides some results.
    if (error && (!body.data || error.type === 'NOT_FOUND' || error.type === 'RATE_LIMITED')) {
      if (error.type === 'NOT_FOUND') {
        throw new GitHubError('Repository not found, or your account cannot access it.', 'notFound');
      }
      if (error.type === 'RATE_LIMITED') {
        throw new GitHubError('GitHub rate limit reached. Try again in a few minutes.', 'rateLimit');
      }
      throw new GitHubError(error.message, 'api');
    }
    if (!body.data) {
      throw new GitHubError('GitHub returned an empty response.', 'api');
    }
    return body.data;
  }
}
