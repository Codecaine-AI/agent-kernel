// Read-only CONTEXT surface: renders the assembled context preview onto the
// same editor visual language (editor bg + gutter + mono line rows). No fake
// editability — a simple read-only line rendering that mirrors the XML surface.

import { estimateTokenCount } from "tokenx";

export interface LabContextPreview {
	renderedContext?: string | null;
	inputs?: Array<{ loaderKind: string; inputRef: string; status: string; bytes: number }>;
	modulePath?: string | null;
}

export function ContextSurface({ context }: { context?: LabContextPreview }) {
	const rendered = context?.renderedContext ?? "";
	const hasContent = rendered.trim().length > 0;
	const lines = hasContent ? rendered.split("\n") : [];
	const tokens = estimateTokenCount(rendered);

	return (
		<div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background font-mono">
			<div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-muted/10 px-3">
				<span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
					Context (read-only)
				</span>
				<span className="ml-auto tabular-nums text-[10px] text-muted-foreground/70">
					{tokens.toLocaleString()}
					<span className="ml-1 text-[9px] uppercase tracking-[0.12em] text-muted-foreground/45">tok</span>
				</span>
			</div>

			{hasContent ? (
				<div className="min-h-0 flex-1 overflow-auto">
					<table className="w-full border-collapse">
						<tbody>
							{lines.map((line, index) => (
								<tr key={index} className="align-top">
									<td className="w-10 select-none border-r border-border/40 px-2 text-right text-[11px] leading-5 tabular-nums text-muted-foreground/40">
										{index + 1}
									</td>
									<td className="whitespace-pre-wrap break-words px-3 text-[12px] leading-5 text-foreground/90">
										{line || " "}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : (
				<div className="flex min-h-0 flex-1 items-center justify-center p-6">
					<p className="max-w-64 text-center text-[12px] leading-relaxed text-muted-foreground/70">
						{context?.modulePath
							? "No context captured for this agent yet — run it once to capture the assembled context."
							: "This agent has no context module."}
					</p>
				</div>
			)}
		</div>
	);
}
