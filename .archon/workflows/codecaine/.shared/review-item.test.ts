import { describe, expect, test } from 'bun:test';
import { type Finding, verificationNote } from './review-item.ts';

const finding = (id: string, severity: Finding['severity'], status: Finding['status']): Finding => ({
  id,
  severity,
  status,
  sources: ['review-codex'],
  claim: `${id} claim`,
  round: 1,
});

describe('verificationNote', () => {
  test.each([
    {
      name: 'one disproved blocker, as in a round that kept 2 blockers',
      demoted: { disproved: ['R2'], preExisting: [], rejected: [] },
      settled: [
        finding('R1', 'blocking', 'open'),
        finding('R2', 'note', 'disproved'),
        finding('R3', 'blocking', 'open'),
        finding('N1', 'note', 'open'),
        finding('N2', 'note', 'open'),
        finding('R4', 'note', 'disproved'),
      ],
      expected:
        'Most verifiers rejected R2 (disproved), so it is now a note, not a blocker. After verification, 2 blocking findings stay open (R1, R3) and 4 findings are notes (R2, N1, N2, R4).',
    },
    {
      name: 'every kind of demotion and no blocker left open',
      demoted: { disproved: ['R1'], preExisting: ['R2'], rejected: ['R3'] },
      settled: [
        finding('R1', 'note', 'disproved'),
        finding('R2', 'note', 'open'),
        finding('R3', 'note', 'open'),
        finding('R4', 'blocking', 'fixed'),
      ],
      expected:
        'Most verifiers rejected R1 (disproved), R2 (older than this change, now a discovery) and R3, so each is now a note, not a blocker. After verification, 0 blocking findings stay open and 3 findings are notes (R1, R2, R3).',
    },
  ])('$name', ({ demoted, settled, expected }) => {
    expect(verificationNote(demoted, settled)).toBe(expected);
  });
});
