/** Kernel context adapter. Canonical rendering is shared with the external Docs integration. */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineContext } from "@agent-kernel/kernel/agent-definition";
import type { AgentContextResolver, LoadedMap } from "@agent-kernel/kernel/context";
import { AUTHORING_BUNDLES, assembleAuthoringGuidance, guidanceBundleFile } from "@codecaine-ai/docs-model/authoring-guidance";
export { STANDARDS_BUNDLES, STYLE_GUIDE_BUNDLES } from "@codecaine-ai/docs-model/authoring-guidance";

/**
 * Anchor paths to this bundle so host:"any" evaluation works under Node and
 * from any process working directory.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const KERNEL_ROOT = resolve(HERE, "..", "..", "..");
const CORE_ROOT = resolve(KERNEL_ROOT, "..");
const DOCS_ROOT = join(CORE_ROOT, "docs-system", "docs");


const loaders: AgentContextResolver["loaders"] = AUTHORING_BUNDLES.map(bundle => ({
  kind: "file" as const,
  path: guidanceBundleFile(DOCS_ROOT, bundle),
}));

function assemble(loaded: LoadedMap): string {
  return assembleAuthoringGuidance(DOCS_ROOT, loaded.map(input => ({
    path: typeof input.decl === "object" && "path" in input.decl ? String(input.decl.path) : "",
    status: input.status,
    content: input.content,
  })));
}

export const context = defineContext({ loaders, assemble });
export default context;
