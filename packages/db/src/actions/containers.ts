import { asc, eq } from "drizzle-orm";
import { containers, type ContainerStatus } from "../schema/containers";
import type { Container, NewContainer } from "../types";

type KernelDatabase = any;

export async function upsertContainer(
  db: KernelDatabase,
  data: NewContainer,
): Promise<Container> {
  const [row] = await db
    .insert(containers)
    .values(data)
    .onConflictDoUpdate({
      target: containers.id,
      set: {
        ...(data.parentContainerId !== undefined && { parentContainerId: data.parentContainerId }),
        ...(data.label !== undefined && { label: data.label }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.workingDir !== undefined && { workingDir: data.workingDir }),
        ...(data.worktreePath !== undefined && { worktreePath: data.worktreePath }),
        ...(data.phase !== undefined && { phase: data.phase }),
        ...(data.phaseVocabulary !== undefined && { phaseVocabulary: data.phaseVocabulary }),
        ...(data.metadata !== undefined && { metadata: data.metadata }),
        ...(data.startedAt !== undefined && { startedAt: data.startedAt }),
        ...(data.completedAt !== undefined && { completedAt: data.completedAt }),
        updatedAt: new Date().toISOString(),
      },
    })
    .returning();
  return row;
}

export async function updateContainerStatus(
  db: KernelDatabase,
  containerId: string,
  status: ContainerStatus,
  opts?: {
    completedAt?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<Container | undefined> {
  const [row] = await db
    .update(containers)
    .set({
      status,
      ...(opts?.completedAt !== undefined && { completedAt: opts.completedAt }),
      ...(opts?.metadata !== undefined && { metadata: opts.metadata }),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(containers.id, containerId))
    .returning();
  return row;
}

export async function getContainer(
  db: KernelDatabase,
  containerId: string,
): Promise<Container | undefined> {
  return db.query.containers.findFirst({
    where: eq(containers.id, containerId),
  });
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
