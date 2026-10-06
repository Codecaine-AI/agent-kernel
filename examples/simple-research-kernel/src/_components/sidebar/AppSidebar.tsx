import type { CSSProperties } from "react";

import type { WorkspaceId } from "../../lib/types";
import { pathnameForWorkspace } from "../../lib/use-workspace-route";

type AppSidebarProps = {
	activeWorkspace: WorkspaceId;
	onWorkspaceChange: (workspace: WorkspaceId) => void;
};

/** The active item's LED glow: the success hue mixed into the panel, one space step wide. */
const ACTIVE_LED_GLOW: CSSProperties = {
	boxShadow: "0 0 var(--ds-space-1) var(--ds-color-status-success-line)"
};

const navItems: Array<{ id: WorkspaceId; label: string }> = [
	{ id: "research", label: "Research Run" },
	{ id: "trace", label: "Trace Viewer" },
	{ id: "agents", label: "Agent Viewer" }
];

export function AppSidebar({ activeWorkspace, onWorkspaceChange }: AppSidebarProps) {
	return (
		<aside className="flex min-h-0 flex-col border-b border-border bg-card/70 lg:h-screen lg:border-b-0 lg:border-r">
			<div className="flex items-center justify-center border-b border-border px-4 py-4">
				<h1 className="font-mono text-ui-sm font-semibold uppercase tracking-micro-wide leading-none text-foreground">
					Research Kernel
				</h1>
			</div>

			<nav className="grid gap-1 p-2 sm:grid-cols-3 lg:block lg:space-y-0.5" aria-label="Workspaces">
				{navItems.map((item) => {
					const active = item.id === activeWorkspace;
					return (
						<a
							key={item.id}
							href={pathnameForWorkspace(item.id)}
							aria-current={active ? "page" : undefined}
							onClick={(event) => {
								event.preventDefault();
								onWorkspaceChange(item.id);
							}}
							className={`relative flex items-center gap-2.5 rounded border px-3 py-2.5 font-mono transition-colors ${
								active
									? "border-status-success-border bg-status-success-fill/40 text-foreground"
									: "border-transparent text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground"
							}`}
						>
							<span
								aria-hidden
								className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
									active ? "bg-status-success" : "bg-muted-foreground/30"
								}`}
								style={active ? ACTIVE_LED_GLOW : undefined}
							/>
							<span className="text-ui-xs font-medium uppercase tracking-micro-wide">{item.label}</span>
						</a>
					);
				})}
			</nav>
		</aside>
	);
}
