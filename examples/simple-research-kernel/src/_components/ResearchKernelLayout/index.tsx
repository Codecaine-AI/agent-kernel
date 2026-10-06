import { useEffect, useLayoutEffect, type CSSProperties, type ReactNode } from "react";

import { StyleOverlay } from "@agent-kernel/viewer-shell";

import { AppShell, resolveNav, type NavSection } from "../AppShell";
import { Icon } from "@/shared/_components/Icon";
import {
	researchStyleVars,
	styleEffectClass,
	type ResearchStyleSettings,
	type ResearchStyleSettingsPatch
} from "@/shared/style-settings";
import type { WorkspaceId } from "@/shared/types";
import { pathnameForWorkspace } from "../../workspace-paths";
import "./styles.css";
import { NavigateContext, WorkspaceLink } from "./_components/WorkspaceLink";
import { StyleToggle } from "./_components/StyleToggle";
import { ThemeToggle } from "./_components/ThemeToggle";
import { StylePanel } from "./_components/StylePanel";
import { useInspectorResize } from "./useInspectorResize";
import { useStyleInspector } from "./useStyleInspector";

export type ResearchKernelLayoutProps = {
	activeWorkspace: WorkspaceId;
	onWorkspaceChange: (workspace: WorkspaceId) => void;
	styleSettings: ResearchStyleSettings;
	onStyleSettingsChange: (updates: ResearchStyleSettingsPatch) => void;
	children: ReactNode;
};

/** The topbar h1 and the document title: the page's nav label. */
const PAGE_TITLES: Record<WorkspaceId, string> = {
	research: "Research Run",
	trace: "Trace Viewer",
	agents: "Agent Viewer"
};

const NAV_SECTIONS: NavSection[] = [
	{
		id: "workspaces",
		label: "Workspaces",
		items: [
			{
				id: "research",
				label: PAGE_TITLES.research,
				href: pathnameForWorkspace("research"),
				icon: <Icon name="research" />
			},
			{
				id: "trace",
				label: PAGE_TITLES.trace,
				href: pathnameForWorkspace("trace"),
				icon: <Icon name="traces" />
			},
			{
				id: "agents",
				label: PAGE_TITLES.agents,
				href: pathnameForWorkspace("agents"),
				icon: <Icon name="agents" />
			}
		]
	}
];

/**
 * The design-system app shell (guide/layout.md) around the three workspaces, inside the
 * viewer-shell style engine's root.
 *
 * - The engine root wraps the whole shell, as the old <main> did: its knobs (inline vars)
 *   and effects (soften, bevel, grain overlay) reach the sidebar, topbar and inspector too.
 *   styles.css maps its Layout knobs onto the shell's layout tokens.
 * - The style rail is the shell's inspector: the Style button opens it, it keeps the stored
 *   open state and `?style=open`, and its width is the shell's token until the user drags it.
 * - The theme lives in the engine's settings (one source of truth); the topbar toggle and
 *   the inspector's Theme tab both write it.
 */
export function ResearchKernelLayout({
	activeWorkspace,
	onWorkspaceChange,
	styleSettings,
	onStyleSettingsChange,
	children
}: ResearchKernelLayoutProps) {
	const { styleOpen, styleButtonRef, openStyle, closeStyle } = useStyleInspector();
	const { styleRailWidth, styleRailResizing, startStyleRailResize } = useInspectorResize();
	const title = PAGE_TITLES[activeWorkspace];
	const dark = styleSettings.theme === "dark";

	// data-theme on <html> switches the design-system tokens and the host contract. It is
	// stamped before the browser paints, so a stored dark theme never shows light first.
	useLayoutEffect(() => {
		document.documentElement.dataset.theme = styleSettings.theme;
	}, [styleSettings.theme]);

	useEffect(() => {
		document.title = title;
	}, [title]);

	const engineStyle = {
		...researchStyleVars(styleSettings),
		...(styleRailWidth === null ? {} : { "--research-style-rail-width": `${styleRailWidth}px` })
	} as CSSProperties;

	return (
		<div
			className={`research-style-shell ${styleEffectClass(styleSettings)} ${
				styleRailResizing ? "research-style-shell-resizing" : ""
			} bg-background text-foreground`}
			style={engineStyle}
		>
			<NavigateContext.Provider value={onWorkspaceChange}>
				<AppShell
					appName="Research Kernel"
					storageKey="simple-research-kernel.sidebar"
					sections={resolveNav(NAV_SECTIONS, pathnameForWorkspace(activeWorkspace))}
					title={title}
					lane="full"
					linkComponent={WorkspaceLink}
					actions={
						<>
							<StyleToggle
								key="style"
								open={styleOpen}
								toggleRef={styleButtonRef}
								onOpen={openStyle}
								onClose={closeStyle}
							/>
							<ThemeToggle
								key="theme"
								dark={dark}
								onToggle={() => onStyleSettingsChange({ theme: dark ? "light" : "dark" })}
							/>
						</>
					}
					inspector={{
						title: "Style",
						open: styleOpen,
						onClose: closeStyle,
						content: (
							<StylePanel
								settings={styleSettings}
								onChange={onStyleSettingsChange}
								onResizeStart={startStyleRailResize}
							/>
						)
					}}
				>
					{children}
				</AppShell>
			</NavigateContext.Provider>
			<StyleOverlay settings={styleSettings.grain} />
		</div>
	);
}
