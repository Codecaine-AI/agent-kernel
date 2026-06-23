import type { ReactNode } from "react";

import { AppSidebar } from "../_components/sidebar/AppSidebar";
import type { WorkspaceId } from "../lib/types";

type ResearchKernelLayoutProps = {
	activeWorkspace: WorkspaceId;
	onWorkspaceChange: (workspace: WorkspaceId) => void;
	children: ReactNode;
};

export function ResearchKernelLayout({
	activeWorkspace,
	onWorkspaceChange,
	children
}: ResearchKernelLayoutProps) {
	return (
		<main className="min-h-screen bg-background font-sans text-foreground">
			<div className="grid min-h-screen lg:grid-cols-[280px_minmax(0,1fr)]">
				<AppSidebar
					activeWorkspace={activeWorkspace}
					onWorkspaceChange={onWorkspaceChange}
				/>
				<div className="min-w-0">
					<div className="p-4">{children}</div>
				</div>
			</div>
		</main>
	);
}
