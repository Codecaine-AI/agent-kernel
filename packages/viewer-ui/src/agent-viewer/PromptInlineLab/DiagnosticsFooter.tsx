// The bottom diagnostics footer: save errors + validation diagnostics as bordered rows.

import cn from "classnames";
import type { PromptDiagnostic } from "@codecaine-ai/prompt-kit";

export function DiagnosticsFooter({
	diagnostics,
	saveErrors,
}: {
	diagnostics: PromptDiagnostic[];
	saveErrors: string[];
}) {
	if (diagnostics.length === 0 && saveErrors.length === 0) return null;
	return (
		<footer className="max-h-24 shrink-0 overflow-auto border-t border-border bg-background/80">
			{saveErrors.map((message, index) => (
				<DiagnosticRow
					key={`save:${index}`}
					code="save"
					message={message}
					severity="error"
					bordered={index > 0}
				/>
			))}
			{diagnostics.map((diagnostic, index) => (
				<DiagnosticRow
					key={`${diagnostic.code}:${index}`}
					code={diagnostic.code}
					message={diagnostic.message}
					severity={diagnostic.severity === "error" ? "error" : "warning"}
					bordered={index > 0 || saveErrors.length > 0}
				/>
			))}
		</footer>
	);
}

function DiagnosticRow({
	code,
	message,
	severity,
	bordered,
}: {
	code: string;
	message: string;
	severity: "error" | "warning";
	bordered: boolean;
}) {
	return (
		<div
			className={cn(
				"flex items-start gap-2 px-3 py-1.5 text-[11px]",
				bordered && "border-t border-border/60",
				severity === "error" ? "text-destructive" : "text-status-warning",
			)}
		>
			<span className="mt-1 h-px w-3 shrink-0 bg-current opacity-60" />
			<span className="min-w-0 flex-1">
				<span className="font-medium uppercase tracking-[0.1em]">{code}</span>
				<span className="mx-1 text-muted-foreground/60">/</span>
				{message}
			</span>
		</div>
	);
}
