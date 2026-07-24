import { blob, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Content-addressed blob store for binary/JSON trace payloads — images
 * captured from agent conversations, sanitized message JSON, system prompt
 * text. Rows are immutable and keyed by content hash, so inserts are
 * idempotent and identical payloads dedupe for free.
 */
export const traceBlobs = sqliteTable("trace_blobs", {
  /** "b1-<sha256hex>" of the raw bytes. */
  hash: text("hash").primaryKey(),
  /** "image" | "message" | "text" (open string). */
  kind: text("kind").notNull(),
  mimeType: text("mime_type").notNull(),
  byteLength: integer("byte_length").notNull(),
  /** Raw payload bytes. */
  data: blob("data", { mode: "buffer" }).notNull(),
  /** ISO-8601, caller-supplied like the other tables. */
  createdAt: text("created_at").notNull(),
});
