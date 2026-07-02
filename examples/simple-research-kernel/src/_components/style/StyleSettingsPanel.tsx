import type { ReactNode } from "react";

import {
	DEFAULT_RESEARCH_STYLE_SETTINGS,
	GRAIN_BLEND_OPTIONS,
	SOFTENING_CHANNEL_OPTIONS,
	type GrainBlendMode,
	type ResearchStyleSettings,
	type ResearchStyleSettingsPatch
} from "../../lib/style-settings";

type StyleSettingsPanelProps = {
	settings: ResearchStyleSettings;
	onChange: (updates: ResearchStyleSettingsPatch) => void;
};

function percentLabel(value: number): string {
	return `${Math.round(value * 100)}%`;
}

function degreeLabel(value: number): string {
	return `${Math.round(value)}deg`;
}

function pxLabel(value: number): string {
	return `${value.toFixed(1)}px`;
}

function PanelSection({ children }: { children: ReactNode }) {
	return <section className="border border-border bg-background/30 p-3.5">{children}</section>;
}

function PanelTitle({ children, className = "mb-3" }: { children: ReactNode; className?: string }) {
	return (
		<div className={`style-panel-heading text-[11px] font-bold uppercase tracking-[0.14em] text-foreground ${className}`}>
			{children}
		</div>
	);
}

function StyleSlider({
	label,
	max,
	min,
	onChange,
	step,
	value,
	valueLabel
}: {
	label: string;
	max: number;
	min: number;
	onChange: (value: number) => void;
	step: number;
	value: number;
	valueLabel: string;
}) {
	return (
		<label className="block text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
			<span className="flex items-center justify-between gap-3">
				<span>{label}</span>
				<span className="text-[11px] normal-case tracking-normal text-foreground/80">{valueLabel}</span>
			</span>
			<input
				className="style-range mt-2"
				max={max}
				min={min}
				onChange={(event) => onChange(Number(event.currentTarget.value))}
				step={step}
				type="range"
				value={value}
			/>
		</label>
	);
}

function CheckboxField({
	checked,
	label,
	onChange
}: {
	checked: boolean;
	label: string;
	onChange: (checked: boolean) => void;
}) {
	return (
		<label className="mt-2 flex items-center gap-2.5 text-xs text-muted-foreground">
			<input
				checked={checked}
				className="h-4 min-h-4 w-4 accent-accent"
				onChange={(event) => onChange(event.currentTarget.checked)}
				type="checkbox"
			/>
			<span>{label}</span>
		</label>
	);
}

