/**
 * `kernel.call` (plan §3.4). M1 skeleton: rejects with
 * KernelNodeError("no-engine") until M3 implements it.
 */
import type { CallNodeContext } from "../context";
import { KernelNodeError, type KernelCallFn } from "../types";

/** Called once per kernel from createKernel; may validate `ctx.calls` and throw. */
export function createCall<TCalls>(ctx: CallNodeContext<TCalls>): KernelCallFn<TCalls> {
	void ctx;
	return async () => {
		throw new KernelNodeError("no-engine", "not implemented");
	};
}
