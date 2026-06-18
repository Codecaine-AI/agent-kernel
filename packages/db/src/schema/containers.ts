import { foreignKey, index, jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

export const CONTAINER_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  ABORTED: "aborted",
  STOPPED: "stopped",
  ERROR: "error",
} as const;

export type ContainerStatus = (typeof CONTAINER_STATUS)[keyof typeof CONTAINER_STATUS] | (string & {});

export const containers = pgTable("containers", {
  id: varchar().primaryKey().notNull(),
  parentContainerId: varchar("parent_container_id"),
  label: varchar().notNull(),
  status: varchar().$type<ContainerStatus>().notNull().default(CONTAINER_STATUS.RUNNING),
  workingDir: varchar("working_dir"),
  worktreePath: varchar("worktree_path"),
  phase: varchar(),
  phaseVocabulary: jsonb("phase_vocabulary").$type<string[]>().default([]).notNull(),
  metadata: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
  startedAt: timestamp("started_at", { mode: "string" }),
  completedAt: timestamp("completed_at", { mode: "string" }),
  createdAt: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("ix_containers_parent_container_id").using("btree", table.parentContainerId.asc().nullsLast().op("text_ops")),
  index("ix_containers_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
  index("ix_containers_phase").using("btree", table.phase.asc().nullsLast().op("text_ops")),
  foreignKey({
    columns: [table.parentContainerId],
    foreignColumns: [table.id],
    name: "containers_parent_container_id_fkey",
  }),
]);
