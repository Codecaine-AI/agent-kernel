/**
 * Tailer configuration — backfill posture only.
 *
 * The daemon-era knobs (watch dir, cursor snapshots, flush intervals, queue
 * backpressure, health port) are gone: the tailer is a backfill/import tool.
 */
export interface TailerConfig {
  /** Number of mapped events per idempotent batch insert. */
  batchSize: number;
}

export type TailerConfigInput = Partial<TailerConfig>;

const DEFAULT_TAILER_CONFIG_VALUES = Object.freeze({
  batchSize: 500,
} satisfies TailerConfig);

export function createTailerConfig(
  input: TailerConfigInput = {},
): Readonly<TailerConfig> {
  return Object.freeze({
    ...DEFAULT_TAILER_CONFIG_VALUES,
    ...input,
  });
}
