/**
 * model-node-component-paths.test.ts — the model-node UI follows the design
 * system's vertical-slice layout (guide/code-structure.md). The viewer-ui
 * registry entry has folderStandard false, so DS structure lint does not
 * enforce it here; this test does, for every component this build added.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("./", import.meta.url));

/** Every component the model-node build added, relative to src/trace-viewer. */
const MODEL_NODE_COMPONENTS = [
	"SpanCard/_components/KindBadge/index.tsx",
	"SpanCard/_components/ResultChip/index.tsx",
	"SpanCard/_components/ModelNodeCard/index.tsx",
	"detail-panel/renderers/_components/CallBody/index.tsx",
	"detail-panel/renderers/_components/DecisionBody/index.tsx",
	"detail-panel/renderers/_components/StepBody/index.tsx",
	"detail-panel/renderers/_components/GateBody/index.tsx",
	"detail-panel/renderers/_components/DecisionBody/_components/ProbabilityBars/index.tsx",
	"detail-panel/renderers/_components/DecisionBody/_components/DecisionBadges/index.tsx",
	"detail-panel/renderers/_components/DecisionBody/_components/AbstainPanel/index.tsx",
	"detail-panel/renderers/_components/GateBody/_components/ResultPill/index.tsx",
	"detail-panel/renderers/_components/GateBody/_components/CheckRow/index.tsx",
	"detail-panel/renderers/_components/FieldTable/index.tsx",
] as const;

const COMPONENT_PATH = /_components\/([A-Z][A-Za-z0-9]*)\/index\.tsx$/;

/** The legacy component files that existed before this build; none may be added beside them. */
const LEGACY_VARIANTS = [
	"AgentCard.tsx",
	"AssistantMessageCard.tsx",
	"ContainerCard.tsx",
	"LifecycleCard.tsx",
	"MetaCard.tsx",
	"SpawnerCard.tsx",
	"SystemCard.tsx",
	"ToolCard.tsx",
	"UIAskCard.tsx",
	"UserMessageCard.tsx",
];
const LEGACY_RENDERERS = [
	"ContextBuildBody.tsx",
	"FactCard.tsx",
	"MessageBody.tsx",
	"ToolBody.tsx",
	"TurnBody.tsx",
	"UsageAggregateRenderer.tsx",
	"WarningRenderer.tsx",
	"snapshot-message-view.tsx",
];

function componentFiles(dir: string): string[] {
	return readdirSync(join(ROOT, dir))
		.filter((name) => name.endsWith(".tsx") && !name.includes(".test."))
		.sort();
}

function underscoreComponentDirs(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (!statSync(path).isDirectory()) return [];
		return [...(name === "_components" ? [path] : []), ...underscoreComponentDirs(path)];
	});
}

describe("model-node component paths", () => {
	test("every new component is `_components/<Name>/index.tsx`, exporting <Name> and <Name>Props", async () => {
		for (const path of MODEL_NODE_COMPONENTS) {
			const match = COMPONENT_PATH.exec(path);
			expect(match).not.toBeNull();
			const name = match![1]!;
			const file = join(ROOT, path);
			expect(existsSync(file)).toBe(true);

			const module = (await import(file)) as Record<string, unknown>;
			expect(typeof module[name]).toBe("function");
			expect(readFileSync(file, "utf8")).toContain(`export type ${name}Props`);
		}
	});

	test("no new component file sits under variants/ or directly under renderers/", () => {
		expect(componentFiles("SpanCard/variants")).toEqual(LEGACY_VARIANTS);
		expect(componentFiles("detail-panel/renderers")).toEqual(LEGACY_RENDERERS);
	});

	test("every `_components/` folder holds only PascalCase component folders, each with an index.tsx", () => {
		for (const dir of underscoreComponentDirs(ROOT)) {
			for (const entry of readdirSync(dir)) {
				expect(`${basename(dir)}/${entry}`).toMatch(/^_components\/[A-Z][A-Za-z0-9]*$/);
				expect(statSync(join(dir, entry)).isDirectory()).toBe(true);
				expect(existsSync(join(dir, entry, "index.tsx"))).toBe(true);
			}
		}
	});
});
