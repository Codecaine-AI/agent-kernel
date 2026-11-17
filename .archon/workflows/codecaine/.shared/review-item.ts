/**
 * The review's `findings.json`: the record synthesis writes, settle-review rewrites with
 * the verifiers' votes, and review-round reads beside a previous round's report.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isObject } from './typed.ts';

export const FINDINGS_FILE = 'review/findings.json';

export const FINDING_VALUES = {
  severity: ['blocking', 'note'],
  status: ['open', 'fixed', 'declined', 'disproved'],
  /** A blocker's own action, from least to most severe. */
  action: ['correct', 'replan', 'ask'],
} as const;

/** How the review's verifiers demoted a blocker; settle-review writes it. */
export interface FindingVerify {
  readonly against: number;
  readonly reasons: readonly string[];
}

/** One record of the review's `findings.json`. */
export interface Finding {
  readonly id: string;
  readonly severity: (typeof FINDING_VALUES.severity)[number];
  readonly sources: readonly string[];
  readonly claim: string;
  readonly status: (typeof FINDING_VALUES.status)[number];
  readonly round: number;
  /** The action this blocker alone needs; synthesis writes it on blocking records. */
  readonly action?: (typeof FINDING_VALUES.action)[number];
  readonly verify?: FindingVerify;
}

const texts = (value: unknown, ...keys: string[]): value is Record<string, unknown> =>
  isObject(value) && keys.every(key => typeof value[key] === 'string');

export function readFindings(dir: string): Finding[] {
  return readFindingsFile(join(dir, FINDINGS_FILE));
}

/** One `findings.json` at any path, such as the one beside a previous round's report. */
export function readFindingsFile(file: string): Finding[] {
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const isFinding = (record: unknown): record is Finding =>
    texts(record, 'id', 'severity', 'claim', 'status') &&
    FINDING_VALUES.severity.some(value => value === record.severity) &&
    FINDING_VALUES.status.some(value => value === record.status) &&
    typeof record.round === 'number' &&
    Number.isInteger(record.round) &&
    record.round >= 1 &&
    Array.isArray(record.sources) &&
    record.sources.every(source => typeof source === 'string') &&
    (record.action === undefined || FINDING_VALUES.action.some(value => value === record.action)) &&
    (record.verify === undefined ||
      (isObject(record.verify) &&
        typeof record.verify.against === 'number' &&
        Array.isArray(record.verify.reasons) &&
        record.verify.reasons.every(reason => typeof reason === 'string')));
  if (!Array.isArray(raw) || !raw.every(isFinding)) throw new Error(`${file} is not a list of findings`);
  const ids = new Set<string>();
  for (const finding of raw) {
    if (ids.has(finding.id)) throw new Error(`${file}: duplicate finding id ${finding.id}`);
    ids.add(finding.id);
  }
  return raw;
}

/** The blockers verification demoted, by why most verifiers rejected each. */
export interface Demoted {
  readonly disproved: readonly string[];
  readonly preExisting: readonly string[];
  readonly rejected: readonly string[];
}

const series = (items: readonly string[]): string =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;

const ids = (items: readonly string[]): string => (items.length === 0 ? '' : ` (${items.join(', ')})`);

/**
 * What verification changed, for settle-review's summary and the banner on the report:
 * the blockers most verifiers rejected, then the blocking and note counts of `settled`,
 * the findings.json settle-review writes. The report below the banner still lists the
 * synthesizer's labels, so the counts here are the ones a reader acts on.
 */
export function verificationNote(demoted: Demoted, settled: readonly Finding[]): string {
  const named = [
    ...demoted.disproved.map(id => `${id} (disproved)`),
    ...demoted.preExisting.map(id => `${id} (older than this change, now a discovery)`),
    ...demoted.rejected,
  ];
  const open = settled.filter(finding => finding.severity === 'blocking' && finding.status === 'open').map(finding => finding.id);
  const notes = settled.filter(finding => finding.severity === 'note').map(finding => finding.id);
  const blocking = `${String(open.length)} blocking ${open.length === 1 ? 'finding stays' : 'findings stay'} open${ids(open)}`;
  const noted = `${String(notes.length)} ${notes.length === 1 ? 'finding is a note' : 'findings are notes'}${ids(notes)}`;
  return `Most verifiers rejected ${series(named)}, so ${named.length === 1 ? 'it is' : 'each is'} now a note, not a blocker. After verification, ${blocking} and ${noted}.`;
}
