import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import {
  immediateParentId,
  kernelNodeEventId,
  kernelRequestId,
  nestedToolEventId,
  piEntryEventId,
} from "./ids";

/** Independent reference for the documented seed → uuid-shaped id derivation. */
function idFromSeed(seed: string): string {
  const hex = createHash("sha256").update(seed, "utf8").digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const NODE_TYPES = ["call_start", "decision_made", "call_end", "pi_request_snapshot", "pi_turn_start", "pi_turn_end"];

describe("model-node event ids", () => {
  test("kernelNodeEventId is stable and disjoint from piEntryEventId", () => {
    // Stored ids depend on the documented seed layout.
    expect(kernelNodeEventId("run-1", 0, "call_start")).toBe(idFromSeed("kernel-node\nrun-1\n0\ncall_start"));
    expect(kernelNodeEventId("span:s-1", 0, "step_end")).toBe(idFromSeed("kernel-node\nspan:s-1\n0\nstep_end"));

    // 1k uuid-prefixed Pi entry ids vs node ids built from the same uuids, ordinals and types.
    const piIds = new Set<string>();
    const nodeIds = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const uuid = crypto.randomUUID();
      const type = NODE_TYPES[i % NODE_TYPES.length]!;
      const ordinal = i % 3;
      piIds.add(piEntryEventId(uuid, uuid, ordinal, type));
      piIds.add(piEntryEventId(uuid, "kernel-node", ordinal, type));
      nodeIds.add(kernelNodeEventId(uuid, ordinal, type));
      nodeIds.add(kernelNodeEventId(`span:${uuid}`, ordinal, type));
    }
    expect(piIds.size).toBe(2000);
    expect(nodeIds.size).toBe(2000);
    for (const id of nodeIds) expect(piIds.has(id)).toBe(false);
  });

  test("kernelRequestId follows the documented seed layout", () => {
    expect(kernelRequestId("k-1", "session", "req-1")).toBe(idFromSeed("kernel-request\nk-1\nsession\nreq-1"));
    expect(kernelRequestId("k-1", "span", "req-1")).toBe(idFromSeed("kernel-request\nk-1\nspan\nreq-1"));
  });
});

describe("nested tool event ids", () => {
  const PI_UUID = "0b6f7c1e-3a52-4c8e-9a51-6d2f0e7b4c11";

  test("nestedToolEventId matches for live and backfill inputs", () => {
    // Live: Pi's tool_execution_* event. Backfill: a record of the parent toolResult's nestedCalls.
    const live = { type: "tool_execution_end", toolCallId: "codemode/1/1", toolName: "read", parentToolCallId: "codemode/1" };
    const record = { id: "codemode/1/1", name: "read", status: "ok" };

    for (const type of ["tool_call_start", "tool_call_end"]) {
      const fromLive = nestedToolEventId(PI_UUID, live.toolCallId, type);
      const fromBackfill = nestedToolEventId(PI_UUID, record.id, type);
      expect(fromLive).toBe(fromBackfill);
      expect(fromLive).toBe(idFromSeed(`${PI_UUID}\nnested-tool:codemode/1/1\n0\n${type}`));
    }
    // Backfill derives the parent from the id; it must agree with the parent Pi reports live.
    expect(immediateParentId(record.id)).toBe(live.parentToolCallId);
  });

  test("immediateParentId strips only the final /<n>", () => {
    const cases: Array<[string, string | undefined]> = [
      ["codemode/1/1", "codemode/1"],
      ["codemode/1", "codemode"],
      ["call_abc|fc_9/12", "call_abc|fc_9"],
      ["codemode", undefined], // top-level id: no parent
      ["/1", undefined],
      ["a/b", undefined], // last segment is not a nested ordinal
      ["codemode/", undefined],
    ];
    for (const [id, parent] of cases) expect([id, immediateParentId(id)]).toEqual([id, parent]);
  });
});
