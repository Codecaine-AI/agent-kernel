import {
	createContextBuildCompletedEvent,
	createContextBuildStartedEvent,
	createContextInputResolvedEvent,
	createSystemPromptResolvedEvent,
	type TraceEvent,
	type TraceEventIds,
} from "@agent-kernel/protocol";

import type { TraceWriterSink } from "../subagents/types";
import type {
	ContextBuildCompletedInput,
	ContextBuildStartedInput,
	ContextInputResolvedInput,
	SystemPromptResolvedInput,
} from "./event-payloads";

export interface KernelLoggerLike {
	debug(message: string, data?: Record<string, unknown>): void;
	info(message: string, data?: Record<string, unknown>): void;
}

export interface LifecycleEmitterOptions {
	/**
	 * Envelope identity for every event this emitter submits. Built in one
	 * place (currentTraceIds() / the spawn pipeline's run identity) — call
	 * sites never assemble identity by hand.
	 */
	ids: TraceEventIds;
	agentName: string;
	traceWriter: TraceWriterSink;
	spawnSpanId: string;
	parentEventId?: string;
	logger?: KernelLoggerLike;
}

export class LifecycleEmitter {
	private readonly opts: LifecycleEmitterOptions;
	private _lastEventId: string | null = null;

	constructor(opts: LifecycleEmitterOptions) {
		if (!opts.ids?.containerId) {
			throw new Error("LifecycleEmitter requires ids.containerId");
		}
		this.opts = opts;
	}

	private submit(event: TraceEvent): void {
		this.opts.traceWriter.submit(event);
		this._lastEventId = event.eventId;
	}

	private currentParentEventId(): string | undefined {
		return this._lastEventId ?? this.opts.parentEventId;
	}

	private factoryOpts(): {
		spanId: string;
		parentEventId?: string;
	} {
		return {
			spanId: this.opts.spawnSpanId,
			parentEventId: this.currentParentEventId(),
		};
	}

	systemPromptResolved(input: SystemPromptResolvedInput): void {
		this.opts.logger?.info(`[${this.opts.agentName}] system prompt resolved`, {
			tools_allowlist: input.tools_allowlist,
			domain_guard: input.domain_rules_installed,
		});
		this.submit(
			createSystemPromptResolvedEvent(this.opts.ids, input, this.factoryOpts()),
		);
	}

	contextBuildStarted(input: ContextBuildStartedInput): void {
		this.opts.logger?.info(`[${this.opts.agentName}] context build started`, {
			inputs: input.declared_inputs.length,
			kinds: input.declared_inputs.map((i) => i.kind),
		});
		this.submit(
			createContextBuildStartedEvent(this.opts.ids, input, this.factoryOpts()),
		);
	}

	contextInputResolved(input: ContextInputResolvedInput): void {
		this.opts.logger?.debug(
			`[${this.opts.agentName}] input resolved: ${input.loader_kind}/${input.input_ref}`,
			{
				status: input.status,
				bytes: input.bytes,
			},
		);
		this.submit(
			createContextInputResolvedEvent(this.opts.ids, input, this.factoryOpts()),
		);
	}

	contextBuildCompleted(input: ContextBuildCompletedInput): void {
		this.opts.logger?.info(`[${this.opts.agentName}] context build completed`, {
			total_bytes: input.total_bytes,
			inputs: input.inputs.length,
		});
		this.submit(
			createContextBuildCompletedEvent(this.opts.ids, input, this.factoryOpts()),
		);
	}
}

export function createSpawnLifecycleEmitter(
	opts: LifecycleEmitterOptions,
): LifecycleEmitter {
	return new LifecycleEmitter(opts);
}
