/**
 * Route parity guard: the kernel's HTTP routes (template-literal paths in
 * packages/kernel/src/read-api.ts, catalog-api.ts, catalog-annotations-api.ts,
 * prompt-edit-session-api.ts) against the client path constants in
 * packages/viewer-core/src/api.ts. The kernel deliberately does not depend on
 * the viewer, so nothing else ties the two sides together — this test does.
 *
 * It lives in viewer-ui because this is the one package that legitimately
 * sees both sides: viewer-core is a runtime dependency, and
 * @agent-kernel/kernel is already a devDependency for the in-process loop
 * test (agent-viewer/prompt-edit-loop.e2e.test.ts). No new dependency edge.
 *
 * How it compares: each kernel route factory is built over a stub service
 * (routes register at construction; no handler runs), `app.routes` is
 * enumerated, and every route is reduced to "METHOD /shape" with `:param`
 * segments collapsed to ":". Every viewer-core path builder is called with
 * placeholder params and reduced the same way. Parity is asserted in both
 * directions, with explicit allowlists for the intentional gaps.
 *
 * The path constants carry no HTTP method, so the *_METHODS tables below are
 * the client-side method contract: the method(s) the viewer sends to each
 * path. Adding a path constant without a table entry fails typecheck
 * (`satisfies`) and the "declares its methods" test.
 */
import { describe, expect, test } from "bun:test";

import type {
	KernelCatalogService,
	PromptEditSessionService,
} from "@agent-kernel/kernel";
import { createKernelCatalogApi } from "@agent-kernel/kernel/catalog-api";
import { createKernelTraceReadApi } from "@agent-kernel/kernel/read-api";
import {
	KERNEL_CATALOG_PATHS,
	KERNEL_OBSERVER_READ_PATHS,
	KERNEL_PROMPT_EDIT_SESSION_PATHS,
	KERNEL_TRACE_READ_PATHS,
} from "@agent-kernel/viewer-core";

type Method = "GET" | "POST" | "PUT" | "DELETE";
type PathEntry = string | ((...args: never[]) => string);
type MethodTable<T> = { readonly [K in keyof T]: readonly Method[] };

const TRACE_READ_METHODS = {
	listTraceSessions: ["GET"],
	traceSessionDetail: ["GET"],
	containerTrace: ["GET"],
	blob: ["GET"],
	runTurnContext: ["GET"],
} satisfies MethodTable<typeof KERNEL_TRACE_READ_PATHS>;

const CATALOG_METHODS = {
	listAgents: ["GET"],
	agentDetail: ["GET"],
	agentPrompt: ["PUT"],
	agentManifest: ["PUT"],
	agentRevisions: ["GET"],
	revisionDocument: ["GET"],
	revisionStats: ["GET"],
	agentFixtureStatePreview: ["GET"],
	agentAnnotations: ["GET", "POST"],
	agentAnnotation: ["DELETE"],
	agentAnnotationReplies: ["POST"],
	agentAnnotationResolve: ["POST"],
	agentAnnotationAgentRun: ["POST"],
	agentAnnotationsPrune: ["POST"],
	agentEditSessions: ["POST"],
} satisfies MethodTable<typeof KERNEL_CATALOG_PATHS>;

const PROMPT_EDIT_SESSION_METHODS = {
	list: ["GET"],
	session: ["GET", "DELETE"],
	events: ["GET"],
	requests: ["POST"],
	accept: ["POST"],
	reject: ["POST"],
	undo: ["POST"],
	replies: ["POST"],
} satisfies MethodTable<typeof KERNEL_PROMPT_EDIT_SESSION_PATHS>;

const OBSERVER_READ_METHODS = {
	listKernels: ["GET"],
	kernel: ["GET"],
	kernelContainers: ["GET"],
	container: ["GET"],
	containerTrace: ["GET"],
} satisfies MethodTable<typeof KERNEL_OBSERVER_READ_PATHS>;

const CLIENT_GROUPS: ReadonlyArray<{
	name: string;
	paths: Record<string, PathEntry>;
	methods: Record<string, readonly Method[]>;
}> = [
	{
		name: "KERNEL_TRACE_READ_PATHS",
		paths: KERNEL_TRACE_READ_PATHS,
		methods: TRACE_READ_METHODS,
	},
	{
		name: "KERNEL_CATALOG_PATHS",
		paths: KERNEL_CATALOG_PATHS,
		methods: CATALOG_METHODS,
	},
	{
		name: "KERNEL_PROMPT_EDIT_SESSION_PATHS",
		paths: KERNEL_PROMPT_EDIT_SESSION_PATHS,
		methods: PROMPT_EDIT_SESSION_METHODS,
	},
	{
		name: "KERNEL_OBSERVER_READ_PATHS",
		paths: KERNEL_OBSERVER_READ_PATHS,
		methods: OBSERVER_READ_METHODS,
	},
];

/**
 * Client constants with NO kernel route, by "<group>.<key>". Intentional gaps
 * only — every entry needs a reason.
 *
 * KERNEL_OBSERVER_READ_PATHS: the cross-kernel observer plane (a viewer over
 * many kernel manifests) is a declared URL contract with no server
 * implementation in this repo. Remove these entries when an observer route
 * factory lands and is added to `serverRoutes()` below.
 */
