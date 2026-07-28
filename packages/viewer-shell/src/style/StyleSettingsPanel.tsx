import { useMemo, useState, type ReactNode } from "react";

import {
	buildColorExport,
	colorTokenDefaultHex,
	colorTokenEffectiveHex,
	COLOR_TOKENS,
	DEFAULT_GRAIN_SETTINGS,
	DEFAULT_LAYOUT_STYLE_SETTINGS,
	GRAIN_BLEND_OPTIONS,
	normalizeHex,
	SOFTENING_CHANNEL_OPTIONS,
	STYLE_PANEL_TAB_OPTIONS,
	THEME_OPTIONS,
	TRACE_ICON_SIDE_OPTIONS,
	TRACE_ICON_STYLE_OPTIONS,
	type ColorTokenDescriptor,
	type ColorTokenGroup,
	type GrainBlendMode,
	type StyleSettings,
	type StyleSettingsPatch,
	type StylePanelTab,
	type ThemeMode,
	type TraceIconSide,
	type TraceIconStyle
} from "./style-settings";

type StyleSettingsPanelProps = {
	settings: StyleSettings;
	onChange: (updates: StyleSettingsPatch) => void;
	/** Visible tabs (app config); omit for all. */
	sections?: readonly StylePanelTab[];
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

function TabBar({
	active,
	options,
	onSelect
}: {
	active: StylePanelTab;
	options: ReadonlyArray<{ id: StylePanelTab; label: string }>;
	onSelect: (tab: StylePanelTab) => void;
}) {
	return (
		<div
			className="grid gap-1 border border-border bg-background/40 p-1"
			style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
			role="tablist"
		>
			{options.map((option) => {
				const isActive = option.id === active;
				return (
					<button
						aria-selected={isActive}
						className={`min-h-7 border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] transition-colors ${
							isActive
								? "border-status-info-border bg-muted text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground"
						}`}
						key={option.id}
						onClick={() => onSelect(option.id)}
						role="tab"
						type="button"
					>
						{option.label}
					</button>
				);
			})}
		</div>
	);
}

// ── Color pickers ──────────────────────────────────────────────────────────

const COLOR_GROUP_TITLES: Record<ColorTokenGroup, string> = {
	neutrals: "Neutrals",
	editor: "Editor",
	accents: "Accents",
	tree: "Tree Chrome",
	selection: "Selection",
	code: "Code Block"
};

function ColorTokenRow({
	token,
	overrides,
	theme,
	onChange
}: {
	token: ColorTokenDescriptor;
	overrides: StyleSettings["colorOverrides"];
	theme: ThemeMode;
	onChange: (updates: StyleSettingsPatch) => void;
}) {
	const effective = colorTokenEffectiveHex(token, overrides, theme);
	const hasOverride = Boolean(overrides[token.id]);
	const [draft, setDraft] = useState(effective);
	const [locked, setLocked] = useState(Boolean(token.reserved));

	// Keep the text field in sync when the effective value changes elsewhere
	// (swatch edit, reset) — but let the user keep typing an invalid draft.
	const [syncedFrom, setSyncedFrom] = useState(effective);
	if (syncedFrom !== effective && draft !== effective) {
		setSyncedFrom(effective);
		setDraft(effective);
	}

	const disabled = Boolean(token.reserved) && locked;

	function commit(hex: string) {
		const normalized = normalizeHex(hex);
		if (!normalized) return;
		onChange({ colorOverrides: { [token.id]: normalized } });
	}

	function reset() {
		onChange({ colorOverrides: { [token.id]: "" } });
		setDraft(colorTokenDefaultHex(token, theme));
		setSyncedFrom(colorTokenDefaultHex(token, theme));
	}

	const draftValid = normalizeHex(draft) !== null;

	return (
		<div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-t border-border/60 py-1.5 first:border-t-0">
			<div className="flex items-center gap-2">
				<span
					aria-hidden
					className="h-6 w-6 shrink-0 border border-border"
					style={{ backgroundColor: effective }}
				/>
				<input
					aria-label={`${token.label} swatch`}
					className="h-6 w-6 shrink-0 cursor-pointer border border-border bg-transparent p-0 disabled:cursor-not-allowed disabled:opacity-40"
					disabled={disabled}
					onChange={(event) => commit(event.currentTarget.value)}
					type="color"
					value={effective}
				/>
			</div>
			<div className="min-w-0">
				<div className="flex items-center gap-1.5">
					<span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
						{token.label}
					</span>
					{token.reserved && (
						<span className="shrink-0 text-[9px] uppercase tracking-[0.08em] text-status-warning">
							{token.reservedNote ?? "reserved"}
						</span>
					)}
				</div>
				<input
					aria-label={`${token.label} hex`}
					className={`mt-1 min-h-7 w-full border bg-muted px-2 py-1 font-mono text-[12px] normal-case tracking-normal text-foreground outline-none transition-colors focus:border-status-info-border disabled:opacity-40 ${
						draftValid ? "border-border" : "border-destructive"
					}`}
					disabled={disabled}
					onBlur={() => {
						if (draftValid) commit(draft);
						else setDraft(effective);
					}}
					onChange={(event) => setDraft(event.currentTarget.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && draftValid) commit(draft);
					}}
					spellCheck={false}
					type="text"
					value={draft}
				/>
			</div>
			<div className="flex shrink-0 items-center gap-1">
				{token.reserved && (
					<button
						aria-label={locked ? `Unlock ${token.label}` : `Lock ${token.label}`}
						className="grid h-6 w-6 place-items-center border border-border bg-card text-[11px] text-muted-foreground transition-colors hover:border-status-info-border hover:text-foreground"
						onClick={() => setLocked((value) => !value)}
						title={locked ? "Unlock to edit (diagnostics color)" : "Lock"}
						type="button"
					>
						<span aria-hidden>{locked ? "\u{1F512}" : "\u{1F513}"}</span>
					</button>
				)}
				<button
					aria-label={`Reset ${token.label}`}
					className="grid h-6 w-6 place-items-center border border-border bg-card text-[13px] text-muted-foreground transition-colors hover:border-status-info-border hover:text-foreground disabled:opacity-30"
					disabled={!hasOverride}
					onClick={reset}
					title="Reset to default"
					type="button"
				>
					<span aria-hidden>{"↺"}</span>
				</button>
			</div>
		</div>
	);
}

