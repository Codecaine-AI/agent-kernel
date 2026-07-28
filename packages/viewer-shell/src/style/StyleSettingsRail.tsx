import type { PointerEvent as ReactPointerEvent } from "react";

import type {
	StylePanelTab,
	StyleSettings,
	StyleSettingsPatch
} from "./style-settings";
import { StyleSettingsPanel } from "./StyleSettingsPanel";

type StyleSettingsRailProps = {
	collapsed: boolean;
	onCollapsedChange: (collapsed: boolean) => void;
	onResizeEnd: () => void;
	onResizeStart: () => void;
	onWidthChange: (width: number) => void;
	settings: StyleSettings;
	onSettingsChange: (updates: StyleSettingsPatch) => void;
	/** Visible panel tabs (app config); omit for all. */
	sections?: readonly StylePanelTab[];
	/**
	 * "responsive" (default): vertical right-edge rail at lg+, horizontal bar
	 * below (the example app stacks it under the workspace on small screens).
	 * "vertical": always the right-edge column treatment — for hosts that keep
	 * a fixed-width rail at every viewport (e.g. the canvas viewer).
	 */
	orientation?: "responsive" | "vertical";
};

export function StyleSettingsRail({
	collapsed,
	onCollapsedChange,
	onResizeEnd,
	onResizeStart,
	onWidthChange,
	settings,
	onSettingsChange,
	sections,
	orientation = "responsive"
}: StyleSettingsRailProps) {
	const vertical = orientation === "vertical";
	function startResize(event: ReactPointerEvent<HTMLDivElement>) {
		event.preventDefault();
		onResizeStart();
		const onMove = (moveEvent: PointerEvent) => onWidthChange(window.innerWidth - moveEvent.clientX);
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			onResizeEnd();
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	}

	if (collapsed) {
		return (
			<aside
				className={`style-settings-rail style-settings-rail-collapsed min-w-0 overflow-hidden bg-card/70 ${
					vertical ? "h-full border-l border-border" : "border-t border-border lg:border-l lg:border-t-0"
				}`}
			>
				<button
					aria-expanded={false}
					className={`flex w-full items-center justify-center gap-2 border-border bg-muted/30 px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground ${
						vertical ? "h-full flex-col" : "h-12 lg:h-full lg:flex-col"
					}`}
					onClick={() => onCollapsedChange(false)}
					title="Open style controls"
					type="button"
				>
					<span aria-hidden className="text-base leading-none">◧</span>
					<span
						className={
							vertical
								? "[writing-mode:vertical-rl] rotate-180"
								: "lg:[writing-mode:vertical-rl] lg:rotate-180"
						}
					>
						Style
					</span>
				</button>
			</aside>
		);
	}

	return (
		<aside
			className={`style-settings-rail style-settings-rail-open relative grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-card/85 ${
				vertical ? "h-full border-l border-border" : "border-t border-border lg:border-l lg:border-t-0"
			}`}
		>
			<div
				aria-hidden
				className="style-settings-rail-resize-handle"
				onPointerDown={startResize}
				title="Drag to resize"
			/>
			<div className="flex h-[var(--research-header-height,56px)] min-h-[56px] items-center gap-3 border-b border-border bg-muted/55 px-3">
				<h2 className="m-0 min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-center font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-foreground">
					Style
				</h2>
				<button
					aria-expanded
					className="grid h-8 w-8 shrink-0 place-items-center border border-border bg-card text-muted-foreground transition-colors hover:border-status-info-border hover:text-foreground"
					onClick={() => onCollapsedChange(true)}
					title="Hide style controls"
					type="button"
				>
					<span aria-hidden>›</span>
					<span className="sr-only">Hide</span>
				</button>
			</div>
			<div className="min-h-0 overflow-y-auto p-3">
				<StyleSettingsPanel sections={sections} settings={settings} onChange={onSettingsChange} />
			</div>
		</aside>
	);
}
