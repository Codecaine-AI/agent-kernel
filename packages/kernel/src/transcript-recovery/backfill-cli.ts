#!/usr/bin/env bun
/**
 * agent-kernel backfill CLI.
 *
 * Usage:
 *   bun run packages/kernel/src/transcript-recovery/backfill-cli.ts <jsonl-dir> --db <db-path>
 *     [--batch-size <n>]
 *     [--binding-type <customType>]      default: agent-kernel:session-binding
 *     [--lifecycle-type <customType>]    default: agent-kernel:pi-lifecycle
 *     [--subagent-type <customType>]     default: agent-kernel:subagent-link
 */
import { runBackfill } from "./backfill";

interface CliArgs {
  jsonlDir: string;
  dbPath: string;
  batchSize?: number;
  bindingType: string;
  lifecycleType?: string;
  subagentType?: string;
}

function usage(): never {
  console.error(
    "Usage: backfill-cli.ts <jsonl-dir> --db <db-path> [--batch-size <n>] " +
      "[--binding-type <t>] [--lifecycle-type <t>] [--subagent-type <t>]",
  );
  process.exit(2);
}

function parseArgs(argv: string[]): CliArgs {
  let jsonlDir: string | undefined;
  let dbPath: string | undefined;
  let batchSize: number | undefined;
  let bindingType = "agent-kernel:session-binding";
  let lifecycleType: string | undefined;
  let subagentType: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--db":
        dbPath = argv[++i];
        break;
      case "--batch-size": {
        const raw = argv[++i];
        batchSize = raw ? Number.parseInt(raw, 10) : Number.NaN;
        if (!Number.isFinite(batchSize) || batchSize <= 0) {
          console.error(`Invalid --batch-size: ${raw}`);
          usage();
        }
        break;
      }
      case "--binding-type":
        bindingType = argv[++i] ?? bindingType;
        break;
      case "--lifecycle-type":
        lifecycleType = argv[++i];
        break;
      case "--subagent-type":
        subagentType = argv[++i];
        break;
      case "--help":
      case "-h":
        usage();
        break;
      default:
        if (arg.startsWith("--")) {
          console.error(`Unknown option: ${arg}`);
          usage();
        }
        if (jsonlDir !== undefined) {
          console.error(`Unexpected extra positional argument: ${arg}`);
          usage();
        }
        jsonlDir = arg;
    }
  }

  if (!jsonlDir || !dbPath) usage();
  return { jsonlDir, dbPath, batchSize, bindingType, lifecycleType, subagentType };
}

const args = parseArgs(process.argv.slice(2));

try {
  const summary = await runBackfill({
    jsonlDir: args.jsonlDir,
    dbPath: args.dbPath,
    batchSize: args.batchSize,
    mapper: {
      sessionBinding: { customType: args.bindingType },
      ...(args.lifecycleType ? { lifecycleCustomType: args.lifecycleType } : {}),
      ...(args.subagentType ? { subagentLinkCustomType: args.subagentType } : {}),
    },
  });

  console.log(`Backfill complete: ${args.jsonlDir} -> ${args.dbPath}`);
  console.log(`  filesProcessed: ${summary.filesProcessed}`);
  console.log(`  eventsMapped:   ${summary.eventsMapped}`);
  console.log(`  eventsInserted: ${summary.eventsInserted}`);
  console.log(`  eventsSkipped:  ${summary.eventsSkipped}`);
  if (summary.warnings.length > 0) {
    console.log(`  warnings (${summary.warnings.length}):`);
    for (const warning of summary.warnings) {
      console.log(`    - ${warning}`);
    }
  }
} catch (error) {
  console.error(
    `Backfill failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
