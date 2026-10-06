import type { WorkspaceId } from "@/shared/types";

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

export function isCanonicalPath(pathname: string): boolean {
	return pathname === "/research" || pathname === "/traces" || pathname === "/agents";
}
