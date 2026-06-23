import { useId } from "react";

export interface TraceLevelInfo {
	/** Short marker rendered above the tick (e.g. "L2"). */
	marker: string;
	/** Human-friendly name shown in the tooltip (e.g. "Full"). */
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
 * Discrete level slider.
 *
 * Renders clickable "L#" markers above a notched track. Each marker shows a
 * tooltip on hover describing what its level reveals. A transparent native
 * range input is layered over the track so drag / click / keyboard all work,
 * while the visible thumb + ticks are positioned with the same formula so they
 * stay perfectly aligned at every discrete step.
 */
export function TraceLevelSlider({
	levels,
	value,
	onChange,
	className,
}: TraceLevelSliderProps) {
	const max = Math.max(levels.length - 1, 0);
	const inputId = useId();

	const positionFor = (idx: number) => (max === 0 ? 50 : (idx / max) * 100);

	return (
		<div className={cx("flex flex-col gap-1", className)}>
			{/* Level markers + hover tooltips */}
			<div className="relative h-3.5 w-48">
				{levels.map((level, idx) => {
					const isActive = idx <= value;
					const isCurrent = idx === value;
					// Keep tooltips inside the slider bounds at the edges.
					const tooltipAlign =
						idx === 0
							? "left-0"
							: idx === max
								? "right-0"
								: "left-1/2 -translate-x-1/2";
					return (
						<div
							key={level.marker}
							className="group absolute top-0 -translate-x-1/2"
							style={{ left: `${positionFor(idx)}%` }}
						>
							<button
								type="button"
								onClick={() => onChange(idx)}
								aria-label={`${level.marker} — ${level.name}: ${level.description}`}
								aria-pressed={isCurrent}
								className={cx(
									"flex h-3.5 items-center text-[10px] font-bold uppercase tabular-nums tracking-[0.14em] transition-colors hover:text-status-success",
									isCurrent
										? "text-status-success"
										: isActive
											? "text-muted-foreground"
											: "text-muted-foreground/45",
								)}
							>
								{level.marker}
							</button>
							<div
								role="tooltip"
								className={cx(
									"pointer-events-none absolute top-full z-40 mt-2 w-40 rounded-[3px] border border-border bg-card px-2.5 py-1.5 opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100",
									tooltipAlign,
								)}
							>
								<span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-status-success">
									{level.marker} · {level.name}
								</span>
								<span className="mt-0.5 block text-[10px] font-normal leading-snug text-muted-foreground">
									{level.description}
								</span>
							</div>
						</div>
					);
				})}
			</div>

			{/* Track + thumb */}
			<div className="relative h-3 w-48">
				<input
					id={inputId}
					type="range"
					min={0}
					max={max}
					step={1}
					value={value}
					onChange={(event) => onChange(Number(event.target.value))}
					className="peer absolute inset-0 z-20 m-0 w-full cursor-pointer opacity-0 focus-visible:outline-none"
					aria-label="Trace level"
					aria-valuetext={levels[value]?.name}
				/>
				{/* base track */}
				<div
					aria-hidden="true"
					className="absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-muted"
				/>
				{/* filled track */}
				<div
					aria-hidden="true"
					className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-status-success"
					style={{ width: `${positionFor(value)}%` }}
				/>
				{/* tick marks ("check marks") at each level */}
				{levels.map((level, idx) => (
					<div
						key={level.marker}
						aria-hidden="true"
						className={cx(
							"absolute top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2",
							idx <= value ? "bg-status-success" : "bg-border",
						)}
						style={{ left: `${positionFor(idx)}%` }}
					/>
				))}
				{/* thumb (purely visual; the invisible input drives interaction) */}
				<div
					aria-hidden="true"
					className="pointer-events-none absolute top-1/2 z-10 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-status-success ring-2 ring-status-success/30 peer-focus-visible:ring-4 peer-focus-visible:ring-status-success/50"
					style={{ left: `${positionFor(value)}%` }}
				/>
			</div>
		</div>
	);
}
