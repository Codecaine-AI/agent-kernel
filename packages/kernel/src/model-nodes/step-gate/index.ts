/**
 * `kernel.step` and `kernel.gate` (plan §3.6). M1 skeleton: both reject with
 * KernelNodeError("no-engine") until M4 implements them.
 */
import type { ModelNodeContext } from "../context";
import { KernelNodeError, type KernelGateFn, type KernelStepFn } from "../types";

export function createStep(ctx: ModelNodeContext): KernelStepFn {
	void ctx;
	return async () => {
		throw new KernelNodeError("no-engine", "not implemented");
	};
}

export function createGate(ctx: ModelNodeContext): KernelGateFn {
	void ctx;
	return async () => {
		throw new KernelNodeError("no-engine", "not implemented");
	};
}
