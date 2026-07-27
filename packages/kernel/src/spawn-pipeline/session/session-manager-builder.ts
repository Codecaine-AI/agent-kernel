import { join } from "node:path";

import { SessionManager } from "@earendil-works/pi-coding-agent";

import type { ResumeToolResultInput } from "../types";
import { appendResumeToolResult } from "./branch-based-resume";

export interface BuildSessionManagerOptions {
	sessionManager?: SessionManager;
	/** Primary grouping identity — namespaces the Pi session storage path. */
	containerId?: string;
	/** Session working directory (SessionManager root). */
	sessionDir?: string;
	piSessionsDir?: string;
	reuseExistingSession?: boolean;
	resumeFromToolResult?: ResumeToolResultInput;
}

export async function buildSessionManager(
	name: string,
	opts: BuildSessionManagerOptions,
): Promise<SessionManager | undefined> {
	const manager = await openOrCreateSessionManager(name, opts);
	if (manager && opts.resumeFromToolResult) {
		appendResumeToolResult(manager, opts.resumeFromToolResult);
	}
	return manager;
}

async function openOrCreateSessionManager(
	name: string,
	opts: BuildSessionManagerOptions,
): Promise<SessionManager | undefined> {
	if (opts.sessionManager) return opts.sessionManager;
	if (!opts.containerId || !opts.sessionDir) return undefined;
	if (!opts.piSessionsDir) {
		throw new Error("buildSessionManager requires opts.piSessionsDir when session storage is enabled");
	}
	const sessionsDir = join(opts.piSessionsDir, opts.containerId, name);
	const shouldReuse = Boolean(opts.reuseExistingSession || opts.resumeFromToolResult);
	if (shouldReuse) {
		const existing = await SessionManager.list(opts.sessionDir, sessionsDir);
		if (existing.length > 0) return SessionManager.open(existing[0].path, sessionsDir);
	}
	return SessionManager.create(opts.sessionDir, sessionsDir);
}
