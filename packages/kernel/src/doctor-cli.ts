#!/usr/bin/env bun
/**
 * Doctor CLI — two checks behind one command.
 *
 *   trace    scan one kernel SQLite database for linkage-invariant violations
 *   catalog  scan agent catalog roots for bundle-layout problems (a section
 *            present in both the file and the folder form)
 *
 * Usage:
 *   bun run packages/kernel/src/doctor-cli.ts <db-path>
 *   bun run packages/kernel/src/doctor-cli.ts        # defaults to .agent-kernel/trace.db
 *   bun run packages/kernel/src/doctor-cli.ts --catalog <catalog-root ...>
 *
 * Exit codes: 0 clean · 1 violations found · 2 usage/IO error. Bundle layout
 * findings are warnings: they print, and only exit 1 under --strict.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { KERNEL_DB_RELATIVE_PATH, openKernelDatabase } from "@agent-kernel/db";

import {
	formatCatalogDoctorReport,
	formatDoctorReport,
	runCatalogDoctor,
	runTraceDoctor,
} from "./doctor";

export async function doctorCliMain(
	argv: string[] = process.argv.slice(2),
): Promise<number> {
	if (argv.includes("--catalog")) {
		const strict = argv.includes("--strict");
		const roots = argv
			.filter((arg) => !arg.startsWith("-"))
			.map((arg) => resolve(arg));
		if (roots.length === 0) {
			console.error("agent-kernel doctor: --catalog requires at least one root");
			console.error("usage: agent-kernel-doctor --catalog <catalog-root ...>");
			return 2;
		}
		for (const root of roots) {
			if (!existsSync(root)) {
				console.error(`agent-kernel doctor: catalog root not found: ${root}`);
				return 2;
			}
		}
		const report = runCatalogDoctor(roots);
		console.log(formatCatalogDoctorReport(report));
		return report.ok || !strict ? 0 : 1;
	}

	const dbPath = resolve(argv[0] ?? KERNEL_DB_RELATIVE_PATH);
	if (!existsSync(dbPath)) {
		console.error(`agent-kernel doctor: database not found: ${dbPath}`);
		console.error("usage: agent-kernel-doctor <db-path>");
		console.error("       agent-kernel-doctor --catalog <catalog-root ...>");
		return 2;
	}

	const handle = openKernelDatabase({ path: dbPath });
	try {
		const report = await runTraceDoctor(handle.db);
		console.log(formatDoctorReport(report, dbPath));
		return report.ok ? 0 : 1;
	} finally {
		handle.close();
	}
}

if (import.meta.main) {
	doctorCliMain().then(
		(code) => process.exit(code),
		(err) => {
			console.error("agent-kernel doctor failed:", err);
			process.exit(2);
		},
	);
}
