import {
  foreignKey,
  index,
  integer,
  real,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

/**
 * Container status vocabulary. Open string — the kind/status vocabulary
 * belongs to the host app; these are the kernel's conventional values.
 */
export const CONTAINER_STATUS = {
  ACTIVE: "active",
  DONE: "done",
  ERROR: "error",
  ABORTED: "aborted",
} as const;

export type ContainerStatus =
  | (typeof CONTAINER_STATUS)[keyof typeof CONTAINER_STATUS]
  | (string & {});

/**
 * The single grouping primitive. Identified deterministically from
 * (kernel_id, kind, app_key) — same identity always upserts the same row.
 * Usage rollup columns land in Phase 1 and are populated in Phase 2.
 */
export const containers = sqliteTable(
  "containers",
  {
    id: text("id").primaryKey(),
    kernelId: text("kernel_id").notNull(),
    kind: text("kind").notNull(),
    /** JSON array of app-defined key segments. */
    appKey: text("app_key", { mode: "json" }).$type<string[]>().notNull(),
    label: text("label"),
    status: text("status")
      .$type<ContainerStatus>()
      .notNull()
      .default(CONTAINER_STATUS.ACTIVE),
    parentContainerId: text("parent_container_id"),
    phase: text("phase"),
    phaseVocabulary: text("phase_vocabulary", { mode: "json" }).$type<string[]>(),
    workingDir: text("working_dir"),
    /** Opaque to the kernel. */
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    usageInputTokens: integer("usage_input_tokens").notNull().default(0),
    usageOutputTokens: integer("usage_output_tokens").notNull().default(0),
    usageCacheRead: integer("usage_cache_read").notNull().default(0),
    usageCacheWrite: integer("usage_cache_write").notNull().default(0),
    usageCostEstimate: real("usage_cost_estimate"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    endedAt: text("ended_at"),
  },
  (table) => [
    unique("ux_containers_kernel_kind_app_key").on(
      table.kernelId,
      table.kind,
      table.appKey,
    ),
    index("ix_containers_parent_container_id").on(table.parentContainerId),
    foreignKey({
      columns: [table.parentContainerId],
      foreignColumns: [table.id],
      name: "containers_parent_container_id_fkey",
    }),
  ],
);
