import type { WorkspaceId } from "../../lib/types";
import { pathnameForWorkspace } from "../../lib/use-workspace-route";

type AppSidebarProps = {
	activeWorkspace: WorkspaceId;
	onWorkspaceChange: (workspace: WorkspaceId) => void;
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
				<h1 className="font-mono text-[13px] font-semibold uppercase tracking-[0.18em] leading-none text-foreground">
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
							className={`relative flex items-center gap-2.5 rounded-[3px] border px-3 py-2.5 font-mono transition-colors ${
								active
									? "border-status-success-border bg-status-success-fill/40 text-foreground"
									: "border-transparent text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground"
							}`}
						>
							<span
								aria-hidden
								className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
									active
										? "bg-status-success shadow-[0_0_4px_rgb(84_214_147/0.45)]"
										: "bg-muted-foreground/30"
								}`}
							/>
							<span className="text-[12px] font-medium uppercase tracking-[0.14em]">{item.label}</span>
						</a>
					);
				})}
			</nav>
		</aside>
	);
}
