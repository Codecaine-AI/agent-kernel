import { eq } from "drizzle-orm";
import type { KernelDatabase } from "../client";
import {
  promptRevisions,
  type PromptRevisionSource,
} from "../schema/prompt-revisions";
import type { PromptRevision } from "../types";

export interface UpsertPromptRevisionInput {
  /** "pk1-<sha256>" of the canonicalized PromptDocument. */
  hash: string;
  agentName: string;
  /** e.g. "prompt-kit/v1". */
  schemaVersion: string;
  /** Canonical JSON PromptDocument. */
  document: string;
  /** XML-tagged Markdown rendered at save time. */
  renderedText: string;
  source: PromptRevisionSource;
  createdAt: string;
}

/**
 * Idempotent on hash: a revision is content-addressed and immutable, so a
 * conflicting insert leaves the existing row (including its createdAt and
 * source) untouched and returns it.
 */
export async function upsertPromptRevision(
  db: KernelDatabase,
  input: UpsertPromptRevisionInput,
): Promise<PromptRevision> {
  const [inserted] = await db
    .insert(promptRevisions)
    .values(input)
    .onConflictDoNothing({ target: promptRevisions.hash })
    .returning();
  if (inserted) return inserted;
  const [existing] = await db
    .select()
    .from(promptRevisions)
    .where(eq(promptRevisions.hash, input.hash))
    .limit(1);
  return existing;
}

export async function getPromptRevision(
  db: KernelDatabase,
  hash: string,
): Promise<PromptRevision | undefined> {
  const [row] = await db
    .select()
    .from(promptRevisions)
    .where(eq(promptRevisions.hash, hash))
    .limit(1);
  return row;
}

export async function listPromptRevisionsForAgent(
  db: KernelDatabase,
  agentName: string,
): Promise<PromptRevision[]> {
  return db
    .select()
    .from(promptRevisions)
    .where(eq(promptRevisions.agentName, agentName));
}
