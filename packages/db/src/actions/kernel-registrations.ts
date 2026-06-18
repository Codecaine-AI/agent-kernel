import { asc, eq } from "drizzle-orm";
import { kernels } from "../schema/kernel-registrations";
import type { KernelRegistration, NewKernelRegistration } from "../types";

type KernelDatabase = any;

export async function upsertKernelRegistration(
  db: KernelDatabase,
  data: NewKernelRegistration,
): Promise<KernelRegistration> {
  const now = new Date().toISOString();
  const [row] = await db
    .insert(kernels)
    .values({
      ...data,
      registeredAt: data.registeredAt ?? now,
      lastSeenAt: data.lastSeenAt ?? now,
    })
    .onConflictDoUpdate({
      target: kernels.kernelId,
      set: {
        displayName: data.displayName,
        workingDir: data.workingDir,
        piSessionsDir: data.piSessionsDir,
        appBaseUrl: data.appBaseUrl ?? null,
        appTraceUrlTemplate: data.appTraceUrlTemplate ?? null,
        genericTraceUrlTemplate: data.genericTraceUrlTemplate ?? null,
        markerConfig: data.markerConfig,
        ...(data.metadata !== undefined && { metadata: data.metadata }),
        lastSeenAt: data.lastSeenAt ?? now,
        updatedAt: now,
      },
    })
    .returning();
  return row;
}

export async function getKernelRegistration(
  db: KernelDatabase,
  kernelId: string,
): Promise<KernelRegistration | undefined> {
  return db.query.kernels.findFirst({
    where: eq(kernels.kernelId, kernelId),
  });
}

export async function listKernelRegistrations(
  db: KernelDatabase,
): Promise<KernelRegistration[]> {
  return db
    .select()
    .from(kernels)
    .orderBy(asc(kernels.displayName), asc(kernels.kernelId));
}
