import { describe, expect, test } from 'bun:test';
import { decideTag, tagMarker } from './outside-reviewers.ts';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

describe('decideTag', () => {
  test('tags the reviewed head when no comment carries its marker', () => {
    expect(decideTag({ reviewedHead: A, liveHead: A, comments: ['looks good', tagMarker(B)] })).toEqual({
      kind: 'tag',
      head: A,
    });
  });

  test('tags nothing when a comment already tagged the head', () => {
    expect(decideTag({ reviewedHead: A, liveHead: A, comments: [`${tagMarker(A)}\n@greptileai review`] })).toEqual({
      kind: 'already-tagged',
      head: A,
    });
  });

  test('refuses when the pull request moved off the reviewed head, even if the new head is tagged', () => {
    expect(decideTag({ reviewedHead: A, liveHead: B, comments: [tagMarker(B)] })).toEqual({
      kind: 'head-moved',
      reviewed: A,
      live: B,
    });
  });

  test('tags the live head when a hand run names no reviewed head', () => {
    expect(decideTag({ reviewedHead: undefined, liveHead: B, comments: [] })).toEqual({ kind: 'tag', head: B });
  });
});
