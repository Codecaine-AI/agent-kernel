/**
 * `kernel.decide` (plan §3.5). M1 skeleton: rejects with
 * KernelNodeError("no-engine") until M2 implements it.
 */
import type { ModelNodeContext } from "../context";
import { KernelNodeError, type KernelDecideFn } from "../types";

/** Called once per kernel from createKernel; may validate `ctx.decide` and throw. */
export function createDecide(ctx: ModelNodeContext): KernelDecideFn {
	void ctx;
	return async () => {
		throw new KernelNodeError("no-engine", "not implemented");
	};
}
