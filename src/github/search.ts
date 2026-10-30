import type { IssueFilter } from '../types';

export function buildSearchQuery(scope: string, filter: IssueFilter): string {
  const parts = ['is:issue', scope];
  if (filter.state !== 'all') {
    parts.push(`is:${filter.state}`);
  }
  if (filter.query) {
    parts.push(filter.query);
  }
  parts.push('sort:updated-desc');
  return parts.join(' ');
}