function ReadoutRow({ label, tone = "text-foreground/80", value }: { label: string; tone?: string; value: ReactNode }) {
	return (
		<div className="grid min-h-8 grid-cols-[112px_minmax(0,1fr)] items-center gap-2 border-t border-border px-2.5 py-1.5 first:border-t-0">
			<span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{label}</span>
			<span className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${tone}`}>{value}</span>
		</div>
	);
}

export function StyleSettingsPanel({ settings, onChange }: StyleSettingsPanelProps) {
	const grain = settings.grain;

	return (
		<div className="grid content-start gap-3">
			<PanelSection>
				<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
					<PanelTitle className="mb-0 min-w-0 flex-1">Surface</PanelTitle>
					<button
						className="min-h-7 border border-border bg-muted px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:border-status-info-border hover:text-foreground"
						onClick={() => onChange(DEFAULT_RESEARCH_STYLE_SETTINGS)}
						type="button"
					>
						Reset
					</button>
				</div>
				<div className="grid gap-4">
					<StyleSlider
						label="Frame"
						max={28}
						min={8}
						onChange={(framePadding) => onChange({ layout: { framePadding } })}
						step={1}
						value={settings.layout.framePadding}
						valueLabel={pxLabel(settings.layout.framePadding)}
					/>
					<StyleSlider
						label="Height"
						max={820}
						min={560}
						onChange={(workspaceMinHeight) => onChange({ layout: { workspaceMinHeight } })}
						step={10}
						value={settings.layout.workspaceMinHeight}
						valueLabel={`${Math.round(settings.layout.workspaceMinHeight)}px`}
					/>
					<StyleSlider
						label="Header"
						max={88}
						min={56}
						onChange={(headerHeight) => onChange({ layout: { headerHeight } })}
						step={2}
						value={settings.layout.headerHeight}
						valueLabel={pxLabel(settings.layout.headerHeight)}
					/>
				</div>
			</PanelSection>

			<PanelSection>
				<PanelTitle>Global Grain</PanelTitle>
				<CheckboxField
					checked={grain.enabled}
					label="Enable grain"
					onChange={(enabled) => onChange({ grain: { enabled } })}
				/>
				<div className="mt-4 grid gap-4">
					<StyleSlider
						label="Intensity"
						max={0.24}
						min={0}
						onChange={(opacity) => onChange({ grain: { opacity } })}
						step={0.01}
						value={grain.opacity}
						valueLabel={percentLabel(grain.opacity)}
					/>
					<StyleSlider
						label="Density"
						max={1.6}
						min={0.25}
						onChange={(frequency) => onChange({ grain: { frequency } })}
						step={0.05}
						value={grain.frequency}
						valueLabel={grain.frequency.toFixed(2)}
					/>
					<StyleSlider
						label="Contrast"
						max={2.2}
						min={0.55}
						onChange={(contrast) => onChange({ grain: { contrast } })}
						step={0.05}
						value={grain.contrast}
						valueLabel={`${grain.contrast.toFixed(2)}x`}
					/>
					<label className="block text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
						<span>Blend</span>
						<select
							className="mt-1.5 min-h-8 w-full border border-border bg-muted px-2 py-1 text-[13px] normal-case tracking-normal text-foreground outline-none transition-colors focus:border-status-info-border"
							onChange={(event) => onChange({ grain: { blendMode: event.currentTarget.value as GrainBlendMode } })}
							value={grain.blendMode}
						>
							{GRAIN_BLEND_OPTIONS.map((option) => (
								<option key={option.id} value={option.id}>
									{option.label}
								</option>
							))}
						</select>
					</label>
				</div>
			</PanelSection>

			<PanelSection>
				<PanelTitle>Softening Mix</PanelTitle>
				<div className="grid gap-4">
					{SOFTENING_CHANNEL_OPTIONS.map((option) => (
						<StyleSlider
							key={option.id}
							label={option.label}
							max={1}
							min={0}
							onChange={(value) => onChange({ grain: { softening: { [option.id]: value } } })}
							step={0.01}
							value={grain.softening[option.id]}
							valueLabel={percentLabel(grain.softening[option.id])}
						/>
					))}
				</div>
			</PanelSection>

			<PanelSection>
				<PanelTitle>SVG Normal</PanelTitle>
				<CheckboxField
					checked={grain.svgNormal.enabled}
					label="Enable SVG normal"
					onChange={(enabled) => onChange({ grain: { svgNormal: { enabled } } })}
				/>
				<div className="mt-4 grid gap-4">
					<StyleSlider
						label="Opacity"
						max={0.2}
						min={0}
						onChange={(opacity) => onChange({ grain: { svgNormal: { opacity } } })}
						step={0.01}
						value={grain.svgNormal.opacity}
						valueLabel={percentLabel(grain.svgNormal.opacity)}
					/>
					<StyleSlider
						label="Texture"
						max={1.8}
						min={0.12}
						onChange={(frequency) => onChange({ grain: { svgNormal: { frequency } } })}
						step={0.02}
						value={grain.svgNormal.frequency}
						valueLabel={grain.svgNormal.frequency.toFixed(2)}
					/>
					<StyleSlider
						label="Depth"
						max={8}
						min={0}
						onChange={(depth) => onChange({ grain: { svgNormal: { depth } } })}
						step={0.1}
						value={grain.svgNormal.depth}
						valueLabel={grain.svgNormal.depth.toFixed(1)}
					/>
					<StyleSlider
						label="Light Angle"
						max={360}
						min={0}
						onChange={(azimuth) => onChange({ grain: { svgNormal: { azimuth } } })}
						step={1}
						value={grain.svgNormal.azimuth}
						valueLabel={degreeLabel(grain.svgNormal.azimuth)}
					/>
					<StyleSlider
						label="Light Height"
						max={90}
						min={5}
						onChange={(elevation) => onChange({ grain: { svgNormal: { elevation } } })}
						step={1}
						value={grain.svgNormal.elevation}
						valueLabel={degreeLabel(grain.svgNormal.elevation)}
					/>
				</div>
			</PanelSection>

			<PanelSection>
				<PanelTitle>CSS Bevel</PanelTitle>
				<CheckboxField
					checked={grain.cssBevel.enabled}
					label="Enable CSS bevel"
					onChange={(enabled) => onChange({ grain: { cssBevel: { enabled } } })}
				/>
				<div className="mt-4 grid gap-4">
					<StyleSlider
						label="Strength"
						max={1}
						min={0}
						onChange={(strength) => onChange({ grain: { cssBevel: { strength } } })}
						step={0.01}
						value={grain.cssBevel.strength}
						valueLabel={percentLabel(grain.cssBevel.strength)}
					/>
					<StyleSlider
						label="Depth"
						max={4}
						min={0}
						onChange={(depth) => onChange({ grain: { cssBevel: { depth } } })}
						step={0.1}
						value={grain.cssBevel.depth}
						valueLabel={pxLabel(grain.cssBevel.depth)}
					/>
					<StyleSlider
						label="Highlight"
						max={1}
						min={0}
						onChange={(highlight) => onChange({ grain: { cssBevel: { highlight } } })}
						step={0.01}
						value={grain.cssBevel.highlight}
						valueLabel={percentLabel(grain.cssBevel.highlight)}
					/>
					<StyleSlider
						label="Shadow"
						max={1}
						min={0}
						onChange={(shadow) => onChange({ grain: { cssBevel: { shadow } } })}
						step={0.01}
						value={grain.cssBevel.shadow}
						valueLabel={percentLabel(grain.cssBevel.shadow)}
					/>
					<StyleSlider
						label="Text"
						max={1}
						min={0}
						onChange={(text) => onChange({ grain: { cssBevel: { text } } })}
						step={0.01}
						value={grain.cssBevel.text}
						valueLabel={percentLabel(grain.cssBevel.text)}
					/>
				</div>
			</PanelSection>

			<PanelSection>
				<PanelTitle>Readout</PanelTitle>
				<div className="overflow-hidden border border-border bg-card/70">
					<ReadoutRow label="Frame" value={pxLabel(settings.layout.framePadding)} />
					<ReadoutRow label="Height" value={`${Math.round(settings.layout.workspaceMinHeight)}px`} />
					<ReadoutRow label="Header" value={pxLabel(settings.layout.headerHeight)} />
					<ReadoutRow label="State" tone={grain.enabled ? "text-status-success" : "text-muted-foreground"} value={grain.enabled ? "enabled" : "off"} />
					<ReadoutRow label="Intensity" value={percentLabel(grain.opacity)} />
					<ReadoutRow label="Density" value={grain.frequency.toFixed(2)} />
					<ReadoutRow label="Contrast" value={`${grain.contrast.toFixed(2)}x`} />
					<ReadoutRow label="Blend" value={GRAIN_BLEND_OPTIONS.find((option) => option.id === grain.blendMode)?.label ?? grain.blendMode} />
					<ReadoutRow label="Background" value={percentLabel(grain.softening.background)} />
					<ReadoutRow label="Font" value={percentLabel(grain.softening.font)} />
					<ReadoutRow label="Borders" value={percentLabel(grain.softening.borders)} />
					<ReadoutRow label="Icons" value={percentLabel(grain.softening.icons)} />
					<ReadoutRow label="SVG Normal" tone={grain.svgNormal.enabled ? "text-status-success" : "text-muted-foreground"} value={grain.svgNormal.enabled ? "enabled" : "off"} />
					<ReadoutRow label="CSS Bevel" tone={grain.cssBevel.enabled ? "text-status-success" : "text-muted-foreground"} value={grain.cssBevel.enabled ? "enabled" : "off"} />
				</div>
			</PanelSection>
		</div>
	);
}
