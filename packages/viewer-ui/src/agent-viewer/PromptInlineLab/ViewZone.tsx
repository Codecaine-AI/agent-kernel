// Sidebar VIEW zone: SYSTEM | CONTEXT two-way selector. Replaces the old top
// tab strip — it decides what the left editor surface renders.

import cn from "classnames";

export type LabView = "system" | "context";

export function ViewZone({
	view,
	onViewChange,
}: {
	view: LabView;
	onViewChange: (view: LabView) => void;
}) {
	return (
		<section className="shrink-0 border-b border-border bg-muted/10 px-3 py-2.5">
			<div className="mb-2 flex items-center gap-2">
				<span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
					View
				</span>
				<span className="h-px flex-1 bg-border" />
			</div>
			<div className="flex overflow-hidden rounded-[3px] border border-border bg-background">
				<ViewCell active={view === "system"} onClick={() => onViewChange("system")}>
					System
				</ViewCell>
				<ViewCell active={view === "context"} onClick={() => onViewChange("context")}>
					Context
				</ViewCell>
			</div>
		</section>
	);
}

function ViewCell({
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