function ColorsTab({
	settings,
	onChange
}: {
	settings: StyleSettings;
	onChange: (updates: StyleSettingsPatch) => void;
}) {
	const [copied, setCopied] = useState(false);
	const overrides = settings.colorOverrides;
	const groups = useMemo(() => {
		const order: ColorTokenGroup[] = ["neutrals", "editor", "accents", "tree", "selection", "code"];
		return order.map((group) => ({
			group,
			tokens: COLOR_TOKENS.filter((token) => token.group === group)
		}));
	}, []);

	async function copyExport() {
		const block = buildColorExport(
			overrides,
			settings.theme,
			settings.treeChrome,
			settings.selection,
			settings.codeBlock
		);
		try {
			await navigator.clipboard.writeText(block);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1600);
		} catch {
			// Clipboard may be unavailable (insecure context); fail quietly.
			setCopied(false);
		}
	}

	return (
		<div className="grid content-start gap-3">
			<PanelSection>
				<PanelTitle>Theme</PanelTitle>
				<div className="grid grid-cols-2 gap-2">
					{THEME_OPTIONS.map((option) => {
						const active = settings.theme === option.id;
						return (
							<button
								key={option.id}
								aria-pressed={active}
								className={`min-h-8 border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] transition-colors ${
									active
										? "border-status-info-border bg-status-info-fill text-foreground"
										: "border-border bg-muted text-muted-foreground hover:border-status-info-border hover:text-foreground"
								}`}
								onClick={() => onChange({ theme: option.id })}
								type="button"
							>
								{option.label}
							</button>
						);
					})}
				</div>
				<p className="mt-2 text-[10px] leading-snug text-muted-foreground">
					Light follows the design-doc palette; dark is the instrument calibration.
				</p>
			</PanelSection>

			{groups.map(({ group, tokens }) => (
				<PanelSection key={group}>
					<PanelTitle>{COLOR_GROUP_TITLES[group]}</PanelTitle>
					<div className="grid">
						{tokens.map((token) => (
							<ColorTokenRow
								key={`${settings.theme}:${token.id}`}
								onChange={onChange}
								overrides={overrides}
								theme={settings.theme}
								token={token}
							/>
						))}
					</div>
				</PanelSection>
			))}

			<PanelSection>
				<PanelTitle>Tree Strength</PanelTitle>
				<div className="grid gap-3">
					<StyleSlider
						label="Band Wash"
						min={0}
						max={0.25}
						step={0.01}
						value={settings.treeChrome.bandWashOpacity}
						valueLabel={percentLabel(settings.treeChrome.bandWashOpacity)}
						onChange={(value) => onChange({ treeChrome: { bandWashOpacity: value } })}
					/>
					<StyleSlider
						label="Band Border"
						min={0.1}
						max={1}
						step={0.05}
						value={settings.treeChrome.bandBorderOpacity}
						valueLabel={percentLabel(settings.treeChrome.bandBorderOpacity)}
						onChange={(value) => onChange({ treeChrome: { bandBorderOpacity: value } })}
					/>
					<StyleSlider
						label="Caret Opacity"
						min={0.2}
						max={1}
						step={0.05}
						value={settings.treeChrome.caretOpacity}
						valueLabel={percentLabel(settings.treeChrome.caretOpacity)}
						onChange={(value) => onChange({ treeChrome: { caretOpacity: value } })}
					/>
					<StyleSlider
						label="Connector Opacity"
						min={0}
						max={1}
						step={0.05}
						value={settings.treeChrome.connectorOpacity}
						valueLabel={percentLabel(settings.treeChrome.connectorOpacity)}
						onChange={(value) => onChange({ treeChrome: { connectorOpacity: value } })}
					/>
				</div>
			</PanelSection>

			<PanelSection>
				<PanelTitle>Selection Strength</PanelTitle>
				<div className="grid gap-3">
					<StyleSlider
						label="Ring Opacity"
						min={0.2}
						max={1}
						step={0.05}
						value={settings.selection.opacity}
						valueLabel={percentLabel(settings.selection.opacity)}
						onChange={(value) => onChange({ selection: { opacity: value } })}
					/>
					<StyleSlider
						label="Ring Width"
						min={1}
						max={4}
						step={1}
						value={settings.selection.ringWidth}
						valueLabel={pxLabel(settings.selection.ringWidth)}
						onChange={(value) => onChange({ selection: { ringWidth: value } })}
					/>
					<StyleSlider
						label="Bar Width"
						min={0}
						max={6}
						step={1}
						value={settings.selection.barWidth}
						valueLabel={pxLabel(settings.selection.barWidth)}
						onChange={(value) => onChange({ selection: { barWidth: value } })}
					/>
				</div>
			</PanelSection>

			<PanelSection>
				<PanelTitle>Code Block</PanelTitle>
				<div className="grid gap-3">
					<StyleSlider
						label="Zebra Opacity"
						min={0}
						max={0.15}
						step={0.01}
						value={settings.codeBlock.zebraOpacity}
						valueLabel={
							settings.codeBlock.zebraOpacity === 0
								? "off"
								: percentLabel(settings.codeBlock.zebraOpacity)
						}
						onChange={(value) => onChange({ codeBlock: { zebraOpacity: value } })}
					/>
				</div>
			</PanelSection>

			<PanelSection>
				<PanelTitle>Export</PanelTitle>
				<div className="grid gap-2">
					<button
						className="min-h-8 border border-border bg-muted px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:border-status-info-border hover:text-foreground"
						onClick={copyExport}
						type="button"
					>
						{copied ? "Copied ✓" : "Copy CSS"}
					</button>
					<button
						className="min-h-8 border border-border bg-muted px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:border-destructive hover:text-foreground"
						onClick={() => onChange({ colorOverrides: null })}
						type="button"
					>
						Reset all colors
					</button>
				</div>
			</PanelSection>
		</div>
	);
}

