// Shared instrument primitives (LED, chip, panel, channel bank) + tone tables.

import cn from "classnames";
import { type ReactNode } from "react";

export type Tone = "green" | "amber" | "red" | "cyan" | "neutral";

export const TONE_LED: Record<Tone, string> = {
	green: "bg-status-success shadow-[0_0_4px_rgb(84_214_147/0.45)]",
	amber: "bg-status-warning shadow-[0_0_4px_rgb(220_167_76/0.4)]",
	red: "bg-destructive shadow-[0_0_4px_rgb(225_91_88/0.4)]",
	cyan: "bg-status-info shadow-[0_0_4px_rgb(84_211_224/0.4)]",
	neutral: "bg-muted-foreground/35",
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
		<section className={cn("flex min-h-0 flex-col overflow-hidden rounded-[3px] border border-border bg-card", className)}>
			{children}
		</section>
	);
}

export function Led({ tone = "neutral", pulse = false, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
	return (
		<span
			aria-hidden
			className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", TONE_LED[tone], pulse && "tk-pulse", className)}
		/>
	);
}

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<span
			className={cn(
				"inline-flex h-5 items-center rounded-[2px] border border-border bg-muted/30 px-1.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground",
				className,
			)}
		>
			{children}
		</span>
	);
}

export function ChannelBank({ children, className }: { children: ReactNode; className?: string }) {
	return <div className={cn("inline-flex overflow-hidden rounded-[3px] border border-border", className)}>{children}</div>;
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
				"flex h-7 items-center border-r border-border bg-background px-2.5 text-[11px] uppercase tracking-[0.1em] transition-colors last:border-r-0",
				active
					? "bg-status-success-fill/40 text-status-success"
					: "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
			)}
		>
			{children}
		</button>
	);
}
