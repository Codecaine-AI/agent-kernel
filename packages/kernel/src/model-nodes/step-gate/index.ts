/**
 * `kernel.step` and `kernel.gate` (plan §3.6): deterministic code steps and
 * gates of step/decide checks, recorded as span pairs on their parent run.
 * Neither writes session or run rows; both write their events with awaited
 * inserts (§4.6).
 */
export { createStep } from "./step";
export { createGate } from "./gate";
