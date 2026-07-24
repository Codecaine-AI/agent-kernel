import { sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Where a prompt revision came from. */
export const PROMPT_REVISION_SOURCE = {
  REGISTRY_BOOT: "registry-boot",
  LAB_SAVE: "lab-save",
  DISK_SYNC: "disk-sync",
  MIGRATION: "migration",
} as const;

export type PromptRevisionSource =
  (typeof PROMPT_REVISION_SOURCE)[keyof typeof PROMPT_REVISION_SOURCE];

/**
 * Content-addressed prompt revisions. The table lands in Phase 1;
 * Phase 3 (prompt.json + revisions) populates it.
 */
export const promptRevisions = sqliteTable("prompt_revisions", {
  /** "pk1-<sha256>" of the canonicalized PromptDocument. */
  hash: text("hash").primaryKey(),
  agentName: text("agent_name").notNull(),
  /** e.g. "prompt-kit/v1". */
  schemaVersion: text("schema_version").notNull(),
  /** Canonical JSON PromptDocument. */
  document: text("document").notNull(),
  /** XML-tagged Markdown rendered at save time. */
  renderedText: text("rendered_text").notNull(),
  source: text("source").$type<PromptRevisionSource>().notNull(),
  createdAt: text("created_at").notNull(),
});
