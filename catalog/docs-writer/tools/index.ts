/**
 * Section ④ wiring only — the tool implementations live in ./runtime.ts.
 * Self-contained: no app runtime required (host: "any").
 */

import { defineTools } from "@agent-kernel/kernel/agent-definition";

import { registerDocsTools } from "./runtime";

export const tools = defineTools((pi) => {
	registerDocsTools(pi);
});

export default tools;
