import type { ComponentType } from "react";
import type { RendererProps } from "./types";
import { BaseRenderer } from "./renderers/BaseRenderer";
import { SystemPromptRenderer } from "./renderers/SystemPromptRenderer";
import { ToolCallRenderer } from "./renderers/ToolCallRenderer";
import { UserMessageRenderer } from "./renderers/UserMessageRenderer";
import { AssistantMessageRenderer } from "./renderers/AssistantMessageRenderer";
import { ContextBuildRenderer } from "./renderers/ContextBuildRenderer";
import { WarningRenderer } from "./renderers/WarningRenderer";

export type PrimaryRenderer = ComponentType<RendererProps>;

export const rendererRegistry: Record<string, PrimaryRenderer> = {
  system_prompt_resolved: SystemPromptRenderer,
  tool_call_start: ToolCallRenderer,
  tool_call_end: ToolCallRenderer,
  user_message: UserMessageRenderer,
  assistant_message: AssistantMessageRenderer,
  context_build_started: ContextBuildRenderer,
  context_build_completed: ContextBuildRenderer,
  warning: WarningRenderer,
  error: WarningRenderer,
};

export function resolveRenderer(
  eventType: string | undefined,
): PrimaryRenderer {
  if (!eventType) return BaseRenderer;
  return rendererRegistry[eventType] ?? BaseRenderer;
}
