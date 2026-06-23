import type { ReactNode } from "react";

type PillProps = {
	children: ReactNode;
	tone?: "neutral" | "info" | "success" | "warning";
};

const toneClasses: Record<NonNullable<PillProps["tone"]>, string> = {
	neutral: "border-border text-muted-foreground",
	info: "border-status-info-border bg-status-info-fill/45 text-status-info",
	success: "border-status-success-border bg-status-success-fill/45 text-status-success",
	warning: "border-status-warning-border bg-status-warning-fill/45 text-status-warning"
};

export function Pill({ children, tone = "neutral" }: PillProps) {
	return (
		<span className={`inline-flex min-h-5 items-center rounded-[2px] border px-1.5 font-mono text-[10px] uppercase tracking-[0.1em] ${toneClasses[tone]}`}>
			{children}
		</span>
	);
}