// ── Trace tab ────────────────────────────────────────────────────────────────

function TraceTab({
	settings,
	onChange
}: {
	settings: StyleSettings;
	onChange: (updates: StyleSettingsPatch) => void;
}) {
	return (
		<div className="grid content-start gap-3">
			<PanelSection>
				<PanelTitle>Trace Icons</PanelTitle>
				<div className="grid gap-4">
					<label className="block text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
						<span>Icon side</span>
						<select
							className="mt-1.5 min-h-8 w-full border border-border bg-muted px-2 py-1 text-[13px] normal-case tracking-normal text-foreground outline-none transition-colors focus:border-status-info-border"
							onChange={(event) => onChange({ traceIcons: { side: event.currentTarget.value as TraceIconSide } })}
							value={settings.traceIcons.side}
						>
							{TRACE_ICON_SIDE_OPTIONS.map((option) => (
								<option key={option.id} value={option.id}>
									{option.label}
								</option>
							))}
						</select>
					</label>
					<label className="block text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
						<span>Icon style</span>
						<select
							className="mt-1.5 min-h-8 w-full border border-border bg-muted px-2 py-1 text-[13px] normal-case tracking-normal text-foreground outline-none transition-colors focus:border-status-info-border"
							onChange={(event) => onChange({ traceIcons: { style: event.currentTarget.value as TraceIconStyle } })}
							value={settings.traceIcons.style}
						>
							{TRACE_ICON_STYLE_OPTIONS.map((option) => (
								<option key={option.id} value={option.id}>
									{option.label}
								</option>
							))}
						</select>
					</label>
				</div>
			</PanelSection>
		</div>
	);
}

