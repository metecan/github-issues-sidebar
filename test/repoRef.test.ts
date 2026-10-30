import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRemoteUrl, parseRepo } from '../src/github/repoRef';

const cli = { owner: 'cli', name: 'cli' };

test('parses the remote URL forms git produces', () => {
  for (const url of [
    'git@github.com:cli/cli.git',
    'git@github.com:cli/cli',
    'ssh://git@github.com/cli/cli.git',
    'ssh://git@ssh.github.com:443/cli/cli.git',
    'https://github.com/cli/cli.git',
    'https://github.com/cli/cli',
    'https://github.com/cli/cli/',
    'https://user:token@github.com/cli/cli.git',
    'git://github.com/cli/cli.git',
  ]) {
    assert.deepEqual(parseRemoteUrl(url), cli, url);
  }
});

test('keeps dots in repository names', () => {
  assert.deepEqual(parseRemoteUrl('git@github.com:vercel/next.js.git'), { owner: 'vercel', name: 'next.js' });
  assert.deepEqual(parseRemoteUrl('https://github.com/vercel/next.js'), { owner: 'vercel', name: 'next.js' });
});

test('rejects hosts that only look like github.com', () => {
  for (const url of [
    'https://github.com.evil.example/cli/cli',
    'https://evil.example/github.com/cli/cli',
    'git@gitlab.com:cli/cli.git',
    'https://gist.github.com/abc/def',
  ]) {
    assert.equal(parseRemoteUrl(url), undefined, url);
  }
});

test('accepts the shorthand and web URLs in user input', () => {
  assert.deepEqual(parseRepo('cli/cli'), cli);
  assert.deepEqual(parseRepo('  cli/cli  '), cli);
  assert.deepEqual(parseRepo('https://github.com/cli/cli/issues/42'), cli);
  assert.equal(parseRepo('just-a-name'), undefined);
  assert.equal(parseRepo('a/b/c'), undefined);
});
