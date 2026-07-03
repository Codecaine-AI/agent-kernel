import type { PointerEvent as ReactPointerEvent } from "react";

import type {
	ResearchStyleSettings,
	ResearchStyleSettingsPatch
} from "../../lib/style-settings";
import { StyleSettingsPanel } from "./StyleSettingsPanel";

type StyleSettingsRailProps = {
	collapsed: boolean;
	onCollapsedChange: (collapsed: boolean) => void;
	onResizeEnd: () => void;
	onResizeStart: () => void;
	onWidthChange: (width: number) => void;
	settings: ResearchStyleSettings;
	onSettingsChange: (updates: ResearchStyleSettingsPatch) => void;
};

export function StyleSettingsRail({
	collapsed,
	onCollapsedChange,
	onResizeEnd,
	onResizeStart,
	onWidthChange,
	settings,
	onSettingsChange
}: StyleSettingsRailProps) {
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
			<aside className="style-settings-rail style-settings-rail-collapsed min-w-0 overflow-hidden border-t border-border bg-card/70 lg:border-l lg:border-t-0">
				<button
					aria-expanded={false}
					className="flex h-12 w-full items-center justify-center gap-2 border-border bg-muted/30 px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground lg:h-full lg:flex-col"
					onClick={() => onCollapsedChange(false)}
					title="Open style controls"
					type="button"
				>
					<span aria-hidden className="text-base leading-none">◧</span>
					<span className="lg:[writing-mode:vertical-rl] lg:rotate-180">Style</span>
				</button>
			</aside>
		);
	}

	return (
		<aside className="style-settings-rail style-settings-rail-open relative grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-t border-border bg-card/85 lg:border-l lg:border-t-0">
			<div
				aria-hidden
				className="style-settings-rail-resize-handle"
				onPointerDown={startResize}
				title="Drag to resize"
			/>
			<div className="flex h-[var(--research-header-height)] min-h-[56px] items-center gap-3 border-b border-border bg-muted/55 px-3">
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
				<StyleSettingsPanel settings={settings} onChange={onSettingsChange} />
			</div>
		</aside>
	);
}
