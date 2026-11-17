import { Type } from "typebox";

import { defineSpawnerTool, defineTools } from "../../../agent-definition";

/** start_child dispatches echo-bundle in the background and returns at once, without waiting for it. */
export const tools = defineTools((pi) => {
	pi.registerTool(
		defineSpawnerTool({
			name: "start_child",
			label: "start_child",
			description: "Start the echo-bundle child in the background.",
			parameters: Type.Object({ label: Type.String() }),
			spawns: ["echo-bundle"],
			execute: async (_toolCallId, params, { dispatch }) => {
				await dispatch("echo-bundle", `CHILD-TASK ${params.label}`, {
					background: true,
					description: `child of ${params.label}`,
				});
				return { content: [{ type: "text", text: "started" }], details: {} };
			},
		}),
	);
});