// ── Layout tab ────────────────────────────────────────────────────────────────

function LayoutTab({
	settings,
	onChange
}: {
	settings: StyleSettings;
	onChange: (updates: StyleSettingsPatch) => void;
}) {
	return (
		<div className="grid content-start gap-3">
			<PanelSection>
				<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
					<PanelTitle className="mb-0 min-w-0 flex-1">Surface</PanelTitle>
					<button
						className="min-h-7 border border-border bg-muted px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:border-status-info-border hover:text-foreground"
						onClick={() => onChange({ layout: DEFAULT_LAYOUT_STYLE_SETTINGS })}
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
		</div>
	);
}

// ── Effects tab ──────────────────────────────────────────────────────────────

function EffectsTab({
	settings,
	onChange
}: {
	settings: StyleSettings;
	onChange: (updates: StyleSettingsPatch) => void;
}) {
	const grain = settings.grain;

	return (
		<div className="grid content-start gap-3">
			<PanelSection>
				<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
					<PanelTitle className="mb-0 min-w-0 flex-1">Global Grain</PanelTitle>
					<button
						className="min-h-7 border border-border bg-muted px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:border-status-info-border hover:text-foreground"
						onClick={() => onChange({ grain: DEFAULT_GRAIN_SETTINGS })}
						type="button"
					>
						Reset
					</button>
				</div>
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
		</div>
	);
}

export function StyleSettingsPanel({ settings, onChange, sections }: StyleSettingsPanelProps) {
	// App config can hide tabs; a persisted activeTab outside the visible set
	// falls back to the first visible tab instead of rendering nothing.
	const visibleOptions = sections
		? STYLE_PANEL_TAB_OPTIONS.filter((option) => sections.includes(option.id))
		: STYLE_PANEL_TAB_OPTIONS;
	const activeTab = visibleOptions.some((option) => option.id === settings.activeTab)
		? settings.activeTab
		: (visibleOptions[0]?.id ?? settings.activeTab);

	return (
		<div className="grid content-start gap-3">
			<TabBar active={activeTab} options={visibleOptions} onSelect={(tab) => onChange({ activeTab: tab })} />
			{activeTab === "colors" && <ColorsTab onChange={onChange} settings={settings} />}
			{activeTab === "effects" && <EffectsTab onChange={onChange} settings={settings} />}
			{activeTab === "trace" && <TraceTab onChange={onChange} settings={settings} />}
			{activeTab === "layout" && <LayoutTab onChange={onChange} settings={settings} />}
		</div>
	);
}
