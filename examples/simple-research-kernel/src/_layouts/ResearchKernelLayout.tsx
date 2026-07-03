import { useCallback, useState, type CSSProperties, type ReactNode } from "react";

import { AppSidebar } from "../_components/sidebar/AppSidebar";
import { ResearchStyleOverlay } from "../_components/style/ResearchStyleOverlay";
import { StyleSettingsRail } from "../_components/style/StyleSettingsRail";
import {
	clampStyleRailWidth,
	loadStyleRailCollapsed,
	loadStyleRailWidth,
	saveStyleRailCollapsed,
	saveStyleRailWidth
} from "../lib/style-rail-state";
import {
	researchStyleVars,
	styleEffectClass,
	type ResearchStyleSettings,
	type ResearchStyleSettingsPatch
} from "../lib/style-settings";
import type { WorkspaceId } from "../lib/types";

type ResearchKernelLayoutProps = {
	activeWorkspace: WorkspaceId;
	onWorkspaceChange: (workspace: WorkspaceId) => void;
	styleSettings: ResearchStyleSettings;
	onStyleSettingsChange: (updates: ResearchStyleSettingsPatch) => void;
	children: ReactNode;
};

export function ResearchKernelLayout({
	activeWorkspace,
	onWorkspaceChange,
	styleSettings,
	onStyleSettingsChange,
	children
}: ResearchKernelLayoutProps) {
	const [styleRailCollapsed, setStyleRailCollapsedState] = useState(loadStyleRailCollapsed);
	const [styleRailWidth, setStyleRailWidthState] = useState(loadStyleRailWidth);
	const [styleRailResizing, setStyleRailResizing] = useState(false);

	const setStyleRailCollapsed = useCallback((collapsed: boolean) => {
		setStyleRailCollapsedState(collapsed);
		saveStyleRailCollapsed(collapsed);
	}, []);

	const setStyleRailWidth = useCallback((width: number) => {
		setStyleRailWidthState(clampStyleRailWidth(width));
	}, []);

	const finishStyleRailResize = useCallback(() => {
		setStyleRailResizing(false);
		setStyleRailWidthState((width) => {
			saveStyleRailWidth(width);
			return width;
		});
	}, []);

	const shellStyle = {
		...researchStyleVars(styleSettings),
		"--research-style-rail-track": styleRailCollapsed ? "52px" : `${styleRailWidth}px`
	} as CSSProperties;

	return (
		<main
			className={`research-style-shell ${styleEffectClass(styleSettings)} ${
				styleRailResizing ? "research-style-shell-resizing" : ""
			} min-h-screen bg-background font-sans text-foreground`}
			style={shellStyle}
		>
			<div className="research-layout-grid grid min-h-screen">
				<AppSidebar
					activeWorkspace={activeWorkspace}
					onWorkspaceChange={onWorkspaceChange}
				/>
				<div className="min-w-0">
					<div className="research-workspace-pad">{children}</div>
				</div>
				<StyleSettingsRail
					collapsed={styleRailCollapsed}
					onCollapsedChange={setStyleRailCollapsed}
					onResizeEnd={finishStyleRailResize}
					onResizeStart={() => setStyleRailResizing(true)}
					onWidthChange={setStyleRailWidth}
					settings={styleSettings}
					onSettingsChange={onStyleSettingsChange}
				/>
			</div>
			<ResearchStyleOverlay settings={styleSettings.grain} />
		</main>
	);
}
