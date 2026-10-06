import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

import { StyleSettingsPanel } from "@agent-kernel/viewer-shell";

import type { ResearchStyleSettings, ResearchStyleSettingsPatch } from "@/shared/style-settings";

export type StylePanelProps = {
	settings: ResearchStyleSettings;
	onChange: (updates: ResearchStyleSettingsPatch) => void;
	onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
};

/** The inspector closes on Escape from inside it; an Escape that ends IME composition must not. */
function keepOpenWhileComposing(event: KeyboardEvent<HTMLDivElement>) {
	if (event.key === "Escape" && (event.nativeEvent.isComposing || event.keyCode === 229)) {
		event.stopPropagation();
	}
}

/** The style inspector's content: viewer-shell's style panel and the drag edge that resizes the inspector. */
export function StylePanel({ settings, onChange, onResizeStart }: StylePanelProps) {
	return (
		<div onKeyDown={keepOpenWhileComposing}>
			<div
				aria-hidden
				className="style-settings-rail-resize-handle"
				onPointerDown={onResizeStart}
				title="Drag to resize"
			/>
			<StyleSettingsPanel settings={settings} onChange={onChange} />
		</div>
	);
}
