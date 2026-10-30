export interface TraceLevelInfo {
	/** Short marker rendered before the name (e.g. "L2"). */
	marker: string;
	/** Human-friendly name shown on the control (e.g. "Full"). */
	name: string;
	/** Tooltip description of what this level reveals. */
	description: string;
}

interface TraceLevelSliderProps {
	levels: readonly TraceLevelInfo[];
	value: number;
	onChange: (value: number) => void;
	className?: string;
}

function cx(...parts: Array<string | false | null | undefined>): string {
	return parts.filter(Boolean).join(" ");
}

/**
 * Discrete level picker, rendered as a segmented control.
 *
 * Every level shows its NAME (Conversation / Tools / Full / Debug) with the
 * "L#" marker as a small prefix, so the control is legible without hovering.
 * The current level and every marker stay whole. In a narrow tree pane the
 * other levels' names shorten with an ellipsis, and below the xl breakpoint
 * they show only their marker (the title and aria-label keep the name).
 * The current level is emphasized with the theme's primary (signal green);
 * every other marker keeps the muted text color, which holds 4.5:1 contrast.
 * Descriptions surface via title tooltips.
 */
export function TraceLevelSlider({
	levels,
	value,
	onChange,
	className,
}: TraceLevelSliderProps) {
	return (
		<div
			role="group"
			aria-label="Trace level"
			className={cx(
				"flex min-w-0 items-stretch overflow-hidden rounded-[var(--ds-radius-base)] border border-border",
				className,
			)}
		>
			{levels.map((level, idx) => {
				const isCurrent = idx === value;
				return (
					<button
						key={level.marker}
						type="button"
						onClick={() => onChange(idx)}
						aria-pressed={isCurrent}
						aria-label={`${level.marker} — ${level.name}: ${level.description}`}
						title={`${level.marker} · ${level.name} — ${level.description}`}
						className={cx(
							"flex items-center gap-1 px-2 py-1.5 text-[length:var(--ds-font-size-ui-2xs)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
							idx > 0 && "border-l border-border",
							// The current level keeps its whole name; the others give up width first.
							isCurrent ? "shrink-0" : "min-w-0",
							isCurrent
								? "bg-status-success-fill text-status-success"
								: "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
						)}
					>
						<span
							aria-hidden="true"
							className={cx(
								"shrink-0 text-[length:var(--ds-font-size-micro)] font-bold uppercase tabular-nums tracking-[var(--ds-letter-spacing-micro)]",
								isCurrent ? "text-status-success" : "text-muted-foreground",
							)}
						>
							{level.marker}
						</span>
						<span className={cx("truncate", isCurrent ? "font-semibold" : "max-xl:hidden")}>{level.name}</span>
					</button>
				);
			})}
		</div>
	);
}
