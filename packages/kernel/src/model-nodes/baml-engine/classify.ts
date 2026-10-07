/**
 * BAML error → CallFailure (plan §4.2 rule 5), by `instanceof` against the
 * injected module's classes. Order matters: BamlTimeoutError is a subclass
 * of BamlClientHttpError (`errors.d.ts:59`), so it is tested first.
 */
import type { CallFailure } from "../types";
import type { BamlRuntimeLike } from "./baml-runtime-types";

/**
 * `rawOutput` backs the parse failure of a plain BamlError that says
 * "Failed to coerce" (offline `b.parse` throws one, R2 §7), which carries no
 * `raw_output` of its own.
 */
export function classifyBamlError(baml: BamlRuntimeLike, error: unknown, rawOutput: string | null): CallFailure {
	if (error instanceof baml.BamlAbortError) return { kind: "aborted" };
	if (error instanceof baml.BamlTimeoutError) return { kind: "timeout" };
	if (error instanceof baml.BamlClientHttpError) {
		return {
			kind: "http",
			status: error.status_code,
			...(typeof error.raw_response === "string" && { rawResponse: error.raw_response }),
		};
	}
	if (error instanceof baml.BamlValidationError) {
		return { kind: "parse", message: error.message, rawOutput: error.raw_output };
	}
	if (error instanceof baml.BamlClientFinishReasonError) {
		return {
			kind: "finish_reason",
			...(typeof error.finish_reason === "string" && { finishReason: error.finish_reason }),
			rawOutput: error.raw_output,
		};
	}
	const message = errorMessage(error);
	if (error instanceof baml.BamlError && message.includes("Failed to coerce")) {
		return { kind: "parse", message, rawOutput: rawOutput ?? "" };
	}
	return { kind: "other", message };
}

export function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return typeof error === "string" ? error : String(error);
}
