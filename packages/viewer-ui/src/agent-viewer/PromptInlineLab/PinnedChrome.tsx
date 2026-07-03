// Sidebar PROMPT zone: token count first, then status chips (source/valid),
// then undo/redo/reset/save with save errors inline beneath. No mode toggle.
// Controls disable in context view.

import cn from "classnames";
import { Redo2, RotateCcw, Save, Undo2 } from "lucide-react";

/**
 * The prompt editor controls, in the sidebar PROMPT zone. Layout order:
 *  1. token count (first).
 *  2. status chips — source/draft + valid/err.
 *  3. controls — undo, redo, reset, Save.
 *  4. save errors (compact, destructive) directly under the save control;
 *     the host clears them on the next successful save.
 * Keyboard shortcuts still drive undo/redo (see handleKeyDown on the section).
 * `disabled` blanks the controls while the CONTEXT view owns the left surface.
 */
export function PinnedChrome({
	dirty,
	errorCount,
	warningCount,
	tokenCount,
	savedHash,
	canUndo,
	canRedo,
	saving,
	hasSave,
	disabled,
	saveErrors = [],
	onUndo,
	onRedo,
	onReset,
	onSave,
}: {
	dirty: boolean;
	errorCount: number;
	warningCount: number;
	tokenCount: number;
	savedHash?: string;
	canUndo: boolean;
	canRedo: boolean;
	saving: boolean;
	hasSave: boolean;
	disabled?: boolean;
	saveErrors?: string[];
	onUndo: () => void;
	onRedo: () => void;
	onReset: () => void;
	onSave: () => void;
}) {
	return (
		<div className="shrink-0 border-b border-border bg-muted/10 px-3 py-2.5">
			<div className="mb-2 flex items-center gap-2">
				<span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
					Prompt
				</span>
				<span className="h-px flex-1 bg-border" />
			</div>

			<div className={cn("flex flex-col gap-2", disabled && "pointer-events-none opacity-40")}>
				<div className="flex items-baseline gap-2">
					<span className="tabular-nums text-[13px] text-foreground">
						{tokenCount.toLocaleString()}
						<span className="ml-1 text-[9px] uppercase tracking-[0.12em] text-muted-foreground/55">
							tok
						</span>
					</span>
					<div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
						<StatusChip tone={dirty ? "amber" : "neutral"}>{dirty ? "draft" : "source"}</StatusChip>
						<StatusChip tone={errorCount > 0 ? "red" : warningCount > 0 ? "amber" : "green"}>
							{errorCount > 0
								? `${errorCount} err`
								: warningCount > 0
									? `${warningCount} warn`
									: "valid"}
						</StatusChip>
						{savedHash && (
							<StatusChip tone="neutral">
								<span className="normal-case" title={savedHash}>
									{shortHash(savedHash)}
								</span>
							</StatusChip>
						)}
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-1">
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

				{saveErrors.length > 0 && (
					<ul className="flex flex-col gap-1">
						{saveErrors.map((message, index) => (
							<li
								key={`save:${index}`}
								className="flex items-start gap-1.5 text-[11px] leading-snug text-destructive"
							>
								<span className="mt-[7px] h-px w-2.5 shrink-0 bg-current opacity-60" />
								<span className="min-w-0 flex-1 break-words">{message}</span>
							</li>
						))}
					</ul>
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
