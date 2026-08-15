#!/usr/bin/env bun
/**
 * dry-boot.ts — headless verification: print a bundle's fully assembled
 * system prompt (① ② ③) without starting pi.
 *
 *   bun scripts/dry-boot.ts <cwd> <agent-name> [--fixture <id>] [--var k=v]…
 *
 * Prompt goes to stdout; resolution details and warnings go to stderr, so the
 * output pipes clean.
 */

import { resolve } from "node:path";

import { bootAgent } from "../src/boot";
import { listAgents, resolveAgent } from "../src/catalog";

const argv = Bun.argv.slice(2);
const positional: string[] = [];
let fixtureId: string | undefined;
const variables: Record<string, unknown> = {};

for (let i = 0; i < argv.length; i++) {
	const arg = argv[i];
	if (arg === "--fixture") {
		fixtureId = argv[++i];
	} else if (arg === "--var") {
		const pair = argv[++i] ?? "";
		const eq = pair.indexOf("=");
		if (eq > 0) variables[pair.slice(0, eq)] = pair.slice(eq + 1);
	} else {
		positional.push(arg);
	}
}

const [cwdArg, agentName] = positional;
if (!cwdArg || !agentName) {
	console.error("usage: bun scripts/dry-boot.ts <cwd> <agent-name> [--fixture <id>] [--var k=v]…");
	process.exit(2);
}
const cwd = resolve(cwdArg);

const resolved = await resolveAgent(agentName, cwd);
if (!resolved) {
	console.error(`No agent bundle named "${agentName}" resolvable from ${cwd}.`);
	const agents = await listAgents(cwd);
	console.error(
		agents.length > 0
			? `Resolvable: ${agents.map((a) => `${a.name} (${a.source})`).join(", ")}`
			: "No agents resolvable from this directory.",
	);
	process.exit(1);
}

const booted = await bootAgent(resolved.def, resolved.source, {
	cwd,
	fixtureId,
	variables,
});

console.error(`agent: ${booted.name} (${booted.source})`);
console.error(`bundle: ${resolved.def.bundleLayout.dir}`);
if (booted.fixtureId) console.error(`fixture: ${booted.fixtureId}`);
for (const warning of booted.warnings) console.error(`warning: ${warning}`);
console.error(`sections: prompt=${booted.sections.prompt.length}ch context=${booted.sections.context?.length ?? 0}ch state=${booted.sections.state?.length ?? 0}ch`);
console.error("---");
console.log(booted.systemPrompt);
