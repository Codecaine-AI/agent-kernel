import { eq } from "drizzle-orm";
import { piAgentSessions, type AgentStatus } from "../schema/pi-agent-sessions";
import type { NewPiAgentSession, PiAgentSession } from "../types";

type KernelDatabase = any;

export async function upsertPiAgentSession(
  db: KernelDatabase,
  data: NewPiAgentSession,
): Promise<PiAgentSession> {
  const [row] = await db
    .insert(piAgentSessions)
    .values(data)
    .onConflictDoUpdate({
      target: piAgentSessions.id,
      set: {
        ...(data.appSessionId !== undefined && { appSessionId: data.appSessionId }),
        ...(data.parentId !== undefined && { parentId: data.parentId }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.model !== undefined && { model: data.model }),
        ...(data.startedAt !== undefined && { startedAt: data.startedAt }),
        ...(data.completedAt !== undefined && { completedAt: data.completedAt }),
        ...(data.displayLabel !== undefined && { displayLabel: data.displayLabel }),
        ...(data.phase !== undefined && { phase: data.phase }),
        ...(data.containerId !== undefined && { containerId: data.containerId }),
        updatedAt: new Date().toISOString(),
      },
    })
    .returning();
  return row;
}

export async function setParentId(
  db: KernelDatabase,
  childPiSessionUuid: string,
  parentPiSessionUuid: string,
): Promise<PiAgentSession | undefined> {
  const [row] = await db
    .update(piAgentSessions)
    .set({ parentId: parentPiSessionUuid, updatedAt: new Date().toISOString() })
    .where(eq(piAgentSessions.id, childPiSessionUuid))
    .returning();
  return row;
}

export async function updatePiAgentSessionStatus(
  db: KernelDatabase,
  piSessionId: string,
  status: AgentStatus,
  completedAt?: string,
): Promise<PiAgentSession | undefined> {
  const [row] = await db
    .update(piAgentSessions)
    .set({
      status,
      ...(completedAt && { completedAt }),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(piAgentSessions.id, piSessionId))
    .returning();
  return row;
}

export async function getPiAgentSession(
  db: KernelDatabase,
  piSessionId: string,
): Promise<PiAgentSession | undefined> {
  return db.query.piAgentSessions.findFirst({
    where: eq(piAgentSessions.id, piSessionId),
  });
}

export async function listPiAgentSessionsForAppSession(
  db: KernelDatabase,
  appSessionId: string,
): Promise<PiAgentSession[]> {
  return db
    .select()
    .from(piAgentSessions)
    .where(eq(piAgentSessions.appSessionId, appSessionId));
}
