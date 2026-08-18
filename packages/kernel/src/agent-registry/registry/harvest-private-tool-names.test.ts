import { describe, expect, test } from "bun:test";

import { Type } from "@earendil-works/pi-ai";

import {
	defineSpawnerTool,
	type AgentPrivateTools,
} from "../../agent-definition";
import { harvestPrivateToolsFromRegister } from "./harvest-private-tool-names";

describe("harvestPrivateToolsFromRegister", () => {
	test("accepts hook registrations as no-ops without changing harvested tools", async () => {
		let hookCalls = 0;
		const register: AgentPrivateTools = (pi) => {
			pi.on("tool_result", () => {
				hookCalls += 1;
			});
			pi.registerTool({
				name: "plain_tool",
				label: "Plain tool",
				description: "A plain private tool.",
				parameters: Type.Object({}),
				execute: async () => ({
					content: [{ type: "text", text: "ok" }],
					details: {},
				}),
			});
			pi.registerTool(
				defineSpawnerTool({
					name: "spawn_helper",
					label: "Spawn helper",
					description: "Dispatch a helper agent.",
					parameters: Type.Object({}),
					spawns: ["helper-agent"],
					execute: async () => ({
						content: [{ type: "text", text: "ok" }],
						details: {},
					}),
				}),
			);
		};

		const harvested = await harvestPrivateToolsFromRegister(register);

		expect(hookCalls).toBe(0);
		expect(harvested.names).toEqual(["plain_tool", "spawn_helper"]);
		expect(harvested.spawnerTools).toEqual({ spawn_helper: ["helper-agent"] });
		expect(harvested.definitions.map((definition) => definition.name)).toEqual([
			"plain_tool",
			"spawn_helper",
		]);
		expect(harvested.definitions[0]).toMatchObject({
			name: "plain_tool",
			label: "Plain tool",
			description: "A plain private tool.",
			parameters: { type: "object", properties: {} },
		});
		expect(harvested.definitions[1]).toMatchObject({
			name: "spawn_helper",
			label: "Spawn helper",
			description: "Dispatch a helper agent.",
		});
		expect(harvested.definitions[1]?.parameters.type).toBe("object");
	});
});
