import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { StyleOverlay, StyleSettingsRail } from "@agent-kernel/viewer-shell";

import { AppSidebar } from "../_components/sidebar/AppSidebar";
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

	// Theme rides the style settings (persisted with them). The data-theme
	// attribute on <html> flips every styles.css token block (light is :root's
	// default); researchStyleVars below re-emits the inlined neutrals from the
	// matching palette so the shell and the CSS always agree.
	useEffect(() => {
		document.documentElement.dataset.theme = styleSettings.theme;
	}, [styleSettings.theme]);

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
			<StyleOverlay settings={styleSettings.grain} />
		</main>
	);
}
