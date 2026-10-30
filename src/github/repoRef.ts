import type { RepoRef } from '../types';

const REMOTE =
  /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?(?:ssh\.|www\.)?github\.com(?::\d+)?[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i;
const SHORTHAND = /^([\w.-]+)\/([\w.-]+)$/;

/** Accepts git remote URLs and web URLs on github.com. */
export function parseRemoteUrl(url: string): RepoRef | undefined {
  const match = REMOTE.exec(url.trim());
  return match ? { owner: match[1], name: match[2] } : undefined;
}

/** Accepts everything parseRemoteUrl does, plus the owner/name shorthand. */
export function parseRepo(input: string): RepoRef | undefined {
  const text = input.trim();
  const shorthand = SHORTHAND.exec(text);
  return shorthand ? { owner: shorthand[1], name: shorthand[2] } : parseRemoteUrl(text);
}
