/**
 * JSONL reader — reads a complete Pi session transcript file.
 *
 * Backfill posture: files are read whole (no offsets, no watchers). Only
 * newline-terminated lines are parsed; a partial trailing line (torn write
 * from a crashed process) is ignored and reported.
 */
import type { PiEvent } from "./types";

export interface JsonlReadResult {
  events: PiEvent[];
  /** Lines that failed to parse as JSON (skipped). */
  malformedLines: number;
  /** True when the file ends in a partial, non-newline-terminated line. */
  truncatedTail: boolean;
}

export async function readJsonlFile(filePath: string): Promise<JsonlReadResult> {
  const text = await Bun.file(filePath).text();
  const segments = text.split("\n");
  const hasTrailingNewline = text.endsWith("\n");
  const tail = hasTrailingNewline ? "" : (segments[segments.length - 1] ?? "");
  const completeLines = (hasTrailingNewline ? segments : segments.slice(0, -1)).filter(
    (s) => s.trim().length > 0,
  );

  const events: PiEvent[] = [];
  let malformedLines = 0;
  for (const line of completeLines) {
    try {
      events.push(JSON.parse(line) as PiEvent);
    } catch {
      malformedLines++;
    }
  }

  return {
    events,
    malformedLines,
    truncatedTail: tail.trim().length > 0,
  };
}
