// Shared instrument primitives (LED, chip, panel, channel bank) + tone tables.

import cn from "classnames";
import { type CSSProperties, type ReactNode } from "react";

export type Tone = "green" | "amber" | "red" | "cyan" | "neutral";

export const TONE_LED: Record<Tone, string> = {
	green: "bg-status-success",
	amber: "bg-status-warning",
	red: "bg-destructive",
	cyan: "bg-status-info",
	neutral: "bg-muted-foreground/35",
};

/**
 * LED glow: the tone's status line (its hue mixed into the panel, which reads as
 * the hue at about 45% over the panel) blurred over space.1. Neutral has none.
 */
export const TONE_GLOW: Partial<Record<Tone, CSSProperties>> = {
	green: { boxShadow: "0 0 var(--ds-space-1) var(--ds-color-status-success-line)" },
	amber: { boxShadow: "0 0 var(--ds-space-1) var(--ds-color-status-warning-line)" },
	red: { boxShadow: "0 0 var(--ds-space-1) var(--ds-color-status-danger-line)" },
	cyan: { boxShadow: "0 0 var(--ds-space-1) var(--ds-color-status-info-line)" },
};

// Static so Tailwind's JIT can see every class string (no dynamic construction).
export const TONE_TEXT: Record<Tone, string> = {
	green: "text-status-success",
	amber: "text-status-warning",
	red: "text-destructive",
	cyan: "text-status-info",
	neutral: "text-muted-foreground",
};

export function statusTone(status: string): Tone {
	if (status === "ok") return "green";
	if (status === "error") return "red";
	if (status === "empty") return "amber";
	return "neutral";
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<section className={cn("flex min-h-0 flex-col overflow-hidden rounded-[var(--ds-radius-base)] border border-border bg-card", className)}>
			{children}
		</section>
	);
}

export function Led({ tone = "neutral", pulse = false, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
	return (
		<span
			aria-hidden
			style={TONE_GLOW[tone]}
			className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", TONE_LED[tone], pulse && "tk-pulse", className)}
		/>
	);
}

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<span
			className={cn(
				"inline-flex h-5 items-center rounded-[var(--ds-radius-base)] border border-border bg-muted/30 px-1.5 text-[length:var(--ds-font-size-micro)] uppercase tracking-[var(--ds-letter-spacing-micro)] text-muted-foreground",
				className,
			)}
		>
			{children}
		</span>
	);
}

export function ChannelBank({ children, className }: { children: ReactNode; className?: string }) {
	return <div className={cn("inline-flex overflow-hidden rounded-[var(--ds-radius-base)] border border-border", className)}>{children}</div>;
}

export function ChannelCell({
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
				"flex h-7 items-center border-r border-border bg-background px-2.5 text-[length:var(--ds-font-size-ui-2xs)] uppercase tracking-[var(--ds-letter-spacing-micro-wide)] transition-colors last:border-r-0",
				active
					? "bg-status-success-fill/40 text-status-success"
					: "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
			)}
		>
			{children}
		</button>
	);
}
