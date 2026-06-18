import type { PiEvent } from "./types";
import type { OnEventsCallback } from "./watcher";

export class FileReader {
  private filePath: string;
  private offset: number;
  private onEvents: OnEventsCallback;
  private reading = false;

  constructor(filePath: string, initialOffset: number, onEvents: OnEventsCallback) {
    this.filePath = filePath;
    this.offset = initialOffset;
    this.onEvents = onEvents;
  }

  async readNew(): Promise<void> {
    if (this.reading) return;
    this.reading = true;

    try {
      const file = Bun.file(this.filePath);
      const size = file.size;

      if (size <= this.offset) {
        return;
      }

      const buffer = await file.arrayBuffer();
      const slice = buffer.slice(this.offset);
      const text = new TextDecoder().decode(slice);
      const segments = text.split("\n");
      const hasTrailingNewline = text.endsWith("\n");
      const completeLines = hasTrailingNewline
        ? segments.filter((s) => s.trim().length > 0)
        : segments.slice(0, -1).filter((s) => s.trim().length > 0);

      const events: PiEvent[] = [];
      let bytesConsumed = 0;

      for (const line of completeLines) {
        try {
          const parsed = JSON.parse(line) as PiEvent;
          events.push(parsed);
        } catch {
          console.warn(
            `Skipping malformed JSONL line in ${this.filePath}: ${line.slice(0, 80)}...`,
          );
        }
        bytesConsumed += new TextEncoder().encode(line + "\n").byteLength;
      }

      this.offset += bytesConsumed;

      if (events.length > 0) {
        this.onEvents(this.filePath, events);
      }
    } catch (err) {
      console.error(`FileReader error for ${this.filePath}:`, err);
    } finally {
      this.reading = false;
    }
  }

  getOffset(): number {
    return this.offset;
  }

  setOffset(offset: number): void {
    this.offset = offset;
  }

  getFilePath(): string {
    return this.filePath;
  }
}

