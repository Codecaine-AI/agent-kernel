import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import { registerAgentCommands } from "./commands";

const exampleDir = fileURLToPath(
	new URL("../../../examples/simple-research-kernel", import.meta.url),
);

interface Notification {
	message: string;
	severity: string;
}

interface AppendedEntry {
	customType: string;
	data: unknown;
}

function makeHarness(mode: string, customImpl?: (factory: any) => Promise<unknown>) {
	const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
	const appendedEntries: AppendedEntry[] = [];
	const eventHandlers = new Map<string, Array<(event: any) => unknown>>();
	const pi = {
		on: (event: string, handler: (event: any) => unknown) => {
			const list = eventHandlers.get(event) ?? [];
			list.push(handler);
			eventHandlers.set(event, list);
		},
		registerCommand: (name: string, def: any) => commands.set(name, def),
		registerTool: () => {},
		appendEntry: (customType: string, data: unknown) =>
			appendedEntries.push({ customType, data }),
	};
	const notifications: Notification[] = [];
	const ctx = {
		cwd: exampleDir,
		mode,
		hasUI: true,
		ui: {
			notify: (message: string, severity: string) =>
				notifications.push({ message, severity }),
			setStatus: () => {},
			custom: customImpl ?? (async () => null),
		},
	};
	registerAgentCommands(pi as any);
	return {
		handler: commands.get("kernel")!.handler,
		ctx,
		notifications,
		appendedEntries,
		eventHandlers,
	};
}

describe("/kernel command surfaces", () => {
	test("non-interactive fallback: plain list at info severity", async () => {
		const { handler, ctx, notifications } = makeHarness("rpc");
		await handler("", ctx);
		expect(notifications).toHaveLength(1);
		expect(notifications[0].severity).toBe("info");
		expect(notifications[0].message).toContain("research-coordinator (project)");
	});

	test("interactive selector constructs, renders, and tears down on Esc", async () => {
		let rendered: string[] | null = null;
		const custom = async (factory: any) => {
			let result: unknown = "unset";
			const done = (value: unknown) => {
				result = value;
			};
			const mockTui = { requestRender: () => {} };
			const mockTheme = {
				fg: (_color: string, text: string) => text,
				bold: (text: string) => text,
			};
			const component = factory(mockTui, mockTheme, null, done);
			rendered = component.render(100);
			component.handleInput(""); // Esc → SelectList onCancel → done(null)
			component.invalidate();
			return result === "unset" ? null : result;
		};
		const { handler, ctx, notifications } = makeHarness("tui", custom);
		await handler("", ctx);
		// Esc cancels: no boot, no notify.
		expect(notifications).toHaveLength(0);
		expect(rendered).not.toBeNull();
		const text = (rendered as unknown as string[]).join("\n");
		expect(text).toContain("Agent bundles");
		expect(text).toContain("PROJECT"); // section header
		expect(text).toContain("research-coordinator");
		expect(text).toContain("● ready"); // status column
		expect(text).toContain("▸"); // selection marker on first entry
	});

	test("selector Enter on a bootable entry boots it", async () => {
		const custom = async (factory: any) => {
			let result: unknown = null;
			const done = (value: unknown) => {
				result = value;
			};
			const component = factory(
				{ requestRender: () => {} },
				{ fg: (_c: string, t: string) => t, bold: (t: string) => t },
				null,
				done,
			);
			component.handleInput("\r"); // Enter → onSelect(first entry)
			return result;
		};
		const { handler, ctx, notifications, appendedEntries } = makeHarness("tui", custom);
		await handler("", ctx);
		expect(notifications.length).toBeGreaterThan(0);
		// First selector entry: first project bootable alphabetically.
		expect(notifications[0].message).toMatch(/^Booted [a-z-]+ \(project\)/);
		expect(notifications[0].severity).toBe("info");
		// A boot appends the binding + meta markers into the session JSONL.
		expect(appendedEntries.map((entry) => entry.customType)).toEqual([
			"agent-kernel:session-binding",
			"agent-kernel:tui-session-meta",
		]);
		const binding = appendedEntries[0].data as { containerId: string; runId: string };
		const meta = appendedEntries[1].data as Record<string, unknown>;
		expect(binding.containerId).toMatch(/^[0-9a-f-]{36}$/i);
		expect(meta.containerId).toBe(binding.containerId);
		expect(meta.runId).toBe(binding.runId);
		expect(meta.origin).toBe("tui");
		expect(meta.cwd).toBe(exampleDir);
		// exampleDir has its own .agent-kernel — ownership resolves to it.
		expect(String(meta.targetKernelRoot)).toContain("simple-research-kernel");
	});

	test("manifest disallowedTools are blocked after boot; reads stay open", async () => {
		const { handler, ctx, notifications, eventHandlers } = makeHarness("tui");
		// docs-writer (generic catalog) declares disallowedTools: ["write","edit"].
		await handler("docs-writer", ctx);
		expect(notifications[0].message).toContain("Booted docs-writer");
		expect(notifications[0].message).toContain("built-ins disabled: write, edit");

		const toolCall = (toolName: string) => {
			for (const h of eventHandlers.get("tool_call") ?? []) {
				const result = h({ toolName }) as { block?: boolean; reason?: string } | undefined;
				if (result?.block) return result;
			}
			return undefined;
		};
		expect(toolCall("edit")?.block).toBe(true);
		expect(toolCall("write")?.reason).toContain("disallowedTools");
		expect(toolCall("read")).toBeUndefined();
		expect(toolCall("bash")).toBeUndefined();
		expect(toolCall("docs_write")).toBeUndefined();
	});

	test("arrow navigation moves selection before Enter", async () => {
		const bootedFirst: string[] = [];
		const custom = async (factory: any) => {
			let result: unknown = null;
			const component = factory(
				{ requestRender: () => {} },
				{ fg: (_c: string, t: string) => t, bold: (t: string) => t },
				null,
				(value: unknown) => {
					result = value;
				},
			);
			component.handleInput("\x1b[B"); // down one entry
			component.handleInput("\r");
			if (typeof result === "string") bootedFirst.push(result);
			return result;
		};
		const { handler, ctx, notifications } = makeHarness("tui", custom);
		await handler("", ctx);
		expect(notifications.length).toBeGreaterThan(0);
		expect(notifications[0].message).toMatch(/^Booted [a-z-]+ \(project\)/);
		// Selection moved: the booted agent is the second PROJECT row (the
		// selector groups project before generic, alphabetical within group).
		const { listAgents } = await import("./catalog");
		const projectNames = (await listAgents(ctx.cwd))
			.filter((agent) => agent.source === "project")
			.map((agent) => agent.name)
			.sort();
		expect(bootedFirst[0]).toBe(projectNames[1]);
	});
});
