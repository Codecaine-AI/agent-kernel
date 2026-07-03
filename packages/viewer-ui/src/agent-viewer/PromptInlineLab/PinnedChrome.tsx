// The editor chrome pinned atop the details column: status chips + mode toggle + undo/redo/reset/save.

import cn from "classnames";
import { Redo2, RotateCcw, Save, Undo2 } from "lucide-react";
import type { PromptFlowMode } from "../prompt-flow/types";

/**
 * The editor chrome, pinned to the top of the details column. Two rows:
 *  1. status — dirty/valid chips, token count, saved-hash chip.
 *  2. controls — Agent XML / Sections mode toggle, undo, redo, reset, Save.
 * Keyboard shortcuts still drive undo/redo (see handleKeyDown on the section),
 * so relocating the buttons here changes only where they render.
 */
export function PinnedChrome({
	mode,
	onMode,
	dirty,
	errorCount,
	warningCount,
	tokenCount,
	savedHash,
	canUndo,
	canRedo,
	saving,
	hasSave,
	onUndo,
	onRedo,
	onReset,
	onSave,
}: {
	mode: PromptFlowMode;
	onMode: (mode: PromptFlowMode) => void;
	dirty: boolean;
	errorCount: number;
	warningCount: number;
	tokenCount: number;
	savedHash?: string;
	canUndo: boolean;
	canRedo: boolean;
	saving: boolean;
	hasSave: boolean;
	onUndo: () => void;
	onRedo: () => void;
	onReset: () => void;
	onSave: () => void;
}) {
	return (
		<div className="shrink-0 border-b border-border bg-muted/20 px-3 py-2.5">
			<div className="flex flex-wrap items-center gap-1.5">
				<StatusChip tone={dirty ? "amber" : "neutral"}>{dirty ? "draft" : "source"}</StatusChip>
				<StatusChip tone={errorCount > 0 ? "red" : warningCount > 0 ? "amber" : "green"}>
					{errorCount > 0 ? `${errorCount} err` : warningCount > 0 ? `${warningCount} warn` : "valid"}
				</StatusChip>
				{savedHash && (
					<StatusChip tone="neutral">
						<span className="normal-case" title={savedHash}>
							{shortHash(savedHash)}
						</span>
					</StatusChip>
				)}
				<span className="ml-auto tabular-nums text-[11px] text-muted-foreground">
					{tokenCount.toLocaleString()}
					<span className="ml-1 text-[9px] uppercase tracking-[0.12em] text-muted-foreground/55">tok</span>
				</span>
			</div>

			<div className="mt-2 flex flex-wrap items-center gap-1">
				<ModeButton active={mode === "xml"} onClick={() => onMode("xml")}>
					Agent XML
				</ModeButton>
				<ModeButton active={mode === "sections"} onClick={() => onMode("sections")}>
					Sections
				</ModeButton>
				<IconButton onClick={onUndo} disabled={!canUndo} title="Undo (mod+z)" ariaLabel="Undo">
					<Undo2 size={13} />
				</IconButton>
				<IconButton onClick={onRedo} disabled={!canRedo} title="Redo (mod+shift+z)" ariaLabel="Redo">
					<Redo2 size={13} />
				</IconButton>
				<IconButton onClick={onReset} disabled={!dirty} title="Reset draft" ariaLabel="Reset draft">
					<RotateCcw size={13} />
				</IconButton>
				{hasSave && (
					<button
						type="button"
						onClick={onSave}
						disabled={!dirty || saving}
						className={cn(
							"ml-auto inline-flex h-7 items-center gap-1.5 rounded-[2px] border px-2 text-[11px] uppercase tracking-[0.1em] transition-colors",
							dirty && !saving
								? "border-status-success-border bg-status-success-fill/40 text-status-success hover:bg-status-success-fill/60"
								: "cursor-not-allowed border-border bg-background text-muted-foreground opacity-45",
						)}
					>
						<Save size={13} />
						{saving ? "Saving…" : "Save"}
					</button>
				)}
			</div>
		</div>
	);
}

function shortHash(hash: string): string {
	const bare = hash.startsWith("pk1-") ? hash.slice(4) : hash;
	return bare.slice(0, 10);
}

function IconButton({
	onClick,
	disabled,
	title,
	ariaLabel,
	children,
}: {
	onClick: () => void;
	disabled: boolean;
	title: string;
	ariaLabel: string;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className="inline-flex h-7 w-7 items-center justify-center rounded-[2px] border border-border bg-background text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-background disabled:hover:text-muted-foreground"
			title={title}
			aria-label={ariaLabel}
		>
			{children}
		</button>
	);
}

function ModeButton({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className={cn(
				"flex h-7 items-center rounded-[2px] border px-2 text-[11px] uppercase tracking-[0.1em] transition-colors",
				active
					? "border-status-success-border bg-status-success-fill/40 text-status-success"
					: "border-border bg-background text-muted-foreground hover:bg-muted/40 hover:text-foreground",
			)}
		>
			{children}
		</button>
	);
}

function StatusChip({
	tone,
	children,
}: {
	tone: "green" | "amber" | "red" | "neutral";
	children: React.ReactNode;
}) {
	return (
		<span
			className={cn(
				"inline-flex h-5 items-center rounded-[2px] border px-1.5 text-[10px] uppercase tracking-[0.08em]",
				tone === "green" && "border-status-success-border bg-status-success-fill/30 text-status-success",
				tone === "amber" && "border-status-warning-border bg-status-warning-fill/30 text-status-warning",
				tone === "red" && "border-destructive/45 bg-destructive/10 text-destructive",
				tone === "neutral" && "border-border bg-muted/30 text-muted-foreground",
			)}
		>
			{children}
		</span>
	);
}
