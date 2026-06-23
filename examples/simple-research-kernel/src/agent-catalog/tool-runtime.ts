import type { AgentRecord } from "@agent-kernel/kernel";
import { Type } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

export type ToolTextResult = {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
};

export type ToolResponse = {
	text: string;
	details: Record<string, unknown>;
};

export type ContextSnapshot = {
	text: string;
	files: Array<{ path: string; bytes: number; truncated: boolean }>;
};

export type ScoutAssignment = {
	focus: string;
	prompt: string;
};

export interface SimpleResearchToolRuntime {
	readContextSnapshot(paths?: string[]): ContextSnapshot;
	spawnScoutAssignments(
		pi: ExtensionAPI,
		ctx: ExtensionContext,
		toolCallId: string,
		assignments: ScoutAssignment[],
		signal?: AbortSignal
	): Promise<AgentRecord[]>;
	spawnReportWriter(
		pi: ExtensionAPI,
		ctx: ExtensionContext,
		toolCallId: string,
		focus: string,
		signal?: AbortSignal
	): Promise<AgentRecord>;
	reviewResearchReports(question?: string): ToolResponse;
	writeResearchReport(title: string | undefined, content: string): ToolResponse;
	writeFinalReport(title: string | undefined, content: string): ToolResponse;
}

export type SimpleResearchAgentRegisterFn = (
	pi: ExtensionAPI,
	runtime?: SimpleResearchToolRuntime
) => void | Promise<void>;

function requireRuntime(runtime: SimpleResearchToolRuntime | undefined): SimpleResearchToolRuntime {
	if (!runtime) {
		throw new Error("Simple Research Kernel private tool runtime was not provided by the app adapter.");
	}
	return runtime;
}

function toolTextResult(text: string, details: Record<string, unknown>): ToolTextResult {
	return {
		content: [{ type: "text", text }],
		details
	};
}

function normalizeScoutArguments(args: unknown): { assignments: Array<{ focus: string; prompt?: string }> } {
	const normalizeOne = (value: unknown): { focus: string; prompt?: string } => {
		if (typeof value === "string") return { focus: value, prompt: value };
		if (value && typeof value === "object") {
			const record = value as Record<string, unknown>;
			const focus = record.focus ?? record.assignment ?? record.question ?? record.prompt;
			const prompt = record.prompt ?? record.assignment ?? record.focus ?? record.question;
			return {
				focus: String(focus ?? prompt ?? "Research assignment"),
				prompt: prompt == null ? undefined : String(prompt)
			};
		}
		return { focus: "Research assignment" };
	};

	if (Array.isArray(args)) return { assignments: args.map(normalizeOne) };
	if (args && typeof args === "object") {
		const record = args as Record<string, unknown>;
		const raw = record.assignments ?? record.scouts ?? record.prompts ?? record.questions;
		if (Array.isArray(raw)) return { assignments: raw.map(normalizeOne) };
		if (typeof raw === "string") return { assignments: [normalizeOne(raw)] };
		if (record.focus || record.prompt || record.assignment || record.question) {
			return { assignments: [normalizeOne(record)] };
		}
	}
	return { assignments: [] };
}

export function registerReadContextTool(
	pi: ExtensionAPI,
	runtime?: SimpleResearchToolRuntime
): void {
	pi.registerTool({
		name: "read_context",
		label: "Read context",
		description:
			"Read local research memory files, including the brief, source notes, scout reports, and final reports.",
		promptSnippet: "Read the local research context from working memory.",
		parameters: Type.Object({
			paths: Type.Optional(Type.Array(Type.String()))
		}),
		executionMode: "sequential",
		execute: async (_toolCallId, params) => {
			const snapshot = requireRuntime(runtime).readContextSnapshot(params.paths);
			return toolTextResult(snapshot.text, {
				files: snapshot.files
			});
		}
	});
}

