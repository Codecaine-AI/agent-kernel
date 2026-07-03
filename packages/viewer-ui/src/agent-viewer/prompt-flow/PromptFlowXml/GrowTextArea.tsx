// Slice: auto-growing inline-edit textarea shared by the item + block editors.
"use client";

import { useLayoutEffect, useRef } from "react";

import { EDITOR_COLORS, editorTypeStyle, LINE_HEIGHT_PX } from "../../../shared/editor-surface";

/**
 * Auto-growing textarea matching the row's mono metrics exactly (12px / 16px
 * line-height, no padding), so inline editing keeps the surface flush.
 */
export function GrowTextArea({
	value,
	autoFocus,
	onChange,
	onBlur,
	onKeyDown,
	allowEnter,
	caretAtEnd,
}: {
	value: string;
	autoFocus?: boolean;
	onChange: (value: string) => void;
	onBlur: () => void;
	/** Extra key handling layered on top of Escape / Enter-guarding. */
	onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
	/** When true, Enter inserts a literal newline (raw / code). Otherwise the
	 * host's onKeyDown owns Enter (structural). */
	allowEnter?: boolean;
	/** Place the caret at the end on focus (used when focusing a previous item). */
	caretAtEnd?: boolean;
}) {
	const ref = useRef<HTMLTextAreaElement | null>(null);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${el.scrollHeight}px`;
	}, [value]);

	useLayoutEffect(() => {
		if (!caretAtEnd) return;
		const el = ref.current;
		if (!el) return;
		const end = el.value.length;
		el.setSelectionRange(end, end);
		// caretAtEnd only matters on mount.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<textarea
			ref={ref}
			value={value}
			autoFocus={autoFocus}
			rows={1}
			spellCheck={false}
			onClick={(event) => event.stopPropagation()}
			onChange={(event) => onChange(event.target.value)}
			onBlur={onBlur}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					event.currentTarget.blur();
					return;
				}
				onKeyDown?.(event);
				if (event.defaultPrevented) return;
				// Guard: for single-line fields, swallow a bare Enter so it never
				// injects a newline the model can't represent.
				if (event.key === "Enter" && !allowEnter && !event.shiftKey) {
					event.preventDefault();
				}
			}}
			className="m-0 min-h-4 w-full resize-none overflow-hidden border-0 bg-transparent p-0 font-mono outline-none"
				style={{ ...editorTypeStyle, minHeight: LINE_HEIGHT_PX, color: EDITOR_COLORS.fg }}
		/>
	);
}
