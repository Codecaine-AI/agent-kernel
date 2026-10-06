import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type CSSProperties,
	type KeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	type ReactNode
} from "react";

import { StyleOverlay, StyleSettingsPanel } from "@agent-kernel/viewer-shell";

import { AppShell, resolveNav, type NavSection, type ShellLinkProps } from "../_components/AppShell";
import { Icon } from "../shared/_components/Icon";
import {
	clampStyleRailWidth,
	loadStoredStyleRailWidth,
	loadStyleRailCollapsed,
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
import { pathnameForWorkspace, workspaceFromPathname } from "../lib/use-workspace-route";

type ResearchKernelLayoutProps = {
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

const NavigateContext = createContext<(workspace: WorkspaceId) => void>(() => {});

/**
 * The shell's nav link: a real link (it opens in a new tab with a modifier), and a plain
 * click switches the workspace in place through the History API. Module scope, so it
 * keeps one identity across renders.
 */
function WorkspaceLink({ href, onClick, ...rest }: ShellLinkProps) {
	const navigate = useContext(NavigateContext);
	return (
		<a
			{...rest}
			href={href}
			onClick={(event) => {
				onClick?.(event);
				if (
					event.defaultPrevented ||
					event.button !== 0 ||
					event.metaKey ||
					event.ctrlKey ||
					event.shiftKey ||
					event.altKey
				) {
					return;
				}
				event.preventDefault();
				navigate(workspaceFromPathname(href));
			}}
		/>
	);
}

/** The inspector closes on Escape from inside it; an Escape that ends IME composition must not. */
function keepOpenWhileComposing(event: KeyboardEvent<HTMLDivElement>) {
	if (event.key === "Escape" && (event.nativeEvent.isComposing || event.keyCode === 229)) {
		event.stopPropagation();
	}
}

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
	const [styleOpen, setStyleOpen] = useState(() => !loadStyleRailCollapsed());
	const [styleRailWidth, setStyleRailWidth] = useState(loadStoredStyleRailWidth);
	const [styleRailResizing, setStyleRailResizing] = useState(false);
	const styleButtonRef = useRef<HTMLButtonElement>(null);
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

	const openStyle = useCallback(() => {
		setStyleOpen(true);
		saveStyleRailCollapsed(false);
	}, []);

	// Every close path (the inspector's close button, Escape inside it, the Style button)
	// returns focus to Style, also when the inspector mounted open and the shell saw no opener.
	const closeStyle = useCallback(() => {
		setStyleOpen(false);
		saveStyleRailCollapsed(true);
		styleButtonRef.current?.focus({ preventScroll: true });
	}, []);

	const startStyleRailResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
		event.preventDefault();
		setStyleRailResizing(true);
		let width: number | null = null;
		const onMove = (moveEvent: PointerEvent) => {
			// The inspector ends at the root's client edge, left of a classic vertical scrollbar.
			width = clampStyleRailWidth(document.documentElement.clientWidth - moveEvent.clientX);
			setStyleRailWidth(width);
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
			setStyleRailResizing(false);
			if (width !== null) saveStyleRailWidth(width);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onUp);
	}, []);

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
							<button
								key="style"
								ref={styleButtonRef}
								type="button"
								className="ds-shell-button"
								aria-expanded={styleOpen}
								aria-controls="ds-inspector"
								onClick={styleOpen ? closeStyle : openStyle}
							>
								Style
							</button>
							<button
								key="theme"
								type="button"
								className="ds-shell-icon-button"
								aria-label="Dark theme"
								aria-pressed={dark}
								title="Dark theme"
								onClick={() => onStyleSettingsChange({ theme: dark ? "light" : "dark" })}
							>
								<Icon name="moon" />
							</button>
						</>
					}
					inspector={{
						title: "Style",
						open: styleOpen,
						onClose: closeStyle,
						content: (
							<div onKeyDown={keepOpenWhileComposing}>
								<div
									aria-hidden
									className="style-settings-rail-resize-handle"
									onPointerDown={startStyleRailResize}
									title="Drag to resize"
								/>
								<StyleSettingsPanel settings={styleSettings} onChange={onStyleSettingsChange} />
							</div>
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
