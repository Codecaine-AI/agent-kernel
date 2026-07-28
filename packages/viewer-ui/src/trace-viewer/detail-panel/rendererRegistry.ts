import type { DetailBodyRenderer } from "./contract";
import { BoardRenderBody } from "./renderers/BoardRenderBody";
import { ContextBuildBody } from "./renderers/ContextBuildBody";
import { FactCard } from "./renderers/FactCard";
import { MessageBody } from "./renderers/MessageBody";
import { ToolBody } from "./renderers/ToolBody";
import { TurnBody } from "./renderers/TurnBody";
import { UsageAggregateRenderer } from "./renderers/UsageAggregateRenderer";
import { WarningRenderer } from "./renderers/WarningRenderer";

/** Public so the conformance suite automatically covers every registration. */
export const rendererRegistry: Record<string, DetailBodyRenderer> = {
	system_prompt_resolved: FactCard,
	tool_call_start: ToolBody,
	tool_call_end: ToolBody,
	user_message: MessageBody,
	assistant_message: MessageBody,
	context_build_started: ContextBuildBody,
	context_build_completed: ContextBuildBody,
	warning: WarningRenderer,
	error: WarningRenderer,
	pi_request_snapshot: TurnBody,
	"app:board-render": BoardRenderBody,
	container_container: UsageAggregateRenderer,
	phase_container: UsageAggregateRenderer,
	pi_agent_container: UsageAggregateRenderer,
	run_container: UsageAggregateRenderer,
};

export function resolveRenderer(
	eventType: string | undefined,
): DetailBodyRenderer {
	if (!eventType) return FactCard;
	return rendererRegistry[eventType] ?? FactCard;
}
