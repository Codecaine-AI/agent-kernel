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
 * The current level is emphasized with the theme's primary (signal green);
 * levels below the current one keep a faint filled tick so the cumulative
 * "adds detail" semantics still read. Descriptions surface via title tooltips.
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
				"flex items-stretch overflow-hidden rounded-[3px] border border-border",
				className,
			)}
		>
			{levels.map((level, idx) => {
				const isCurrent = idx === value;
				const isIncluded = idx <= value;
				return (
					<button
						key={level.marker}
						type="button"
						onClick={() => onChange(idx)}
						aria-pressed={isCurrent}
						aria-label={`${level.marker} — ${level.name}: ${level.description}`}
						title={`${level.marker} · ${level.name} — ${level.description}`}
						className={cx(
							"flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
							idx > 0 && "border-l border-border",
							isCurrent
								? "bg-status-success-fill text-status-success"
								: "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
						)}
					>
						<span
							aria-hidden="true"
							className={cx(
								"text-[9px] font-bold uppercase tabular-nums tracking-[0.08em]",
								isCurrent
									? "text-status-success"
									: isIncluded
										? "text-muted-foreground"
										: "text-muted-foreground/70",
							)}
						>
							{level.marker}
						</span>
						<span className={cx(isCurrent && "font-semibold")}>{level.name}</span>
					</button>
				);
			})}
		</div>
	);
}
