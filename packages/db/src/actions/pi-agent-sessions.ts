import { asc, eq } from "drizzle-orm";
import type { KernelDatabase } from "../client";
import { piAgentSessions, type SessionStatus } from "../schema/pi-agent-sessions";
import type { NewPiAgentSession, PiAgentSession } from "../types";

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
        containerId: data.containerId,
        ...(data.parentSessionId !== undefined && {
          parentSessionId: data.parentSessionId,
        }),
        ...(data.parentToolUseId !== undefined && {
          parentToolUseId: data.parentToolUseId,
        }),
        ...(data.displayLabel !== undefined && { displayLabel: data.displayLabel }),
        ...(data.model !== undefined && { model: data.model }),
        ...(data.promptHash !== undefined && { promptHash: data.promptHash }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.phase !== undefined && { phase: data.phase }),
        ...(data.endedAt !== undefined && { endedAt: data.endedAt }),
      },
    })
    .returning();
  return row;
}

/** Link a child session to the parent session + tool call that spawned it. */
export async function setParentSession(
  db: KernelDatabase,
  childSessionId: string,
  parentSessionId: string,
  parentToolUseId?: string,
): Promise<PiAgentSession | undefined> {
  const [row] = await db
    .update(piAgentSessions)
    .set({
      parentSessionId,
      ...(parentToolUseId !== undefined && { parentToolUseId }),
    })
    .where(eq(piAgentSessions.id, childSessionId))
    .returning();
  return row;
}

export async function updatePiAgentSessionStatus(
  db: KernelDatabase,
  piSessionId: string,
  status: SessionStatus,
  endedAt?: string,
): Promise<PiAgentSession | undefined> {
  const [row] = await db
    .update(piAgentSessions)
    .set({
      status,
      ...(endedAt !== undefined && { endedAt }),
    })
    .where(eq(piAgentSessions.id, piSessionId))
    .returning();
  return row;
}

export async function getPiAgentSession(
  db: KernelDatabase,
  piSessionId: string,
): Promise<PiAgentSession | undefined> {
  const [row] = await db
    .select()
    .from(piAgentSessions)
    .where(eq(piAgentSessions.id, piSessionId))
    .limit(1);
  return row;
}

export async function listPiAgentSessionsForContainer(
  db: KernelDatabase,
  containerId: string,
): Promise<PiAgentSession[]> {
  return db
    .select()
    .from(piAgentSessions)
    .where(eq(piAgentSessions.containerId, containerId))
    .orderBy(asc(piAgentSessions.createdAt));
}
