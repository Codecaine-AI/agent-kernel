// Sidebar AGENT zone: read-only name + editable model (datalist aliases) +
// editable description, with an inline apply/save disabled until dirty.

import cn from "classnames";
import { useId } from "react";
import { Check } from "lucide-react";

export interface AgentZoneProps {
	name: string;
	model: string;
	description: string;
	modelAliases: string[];
	dirty: boolean;
	saving: boolean;
	canSave: boolean;
	onModelChange: (model: string) => void;
	onDescriptionChange: (description: string) => void;
	onSave: () => void;
	error?: string;
}

export function AgentZone({
	name,
	model,
	description,
	modelAliases,
	dirty,
	saving,
	canSave,
	onModelChange,
	onDescriptionChange,
	onSave,
	error,
}: AgentZoneProps) {
	const datalistId = useId();
	return (
		<section className="shrink-0 border-b border-border bg-muted/10 px-3 py-2.5">
			<ZoneHeader label="Agent">
				<button
					type="button"
					onClick={onSave}
					disabled={!dirty || saving || !canSave}
					className={cn(
						"inline-flex h-6 items-center gap-1 rounded-[2px] border px-1.5 text-[10px] uppercase tracking-[0.1em] transition-colors",
						dirty && !saving && canSave
							? "border-status-success-border bg-status-success-fill/40 text-status-success hover:bg-status-success-fill/60"
							: "cursor-not-allowed border-border bg-background text-muted-foreground opacity-45",
					)}
					title={canSave ? "Apply manifest edits" : "Manifest edits are read-only"}
				>
					<Check size={11} />
					{saving ? "Saving…" : "Apply"}
				</button>
			</ZoneHeader>

			<div className="flex flex-col gap-2">
				<Field label="name">
					<div className="h-7 truncate rounded-[2px] border border-border bg-background/60 px-2 text-[12px] leading-7 text-foreground">
						{name}
					</div>
				</Field>

				<Field label="model">
					<input
						type="text"
						value={model}
						list={datalistId}
						onChange={(event) => onModelChange(event.target.value)}
						disabled={!canSave}
						spellCheck={false}
						className="h-7 w-full rounded-[2px] border border-border bg-background px-2 text-[12px] text-foreground outline-none transition-colors focus:border-status-success-border disabled:cursor-not-allowed disabled:opacity-60"
					/>
					{modelAliases.length > 0 && (
						<datalist id={datalistId}>
							{modelAliases.map((alias) => (
								<option key={alias} value={alias} />
							))}
						</datalist>
					)}
				</Field>

				<Field label="description">
					<textarea
						value={description}
						onChange={(event) => onDescriptionChange(event.target.value)}
						disabled={!canSave}
						rows={3}
						spellCheck={false}
						className="w-full resize-y rounded-[2px] border border-border bg-background px-2 py-1.5 text-[12px] leading-relaxed text-foreground outline-none transition-colors focus:border-status-success-border disabled:cursor-not-allowed disabled:opacity-60"
					/>
				</Field>

				{error && <p className="text-[11px] text-destructive">{error}</p>}
			</div>
		</section>
	);
}

function ZoneHeader({ label, children }: { label: string; children?: React.ReactNode }) {
	return (
		<div className="mb-2 flex items-center gap-2">
			<span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
				{label}
			</span>
			<span className="h-px flex-1 bg-border" />
			{children}
		</div>
	);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<label className="flex flex-col gap-1">
			<span className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground/70">
				{label}
			</span>
			{children}
		</label>
	);
}
