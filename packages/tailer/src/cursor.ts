import fs from "node:fs/promises";
import path from "node:path";
import type { TailerConfig } from "./config";

export class CursorStore {
  private cursors: Map<string, number> = new Map();
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private readonly config: Pick<TailerConfig, "snapshotPath" | "snapshotIntervalMs">;

  constructor(config: Pick<TailerConfig, "snapshotPath" | "snapshotIntervalMs">) {
    this.config = config;
  }

  get(filePath: string): number {
    return this.cursors.get(filePath) ?? 0;
  }

  set(filePath: string, offset: number): void {
    this.cursors.set(filePath, offset);
  }

  entries(): [string, number][] {
    return Array.from(this.cursors.entries());
  }

  getCount(): number {
    return this.cursors.size;
  }

  hasFile(filePath: string): boolean {
    return this.cursors.has(filePath);
  }

  async saveSnapshot(): Promise<void> {
    const data = Object.fromEntries(this.cursors);
    const tmpPath = this.config.snapshotPath + ".tmp";

    await fs.mkdir(path.dirname(this.config.snapshotPath), { recursive: true });
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2));
    await fs.rename(tmpPath, this.config.snapshotPath);
  }

  async loadSnapshot(): Promise<void> {
    try {
      const raw = await fs.readFile(this.config.snapshotPath, "utf-8");
      const data = JSON.parse(raw) as Record<string, number>;
      for (const [filePath, offset] of Object.entries(data)) {
        this.cursors.set(filePath, offset);
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw err;
    }
  }

  startPeriodicSave(): void {
    this.snapshotTimer = setInterval(() => {
      this.saveSnapshot().catch((err) => {
        console.error("Cursor snapshot failed:", err);
      });
    }, this.config.snapshotIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    await this.saveSnapshot();
  }
}

