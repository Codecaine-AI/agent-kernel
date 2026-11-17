import { describe, expect, test } from 'bun:test';
import { declaredMismatch, scopeIdentity, type ScopeFacts } from './scope.ts';

const KERNEL = { host: 'github.com', path: 'Codecaine-AI/agent-kernel' };
const PR13 = { repo: KERNEL, number: 13 };
const PR13_URL = 'https://github.com/Codecaine-AI/agent-kernel/pull/13';

/** A forge that knows one pull request URL and a checkout whose remotes name `repos`. */
function facts(repos: ReturnType<ScopeFacts['checkoutRepos']> = [KERNEL]): ScopeFacts {
  return {
    prAtUrl: url => (url === PR13_URL ? PR13 : undefined),
    checkoutRepos: () => repos,
  };
}

describe('scopeIdentity', () => {
  test.each([
    ['a number', '13'],
    ['a number with surrounding space', ' 13\n'],
    ['a #number', '#13'],
    ['the pull request URL', PR13_URL],
    ['the pull request record', JSON.stringify({ repo: KERNEL, number: 13, head: 'feature', base: 'main' })],
  ])('reads %s as pull request 13 of the checkout repository', (_name, scope) => {
    expect(scopeIdentity(scope, facts())).toEqual(PR13);
  });

  test('reads a number in the one repository that several remotes of the checkout name', () => {
    const upper = { host: 'GitHub.com', path: 'codecaine-ai/AGENT-KERNEL' };
    expect(scopeIdentity('13', facts([KERNEL, upper]))).toEqual(PR13);
  });

  test.each([
    ['empty text', ''],
    ['a branch name', 'feature/review-pack'],
  ])('names no pull request for %s', (_name, scope) => {
    expect(scopeIdentity(scope, facts())).toBeUndefined();
  });

  test.each([
    ['a zero-padded number', '0013', [KERNEL], 'is not a pull request number'],
    ['zero', '#0', [KERNEL], 'is not a pull request number'],
    ['a # without a number', '#main', [KERNEL], 'is not a pull request number'],
    ['a record without a repo', '{"number": 13}', [KERNEL], 'without a qualified repo'],
    ['broken JSON', '{"repo":', [KERNEL], 'not valid JSON'],
    ['a URL that names no pull request', 'https://github.com/Codecaine-AI/agent-kernel', [KERNEL], 'names no pull request'],
    ['a number when no remote names a forge repository', '13', [], 'name no forge repository'],
  ])('refuses %s', (_name, scope, repos, reason) => {
    expect(() => scopeIdentity(scope, facts(repos))).toThrow(reason);
  });

  test('refuses a number when the remotes name two repositories', () => {
    const fork = { host: 'github.com', path: 'someone/agent-kernel' };
    expect(() => scopeIdentity('#13', facts([KERNEL, fork]))).toThrow(
      'remotes name 2 (github.com/Codecaine-AI/agent-kernel, github.com/someone/agent-kernel)'
    );
  });
});

describe('declaredMismatch', () => {
  test('accepts the same pull request in the case the forge registered', () => {
    expect(declaredMismatch(PR13, { repo: { host: 'GITHUB.COM', path: 'codecaine-ai/agent-kernel' }, number: 13 })).toBeUndefined();
  });

  test.each([
    ['another repository', { repo: { host: 'github.com', path: 'Other/repo' }, number: 13 }, 'github.com/Other/repo#13'],
    ['another host', { repo: { host: 'ghe.example.com', path: 'Codecaine-AI/agent-kernel' }, number: 13 }, 'ghe.example.com/Codecaine-AI/agent-kernel#13'],
    ['another number', { repo: KERNEL, number: 14 }, 'github.com/Codecaine-AI/agent-kernel#14'],
    ['no pull request', undefined, 'no pull request'],
  ])('refuses a declaration of %s, naming both', (_name, declared, named) => {
    expect(declaredMismatch(PR13, declared)).toBe(
      `the review scope names github.com/Codecaine-AI/agent-kernel#13, but the scope agent declared ${named}`
    );
  });
});
