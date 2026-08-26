#!/usr/bin/env bun
/**
 * agent-kernel-tui-ingest — import /kernel-booted Pi TUI sessions into their
 * owning kernel trace dbs (see tui-ingest.ts for the marker contract and the
 * ownership rule).
 *
 * Usage:
 *   agent-kernel-tui-ingest [--sessions-dir <dir>] [--dry-run]
 *
 *   --sessions-dir   defaults to ~/.pi/agent/sessions
 *   --dry-run        report target dbs and identity rows without writing
 */
import os from "node:os";
import path from "node:path";
import { runTuiIngest } from "./tui-ingest";

interface CliArgs {
  sessionsDir: string;
  dryRun: boolean;
}

function usage(): never {
  console.error("Usage: agent-kernel-tui-ingest [--sessions-dir <dir>] [--dry-run]");
  process.exit(2);
}

function parseArgs(argv: string[]): CliArgs {
  let sessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions");
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--sessions-dir": {
        const value = argv[++i];
        if (!value) usage();
        sessionsDir = path.resolve(value);
        break;
      }
      case "--dry-run":
        dryRun = true;
        break;
      case "--help":
      case "-h":
        usage();
        break;
      default:
        console.error(`Unknown option: ${argv[i]}`);
        usage();
    }
  }
  return { sessionsDir, dryRun };
}

const args = parseArgs(process.argv.slice(2));

try {
  const summary = await runTuiIngest({
    sessionsDir: args.sessionsDir,
    dryRun: args.dryRun,
    log: (line) => console.log(line),
  });

  console.log(
    `TUI ingest${args.dryRun ? " (dry-run)" : ""} complete: ${args.sessionsDir}`,
  );
  console.log(`  filesScanned:       ${summary.filesScanned}`);
  console.log(`  filesIngested:      ${summary.filesIngested}`);
  console.log(`  containersUpserted: ${summary.containersUpserted}`);
  console.log(`  sessionsUpserted:   ${summary.sessionsUpserted}`);
  console.log(`  runsUpserted:       ${summary.runsUpserted}`);
  console.log(`  eventsMapped:       ${summary.eventsMapped}`);
  console.log(`  eventsInserted:     ${summary.eventsInserted}`);
  console.log(`  eventsSkipped:      ${summary.eventsSkipped}`);
  if (summary.warnings.length > 0) {
    console.log(`  warnings (${summary.warnings.length}):`);
    for (const warning of summary.warnings) {
      console.log(`    - ${warning}`);
    }
  }
} catch (error) {
  console.error(
    `TUI ingest failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
