import { asc, eq } from "drizzle-orm";
import type { KernelDatabase } from "../client";
import { containers, type ContainerStatus } from "../schema/containers";
import type { Container } from "../types";

export interface UpsertContainerInput {
  /**
   * Caller-derived deterministic id (the kernel derives
   * uuidv5(kernelNamespace(kernelId), `${kind}\n${key.join("\n")}`)).
   * On conflict with an existing (kernelId, kind, appKey) row, the existing
   * row's id wins — the same identity always resolves to the same container.
   */
  id: string;
  kernelId: string;
  kind: string;
  appKey: string[];
  label?: string;
  status?: ContainerStatus;
  parentContainerId?: string | null;
  phase?: string | null;
  phaseVocabulary?: string[] | null;
  workingDir?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
  startedAt?: string | null;
  endedAt?: string | null;
}

/**
 * Idempotent container upsert keyed by (kernel_id, kind, app_key).
 * Identity columns and created_at are never updated on conflict; descriptive
 * fields are refreshed when provided.
 */
export async function upsertContainer(
  db: KernelDatabase,
  input: UpsertContainerInput,
): Promise<Container> {
  const set = {
    ...(input.label !== undefined && { label: input.label }),
    ...(input.status !== undefined && { status: input.status }),
    ...(input.parentContainerId !== undefined && {
      parentContainerId: input.parentContainerId,
    }),
    ...(input.phase !== undefined && { phase: input.phase }),
    ...(input.phaseVocabulary !== undefined && {
      phaseVocabulary: input.phaseVocabulary,
    }),
    ...(input.workingDir !== undefined && { workingDir: input.workingDir }),
    ...(input.metadata !== undefined && { metadata: input.metadata }),
    ...(input.startedAt !== undefined && { startedAt: input.startedAt }),
    ...(input.endedAt !== undefined && { endedAt: input.endedAt }),
  };

  const [row] = await db
    .insert(containers)
    .values({
      id: input.id,
      kernelId: input.kernelId,
      kind: input.kind,
      appKey: input.appKey,
      label: input.label,
      status: input.status,
      parentContainerId: input.parentContainerId,
      phase: input.phase,
      phaseVocabulary: input.phaseVocabulary,
      workingDir: input.workingDir,
      metadata: input.metadata,
      createdAt: input.createdAt ?? new Date().toISOString(),
      startedAt: input.startedAt,
      endedAt: input.endedAt,
    })
    .onConflictDoUpdate({
      target: [containers.kernelId, containers.kind, containers.appKey],
      // DO UPDATE requires a non-empty set; kind = kind is a no-op refresh.
      set: Object.keys(set).length > 0 ? set : { kind: input.kind },
    })
    .returning();
  return row;
}

export async function updateContainerStatus(
  db: KernelDatabase,
  containerId: string,
  status: ContainerStatus,
  opts?: {
    phase?: string;
    startedAt?: string;
    endedAt?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<Container | undefined> {
  const [row] = await db
    .update(containers)
    .set({
      status,
      ...(opts?.phase !== undefined && { phase: opts.phase }),
      ...(opts?.startedAt !== undefined && { startedAt: opts.startedAt }),
      ...(opts?.endedAt !== undefined && { endedAt: opts.endedAt }),
      ...(opts?.metadata !== undefined && { metadata: opts.metadata }),
    })
    .where(eq(containers.id, containerId))
    .returning();
  return row;
}

export async function getContainer(
  db: KernelDatabase,
  containerId: string,
): Promise<Container | undefined> {
  const [row] = await db
    .select()
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1);
  return row;
}

export async function listChildContainers(
  db: KernelDatabase,
  parentContainerId: string,
): Promise<Container[]> {
  return db
    .select()
    .from(containers)
    .where(eq(containers.parentContainerId, parentContainerId))
    .orderBy(asc(containers.createdAt));
}

export async function listContainersForKernel(
  db: KernelDatabase,
  kernelId: string,
): Promise<Container[]> {
  return db
    .select()
    .from(containers)
    .where(eq(containers.kernelId, kernelId))
    .orderBy(asc(containers.createdAt));
}
