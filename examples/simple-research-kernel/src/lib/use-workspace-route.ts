import { useCallback, useEffect, useState } from "react";

import type { WorkspaceId } from "./types";

/**
 * URL layout for the workspaces. Each viewer is its own page so a reload
 * keeps you on the one you were viewing.
 *
 *   /research → Research Run (also the landing page; "/" redirects here)
 *   /traces  → Trace Viewer
 *   /agents  → Agent Viewer
 */
const WORKSPACE_PATHS: Record<WorkspaceId, string> = {
	research: "/research",
	trace: "/traces",
	agents: "/agents"
};

const PATH_WORKSPACES: Record<string, WorkspaceId> = {
	"/research": "research",
	"/traces": "trace",
	"/agents": "agents"
};

export function pathnameForWorkspace(workspace: WorkspaceId): string {
	return WORKSPACE_PATHS[workspace];
}

export function workspaceFromPathname(pathname: string): WorkspaceId {
	return PATH_WORKSPACES[pathname] ?? "research";
}

function isCanonicalPath(pathname: string): boolean {
	return pathname === "/research" || pathname === "/traces" || pathname === "/agents";
}

/**
 * Tracks the active workspace from the URL using the History API, so the trace
 * and agent viewers behave like separate pages that survive a reload.
 */
export function useWorkspaceRoute(): {
	activeWorkspace: WorkspaceId;
	navigate: (workspace: WorkspaceId) => void;
} {
	const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>(() =>
		workspaceFromPathname(window.location.pathname)
	);

	// Canonicalize the URL on load: anything that isn't a known workspace path
	// (including the bare root "/") lands at /research, preserving any query/hash.
	useEffect(() => {
		const { pathname, search, hash } = window.location;
		if (isCanonicalPath(pathname)) return;
		window.history.replaceState(null, "", `/research${search}${hash}`);
		setActiveWorkspace("research");
	}, []);

	useEffect(() => {
		function handlePopState() {
			setActiveWorkspace(workspaceFromPathname(window.location.pathname));
		}
		window.addEventListener("popstate", handlePopState);
		return () => window.removeEventListener("popstate", handlePopState);
	}, []);

	const navigate = useCallback((workspace: WorkspaceId) => {
		const nextPath = pathnameForWorkspace(workspace);
		if (window.location.pathname === nextPath) return;
		const currentTraceId = new URLSearchParams(window.location.search).get("traceId");
		const nextSearch =
			workspace === "trace" && currentTraceId ? `?traceId=${encodeURIComponent(currentTraceId)}` : "";
		window.history.pushState(null, "", `${nextPath}${nextSearch}`);
		setActiveWorkspace(workspace);
	}, []);

	return { activeWorkspace, navigate };
}
