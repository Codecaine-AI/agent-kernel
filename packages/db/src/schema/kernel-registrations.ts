import { index, jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

export interface KernelMarkerConfig {
  sessionBinding: string;
  lifecycle: string;
  subagentLink: string;
}

export const kernels = pgTable("kernel_registrations", {
  kernelId: varchar("kernel_id").primaryKey().notNull(),
  displayName: varchar("display_name").notNull(),
  workingDir: varchar("working_dir").notNull(),
  piSessionsDir: varchar("pi_sessions_dir").notNull(),
  appBaseUrl: varchar("app_base_url"),
  appTraceUrlTemplate: varchar("app_trace_url_template"),
  genericTraceUrlTemplate: varchar("generic_trace_url_template"),
  markerConfig: jsonb("marker_config").$type<KernelMarkerConfig>().notNull(),
  metadata: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
  registeredAt: timestamp("registered_at", { mode: "string" }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { mode: "string" }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("ix_kernel_registrations_pi_sessions_dir").using("btree", table.piSessionsDir.asc().nullsLast().op("text_ops")),
  index("ix_kernel_registrations_last_seen_at").using("btree", table.lastSeenAt.asc().nullsLast().op("timestamp_ops")),
]);
