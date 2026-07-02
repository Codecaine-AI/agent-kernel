#!/usr/bin/env bun
/**
 * Trace doctor CLI — scan one kernel SQLite database for linkage-invariant
 * violations and exit non-zero when any are found.
 *
 * Usage:
 *   bun run packages/kernel/src/doctor-cli.ts <db-path>
 *   bun run packages/kernel/src/doctor-cli.ts        # defaults to .agent-kernel/trace.db
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { KERNEL_DB_RELATIVE_PATH, openKernelDatabase } from "@agent-kernel/db";

import { formatDoctorReport, runTraceDoctor } from "./doctor";

export async function doctorCliMain(
	argv: string[] = process.argv.slice(2),
): Promise<number> {
	const dbPath = resolve(argv[0] ?? KERNEL_DB_RELATIVE_PATH);
	if (!existsSync(dbPath)) {
		console.error(`agent-kernel doctor: database not found: ${dbPath}`);
		console.error("usage: agent-kernel-doctor <db-path>");
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
