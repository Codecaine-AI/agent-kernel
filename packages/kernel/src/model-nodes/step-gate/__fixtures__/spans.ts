/**
 * Shared helpers for the step and gate suites: read span events back from the
 * temp database, inject insert failures with SQLite triggers (the real write
 * path fails, no seam in the kernel), and capture logs.
 */
import { expect } from "bun:test";
import { asc, eq, sql } from "drizzle-orm";
import { traceEvents, type KernelDatabase } from "@agent-kernel/db";

import { runTraceDoctor } from "../../../doctor";
import { KernelNodeError } from "../../types";

export interface StoredSpanEvent {
	eventId: string;
	type: string;
	runId: string | null;
	piSessionId: string | null;
	spanId: string | null;
	parentEventId: string | null;
	timestamp: string;
	eventData: Record<string, unknown>;
}

/** Every event of one span, in timestamp order. */
export function spanEvents(db: KernelDatabase, spanId: string): StoredSpanEvent[] {
	return db
		.select()
		.from(traceEvents)
		.where(eq(traceEvents.spanId, spanId))
		.orderBy(asc(traceEvents.timestamp), asc(traceEvents.eventId))
		.all()
		.map(toStored);
}

/** Every event of one type, in timestamp order. */
export function eventsOfType(db: KernelDatabase, type: string): StoredSpanEvent[] {
	return db
		.select()
		.from(traceEvents)
		.where(eq(traceEvents.type, type))
		.orderBy(asc(traceEvents.timestamp), asc(traceEvents.eventId))
		.all()
		.map(toStored);
}

function toStored(row: typeof traceEvents.$inferSelect): StoredSpanEvent {
	return {
		eventId: row.eventId,
		type: row.type,
		runId: row.runId,
		piSessionId: row.piSessionId,
		spanId: row.spanId,
		parentEventId: row.parentEventId,
		timestamp: row.timestamp,
		eventData: row.eventData as Record<string, unknown>,
	};
}

export function countRows(db: KernelDatabase, table: string): number {
	const [row] = db.all<{ n: number }>(sql`SELECT count(*) AS n FROM ${sql.identifier(table)}`);
	if (typeof row?.n !== "number") throw new Error(`count(${table}) returned no number`);
	return row.n;
}

/** Makes every insert of `type` into trace_events fail inside SQLite. */
export function failInsertsOf(db: KernelDatabase, type: string): void {
	const trigger = `fail_${type.replace(/\W/g, "_")}`;
	db.run(
		sql.raw(
			`CREATE TRIGGER ${trigger} BEFORE INSERT ON trace_events WHEN NEW.type = '${type}' ` +
				`BEGIN SELECT RAISE(ABORT, 'injected ${type} failure'); END`,
		),
	);
}

export interface LogEntry {
	level: "debug" | "info" | "warn" | "error";
	message: string;
	data?: Record<string, unknown>;
}

export function capturingLogger(): { logger: Record<LogEntry["level"], (message: string, data?: Record<string, unknown>) => void>; entries: LogEntry[] } {
	const entries: LogEntry[] = [];
	const at =
		(level: LogEntry["level"]) =>
		(message: string, data?: Record<string, unknown>) => {
			entries.push({ level, message, ...(data !== undefined && { data }) });
		};
	return { logger: { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") }, entries };
}

export async function expectNodeError(promise: Promise<unknown>, code: KernelNodeError["code"]): Promise<KernelNodeError> {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(KernelNodeError);
		expect((error as KernelNodeError).code).toBe(code);
		return error as KernelNodeError;
	}
	throw new Error(`expected KernelNodeError(${code})`);
}

export async function expectDoctorOk(db: KernelDatabase): Promise<void> {
	const report = await runTraceDoctor(db);
	expect(report.violations).toEqual([]);
	expect(report.ok).toBe(true);
}
