/**
 * GateBody — the detail body for a kernel.gate span (gate_start paired with
 * gate_end): the verdict pill, then one row per check with its result, value
 * or reason, and the probability of each decide question against its pass and
 * fail lines; the planned checks are the input. The step and decision rows a
 * gate holds sit under it in the tree and open their own bodies.
 */
import type { DetailBlockSpec, DetailView } from "../../../contract";
import { CLAMP } from "../../../doc-figure/clamp";
import type { RendererProps } from "../../../types";
import { jsonDocument } from "../../json-document";
import { CheckRow } from "./_components/CheckRow";
import { ResultPill } from "./_components/ResultPill";
import { gateChecks, gateMetaLine, gateVerdictLabel, pillTone } from "./utils";

export type GateBodyProps = RendererProps;

export function GateBody({ span }: GateBodyProps): DetailView {
	const checks = gateChecks(span);
	const verdict = gateVerdictLabel(span);
	const blocks: DetailBlockSpec[] = [];

	if (span.input?.trim()) {
		const planned = jsonDocument(span.input);
		blocks.push({
			id: "gate-planned",
			slot: "input",
			order: 10,
			caption: "Planned checks",
			body: planned.body,
			language: planned.language,
			clamp: CLAMP.block,
		});
	}

	blocks.push({
		id: "gate-checks",
		slot: "content",
		order: 0,
		caption: "Checks",
		expandable: false,
		node: (
			<div className="min-w-0 space-y-3">
				<div className="flex min-w-0 items-center gap-2">
					<ResultPill kind="verdict" label={verdict} tone={pillTone(verdict)} />
					<span className="min-w-0 truncate text-[length:var(--ds-font-size-ui-xs)] text-muted-foreground">
						{gateMetaLine(span, checks.length)}
					</span>
				</div>
				{checks.length > 0 ? (
					<ul className="min-w-0 space-y-3">
						{checks.map((check) => (
							<CheckRow key={check.name} check={check} />
						))}
					</ul>
				) : (
					<p className="text-[length:var(--ds-font-size-ui-xs)] text-muted-foreground">
						The gate recorded no checks.
					</p>
				)}
			</div>
		),
	});

	return { blocks };
}