export function registerSpawnScoutsTool(
	pi: ExtensionAPI,
	toolName: "spawn_research_scouts" | "spawn_followup_scouts",
	runtime?: SimpleResearchToolRuntime
): void {
	pi.registerTool({
		name: toolName,
		label: toolName === "spawn_research_scouts" ? "Spawn research scouts" : "Spawn follow-up scouts",
		description:
			"Spawn one or more source-scout agents, wait for them to finish, and return their completion summaries.",
		promptSnippet: "Spawn source-scout subagents for focused research assignments.",
		parameters: Type.Object({
			assignments: Type.Array(
				Type.Object({
					focus: Type.String(),
					prompt: Type.Optional(Type.String())
				}),
				{ minItems: 1 }
			)
		}),
		prepareArguments: (args) => normalizeScoutArguments(args),
		executionMode: "sequential",
		execute: async (toolCallId, params, signal, _onUpdate, ctx) => {
			const assignments = params.assignments.map((assignment) => ({
				focus: assignment.focus,
				prompt: assignment.prompt ?? assignment.focus
			}));
			if (assignments.length === 0) {
				throw new Error(`${toolName} requires at least one scout assignment.`);
			}
			const records = await requireRuntime(runtime).spawnScoutAssignments(
				pi,
				ctx,
				toolCallId,
				assignments,
				signal
			);
			const summary = records
				.map((record, index) => {
					const result = record.result?.trim() || record.error || record.status;
					return `${index + 1}. ${record.status}: ${result}`;
				})
				.join("\n");
			return toolTextResult(`Completed ${records.length} source-scout run(s).\n${summary}`, {
				records: records.map((record) => ({
					id: record.id,
					status: record.status,
					result: record.result,
					error: record.error
				}))
			});
		}
	});
}

export function registerReviewReportsTool(
	pi: ExtensionAPI,
	runtime?: SimpleResearchToolRuntime
): void {
	pi.registerTool({
		name: "review_research_reports",
		label: "Review research reports",
		description: "Read scout reports from working memory and summarize coverage, gaps, and report paths.",
		promptSnippet: "Review completed source-scout reports before deciding whether more scouting is needed.",
		parameters: Type.Object({
			question: Type.Optional(Type.String())
		}),
		executionMode: "sequential",
		execute: async (_toolCallId, params) => {
			const response = requireRuntime(runtime).reviewResearchReports(params.question);
			return toolTextResult(response.text, response.details);
		}
	});
}

export function registerQueueReportWriterTool(
	pi: ExtensionAPI,
	runtime?: SimpleResearchToolRuntime
): void {
	pi.registerTool({
		name: "queue_report_writer",
		label: "Queue report writer",
		description: "Spawn the report-writer agent, wait for it to write the final report, and return the writer output.",
		promptSnippet: "Queue the report-writer subagent for final synthesis.",
		parameters: Type.Object({
			focus: Type.String()
		}),
		prepareArguments: (args) => {
			if (typeof args === "string") return { focus: args };
			if (args && typeof args === "object" && "prompt" in args && !("focus" in args)) {
				return { focus: String((args as { prompt: unknown }).prompt) };
			}
			return args as { focus: string };
		},
		executionMode: "sequential",
		execute: async (toolCallId, params, signal, _onUpdate, ctx) => {
			const record = await requireRuntime(runtime).spawnReportWriter(
				pi,
				ctx,
				toolCallId,
				params.focus,
				signal
			);
			const result = record.result?.trim() || record.error || record.status;
			return toolTextResult(`Report writer ${record.status}.\n\n${result}`, {
				id: record.id,
				status: record.status,
				result: record.result,
				error: record.error
			});
		}
	});
}

export function registerWriteResearchReportTool(
	pi: ExtensionAPI,
	runtime?: SimpleResearchToolRuntime
): void {
	pi.registerTool({
		name: "write_research_report",
		label: "Write research report",
		description:
			"Write one source-scout markdown report into the active research session's research-memory/scout-reports directory.",
		promptSnippet: "Persist a source-scout markdown report.",
		parameters: Type.Object({
			title: Type.Optional(Type.String()),
			content: Type.String()
		}),
		executionMode: "sequential",
		execute: async (_toolCallId, params) => {
			const response = requireRuntime(runtime).writeResearchReport(params.title, params.content);
			return toolTextResult(response.text, response.details);
		}
	});
}

export function registerWriteReportTool(
	pi: ExtensionAPI,
	runtime?: SimpleResearchToolRuntime
): void {
	pi.registerTool({
		name: "write_report",
		label: "Write report",
		description:
			"Write the final markdown report into the active research session's research-memory/reports directory.",
		promptSnippet: "Persist the final research report.",
		parameters: Type.Object({
			title: Type.Optional(Type.String()),
			content: Type.String()
		}),
		executionMode: "sequential",
		execute: async (_toolCallId, params) => {
			const response = requireRuntime(runtime).writeFinalReport(params.title, params.content);
			return toolTextResult(response.text, response.details);
		}
	});
}
