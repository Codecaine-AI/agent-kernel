/**
 * Transcript-recovery configuration — backfill posture only.
 *
 * The daemon-era knobs (watch dir, cursor snapshots, flush intervals, queue
 * backpressure, health port) are gone: this module is a backfill/import tool
 * over Pi's durable JSONL transcripts, not a live tailer.
 */
export interface RecoveryConfig {
  /** Number of mapped events per idempotent batch insert. */
  batchSize: number;
}

export type RecoveryConfigInput = Partial<RecoveryConfig>;

const DEFAULT_RECOVERY_CONFIG_VALUES = Object.freeze({
  batchSize: 500,
} satisfies RecoveryConfig);

export function createRecoveryConfig(
  input: RecoveryConfigInput = {},
): Readonly<RecoveryConfig> {
  return Object.freeze({
    ...DEFAULT_RECOVERY_CONFIG_VALUES,
    ...input,
  });
}
