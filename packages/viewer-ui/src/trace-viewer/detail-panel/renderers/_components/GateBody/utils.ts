/**
 * GateBody utils — pure readers over a kernel.gate span (gate_start paired
 * with gate_end): planned checks are the span's input, the check records its
 * output (protocol GateCheckRecord), the verdict an attribute.
 */
import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { formatDurationMs, readBoolAttr, readNumericAttr, readStringAttr } from "../../../../span-style";

export type GateCheckResult = "pass" | "fail" | "abstain" | "skipped" | "pending";

export type PillTone = "success" | "danger" | "warning" | "neutral";

export interface GateQuestion {
	question_id: string;
	result: string;
	run_id?: string;
	probability?: number;
	pass_at?: number;
	fail_at?: number;
	abstain_reason?: string;
}

export interface GateCheck {
	name: string;
	kind: string;
	result: GateCheckResult;
	value?: string;
	reason?: string;
	error?: string;
	questions: GateQuestion[];
}

function parseArray(text: string | undefined): unknown[] {
	if (!text) return [];
	try {
		const parsed: unknown = JSON.parse(text);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

const RESULTS = new Set<GateCheckResult>(["pass", "fail", "abstain", "skipped"]);

function asResult(value: unknown): GateCheckResult {
	return typeof value === "string" && RESULTS.has(value as GateCheckResult)
		? (value as GateCheckResult)
		: "pending";
}

function text(value: unknown): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * One row per check, in order: the gate_end records when the gate closed,
 * else its planned checks as pending (a gate still running, or one whose
 * end was never written).
 */
export function gateChecks(span: TraceSpan): GateCheck[] {
	const records = parseArray(span.output);
	const source = records.length > 0 ? records : parseArray(span.input);
	return source.flatMap((entry) => {
		if (entry === null || typeof entry !== "object") return [];
		const record = entry as Record<string, unknown>;
		if (typeof record.name !== "string") return [];
		return [
			{
				name: record.name,
				kind: typeof record.kind === "string" ? record.kind : "step",
				result: records.length > 0 ? asResult(record.result) : "pending",
				value: text(record.value),
				reason: text(record.reason),
				error: text(record.error),
				questions: Array.isArray(record.questions)
					? (record.questions.filter(
							(question) =>
								question !== null &&
								typeof question === "object" &&
								typeof (question as { question_id?: unknown }).question_id === "string",
						) as GateQuestion[])
					: [],
			},
		];
	});
}

/** The gate's verdict ("pending" until gate_end), with " · aborted" when the gate was cut short. */
export function gateVerdictLabel(span: TraceSpan): string {
	const verdict = readStringAttr(span, "verdict") ?? "pending";
	return readBoolAttr(span, "aborted") === true ? `${verdict} · aborted` : verdict;
}

/** "2 checks · 1.2 s". */
export function gateMetaLine(span: TraceSpan, checkCount: number): string {
	const duration = readNumericAttr(span, "duration_ms");
	return [
		`${checkCount} ${checkCount === 1 ? "check" : "checks"}`,
		duration === undefined ? undefined : formatDurationMs(duration),
	]
		.filter(Boolean)
		.join(" · ");
}

/** A verdict or check result → its pill tone: pass green, fail red, abstain amber, the rest neutral. */
export function pillTone(result: string): PillTone {
	if (result.startsWith("pass")) return "success";
	if (result.startsWith("fail")) return "danger";
	if (result.startsWith("abstain")) return "warning";
	return "neutral";
}