const CLIENT_ONLY_ALLOWLIST: ReadonlySet<string> = new Set([
	"KERNEL_OBSERVER_READ_PATHS.listKernels",
	"KERNEL_OBSERVER_READ_PATHS.kernel",
	"KERNEL_OBSERVER_READ_PATHS.kernelContainers",
	"KERNEL_OBSERVER_READ_PATHS.container",
	"KERNEL_OBSERVER_READ_PATHS.containerTrace",
]);

/**
 * Kernel routes with NO client path constant, as "METHOD /shape" (params
 * collapsed to ":"). Intentional gaps only — every entry needs a reason.
 * Empty today: every kernel route has a viewer-core constant.
 */
const SERVER_ONLY_ALLOWLIST: ReadonlySet<string> = new Set([]);

const PLACEHOLDER = "__param__";

/** "/a/:name/b" → "/a/:/b" — param names are not part of the contract. */
function serverShape(path: string): string {
	return path
		.split("/")
		.map((segment) => (segment.startsWith(":") ? ":" : segment))
		.join("/");
}

/** Calls a path builder with placeholders and collapses them to ":". */
function clientShape(entry: PathEntry): string {
	if (typeof entry === "string") return entry;
	const build = entry as unknown as (...args: string[]) => string;
	const shape = build(...Array.from({ length: entry.length }, () => PLACEHOLDER))
		.split("/")
		.map((segment) => (segment === PLACEHOLDER ? ":" : segment))
		.join("/");
	// Every builder param must land as its own path segment.
	expect(shape.split("/").filter((segment) => segment === ":")).toHaveLength(
		entry.length,
	);
	return shape;
}

/** Stub services: route registration reads only `allowWrites`. */
function serverRoutes(): Set<string> {
	const catalog = createKernelCatalogApi(
		{ allowWrites: true } as unknown as KernelCatalogService,
		{
			// Mounts prompt-edit-session-api.ts; catalog-annotations-api.ts is
			// always mounted by the catalog factory.
			promptEditSessions: {
				allowWrites: true,
			} as unknown as PromptEditSessionService,
		},
	);
	const traceRead = createKernelTraceReadApi({
		getContainerTrace: async () => null,
	});
	return new Set(
		[...catalog.routes, ...traceRead.routes].map(
			(route) => `${route.method.toUpperCase()} ${serverShape(route.path)}`,
		),
	);
}

interface ClientRoute {
	id: string;
	route: string;
}

function clientRoutes(): ClientRoute[] {
	const routes: ClientRoute[] = [];
	for (const group of CLIENT_GROUPS) {
		for (const [key, entry] of Object.entries(group.paths)) {
			const shape = clientShape(entry);
			for (const method of group.methods[key] ?? []) {
				routes.push({ id: `${group.name}.${key}`, route: `${method} ${shape}` });
			}
		}
	}
	return routes;
}

describe("kernel route parity (viewer-core path constants vs kernel routes)", () => {
	test("every client path constant declares its methods", () => {
		for (const group of CLIENT_GROUPS) {
			expect(Object.keys(group.methods).sort()).toEqual(
				Object.keys(group.paths).sort(),
			);
			for (const methods of Object.values(group.methods)) {
				expect(methods.length).toBeGreaterThan(0);
			}
		}
	});

	test("the kernel factories register routes", () => {
		// Guards the enumeration itself: an empty `app.routes` would make the
		// server→client direction pass vacuously.
		expect(serverRoutes().size).toBeGreaterThan(0);
	});

	test("every client path constant has a kernel route", () => {
		const server = serverRoutes();
		const missing = clientRoutes()
			.filter(({ id, route }) => !CLIENT_ONLY_ALLOWLIST.has(id) && !server.has(route))
			.map(({ id, route }) => `${id} → ${route}`);
		expect(missing).toEqual([]);
	});

	test("every kernel route has a client path constant", () => {
		const client = new Set(clientRoutes().map(({ route }) => route));
		const missing = [...serverRoutes()].filter(
			(route) => !SERVER_ONLY_ALLOWLIST.has(route) && !client.has(route),
		);
		expect(missing).toEqual([]);
	});

	test("the allowlists hold only live gaps", () => {
		const server = serverRoutes();
		const clients = clientRoutes();
		const clientIds = new Set(clients.map(({ id }) => id));
		const clientSet = new Set(clients.map(({ route }) => route));

		// A client-only entry must name a real constant that still has no route.
		const staleClientOnly = [...CLIENT_ONLY_ALLOWLIST].filter(
			(id) =>
				!clientIds.has(id) ||
				clients.some((client) => client.id === id && server.has(client.route)),
		);
		expect(staleClientOnly).toEqual([]);

		// A server-only entry must name a real route that still has no constant.
		const staleServerOnly = [...SERVER_ONLY_ALLOWLIST].filter(
			(route) => !server.has(route) || clientSet.has(route),
		);
		expect(staleServerOnly).toEqual([]);
	});
});
