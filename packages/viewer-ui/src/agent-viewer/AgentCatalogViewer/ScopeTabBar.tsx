// The SYSTEM/CONTEXT/SYS+CTX + Inline/Raw tab strip with token count + font-size control.

import cn from "classnames";
import { type ReactNode } from "react";

import type { FontScale, Form, Scope } from "./shared";

export function ScopeTabBar({
	scope,
	onScopeChange,
	form,
	onFormChange,
	fontScale,
	onFontScaleChange,
	tokens,
	hasPromptAst,
}: {
	scope: Scope;
	onScopeChange: (scope: Scope) => void;
	form: Form;
	onFormChange: (form: Form) => void;
	fontScale: FontScale;
	onFontScaleChange: (scale: FontScale) => void;
	tokens: number;
	hasPromptAst: boolean;
}) {
	return (
		<div className="flex shrink-0 items-stretch overflow-hidden rounded-[3px] border border-border bg-background">
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="flex">
					<BarCell active={scope === "system"} onClick={() => onScopeChange("system")}>System</BarCell>
					<BarCell active={scope === "context"} onClick={() => onScopeChange("context")}>Context</BarCell>
					<BarCell active={scope === "combined"} onClick={() => onScopeChange("combined")}>Sys + Ctx</BarCell>
				</div>
				<div className="flex border-t border-border">
					<BarCell active={form === "rendered"} onClick={() => onFormChange("rendered")}>
						{hasPromptAst && scope === "system" ? "Inline" : "Rendered"}
					</BarCell>
					<BarCell active={form === "raw"} onClick={() => onFormChange("raw")}>Raw</BarCell>
				</div>
			</div>
			<div className="flex flex-col items-end justify-center gap-1.5 border-l border-border px-3 py-1.5">
				<span className="tabular-nums text-[11px] text-muted-foreground">
					{tokens.toLocaleString()}
					<span className="ml-1 text-[9px] uppercase tracking-[0.12em] text-muted-foreground/55">tok</span>
				</span>
				<FontScaleControl value={fontScale} onChange={onFontScaleChange} />
			</div>
		</div>
	);
}

function BarCell({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className={cn(
				"flex h-8 flex-1 items-center justify-center border-r border-border text-[11px] uppercase tracking-[0.12em] transition-colors last:border-r-0",
				active
					? "bg-status-success-fill/40 text-status-success"
					: "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
			)}
		>
			{children}
		</button>
	);
}

function FontScaleControl({
	value,
	onChange,
}: {
	value: FontScale;
	onChange: (scale: FontScale) => void;
}) {
	const options: Array<{ key: FontScale; label: string }> = [
		{ key: "small", label: "S" },
		{ key: "medium", label: "M" },
		{ key: "large", label: "L" },
	];
	return (
		<div
			className="inline-flex overflow-hidden rounded-[3px] border border-border bg-background"
			role="group"
			aria-label="Prompt text size"
		>
			{options.map((option) => {
				const active = option.key === value;
				return (
					<button
						key={option.key}
						type="button"
						onClick={() => onChange(option.key)}
						aria-pressed={active}
						title={`${option.key[0].toUpperCase()}${option.key.slice(1)} prompt text`}
						className={cn(
							"flex h-7 w-7 items-center justify-center border-r border-border text-[11px] font-medium uppercase leading-none transition-colors last:border-r-0",
							active
								? "bg-status-success-fill/50 text-status-success"
								: "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
						)}
					>
						{option.label}
					</button>
				);
			})}
		</div>
	);
}
