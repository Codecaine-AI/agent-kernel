/**
 * Serializable decision types shared by the kernel's `decide` API and the
 * `decision_made` trace payload.
 *
 * Protocol owns them because DecisionMadeData carries them and protocol must
 * not depend on the kernel. The kernel imports and re-exports these types; it
 * never redefines them. Field names stay camelCase: `Decision` is an API object
 * nested inside a snake_case payload (the `usage: TurnUsage` precedent).
 */

export type AbstainReason = "low-confidence" | "refusal" | "engine-error";

export type ConfidenceSource = "native" | "self-reported" | "none";

/** The thresholds a decision was judged against; each field only on its own question type. */
export interface ThresholdApplied {
  passAt?: number;
  failAt?: number;
  minTop?: number;
  minMargin?: number;
  abstainBelow?: number;
}

export interface Decision {
  kind: "bool" | "choice" | "score";
  /** choice: argmax label; bool: "true" | "false" (p ≥ 0.5). Absent when abstained for refusal/engine-error. */
  choice?: string;
  /** bool: p(true). */
  probability?: number;
  /** score: expected level. */
  score?: number;
  /** choice labels; score levels when the wire has them. */
  distribution?: Record<string, number>;
  /** bool: max(p, 1-p); choice/score: vendor confidence. */
  confidence?: number;
  confidenceSource: ConfidenceSource;
  /** bool only, when not abstained. */
  verdict?: "pass" | "fail";
  /** Reserved for self-reported engines. */
  rationale?: string;
  checks?: Record<string, boolean>;
  evidence?: Array<{ eventId?: string; blobHash?: string; runId?: string }>;
  abstained: boolean;
  /** Set iff abstained. */
  abstainReason?: AbstainReason;
  /** Always present; empty object on engine error. */
  thresholdApplied: ThresholdApplied;
}
