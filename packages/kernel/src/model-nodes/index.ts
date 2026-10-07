/**
 * `@agent-kernel/kernel/model-nodes`: model-node contracts and the kernel
 * wiring for `call`, `decide`, `step`, and `gate`.
 */
import { createCall } from "./call";
import type { CallNodeContext } from "./context";
import { createDecide } from "./decide";
import { createGate, createStep } from "./step-gate";
import type { ModelNodes } from "./types";

export * from "./types";
export {
	createModelNodeContext,
	type CallNodeContext,
	type CreateModelNodeContextOptions,
	type ModelNodeContext,
	type ModelNodeLogger,
	type PiModelsSource,
} from "./context";
export { createPiDecisionEngine, type PiDecisionEngine, type PiDecisionEngineOptions } from "./decide";

/**
 * Builds the four node functions for one kernel. Each factory runs once,
 * here, so a factory may validate its config and throw from createKernel;
 * none starts work or touches the network at construction (default-off).
 */
export function createModelNodes<TCalls = unknown>(ctx: CallNodeContext<TCalls>): ModelNodes<TCalls> {
	return {
		call: createCall(ctx),
		decide: createDecide(ctx),
		step: createStep(ctx),
		gate: createGate(ctx),
	};
}
