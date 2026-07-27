/**
 * real-turn-context.ts — a REAL captured turn, not a hand-written fixture.
 *
 * Produced by spikes/state-three-section-e2e/e2e.ts: a kernel-spawned agent
 * with the state extension active (manifest `state.window`, base module) run
 * against an in-memory provider, then read back through
 * kernel.readApiService.getRunTurnContext(runId, 0) — the same shape the
 * viewer fetches from GET /kernel/runs/:runId/turns/:n/context.
 *
 * It is the fourth prompt on one reused pi session with a 2-turn window, so
 * section ③ opens with the kernel's elision marker and the tail is the two
 * turns that survived the cut. Regenerate with:
 *
 *   bun spikes/state-three-section-e2e/e2e.ts
 *   bun spikes/state-three-section-e2e/emit-fixture.ts
 */
import type { RunTurnContextResponse } from "../request-snapshot-api";

export const realTurnContext: RunTurnContextResponse = {
	"run_id": "2018abe0-c8a5-46bb-b93a-1a88798fbe14",
	"turn_number": 0,
	"prompt_hash": "pk1-bb16ee876b220b6c8b793f161fecb5c630effbc9eb902048de357fedded77f8e",
	"system_prompt": "<role>\n    You are the state-demo agent. You exist to exercise the kernel's three-section request builder end to end against a deterministic in-memory provider.\n</role>\n\n<method>\n    Call the probe tool once per prompt, then answer in one short line. Never invent tool names.\n</method>\nCurrent working directory: <repo>/spikes/state-three-section-e2e/.artifacts",
	"message_count": 7,
	"messages": [
		{
			"role": "custom",
			"customType": "kernel:context",
			"content": [
				{
					"type": "text",
					"text": "<context>\n<state_demo_context>\n<agent>state-demo</agent>\n<input kind=\"text\" status=\"ok\">\nprobe · answer — the probe tool echoes its note back verbatim.\n</input>\n<input kind=\"text\" status=\"ok\">\nQuote marks (\"), ampersands (&), angle brackets (<state>), unicode arrows (→) and × all appear here on purpose.\n</input>\n</state_demo_context>\n</context>"
				}
			],
			"display": false,
			"timestamp": 1785169752964
		},
		{
			"role": "custom",
			"customType": "kernel:state",
			"content": [
				{
					"type": "text",
					"text": "[turns 1–2 elided]"
				}
			],
			"display": false,
			"timestamp": 1785169752964
		},
		{
			"role": "user",
			"content": [
				{
					"type": "text",
					"text": "Turn three: probe the gamma note."
				}
			],
			"timestamp": 1785169752951
		},
		{
			"role": "assistant",
			"content": [
				{
					"type": "toolCall",
					"id": "call-3-1",
					"name": "probe",
					"arguments": {
						"note": "run-3"
					}
				}
			],
			"api": "mock-e2e-api",
			"provider": "mock-e2e",
			"model": "deterministic-e2e",
			"usage": {
				"input": 0,
				"output": 0,
				"cacheRead": 0,
				"cacheWrite": 0,
				"totalTokens": 0,
				"cost": {
					"input": 0,
					"output": 0,
					"cacheRead": 0,
					"cacheWrite": 0,
					"total": 0
				}
			},
			"stopReason": "toolUse",
			"timestamp": 1785169752953
		},
		{
			"role": "toolResult",
			"toolCallId": "call-3-1",
			"toolName": "probe",
			"content": [
				{
					"type": "text",
					"text": "probe → run-3"
				}
			],
			"details": {
				"note": "run-3"
			},
			"isError": false,
			"timestamp": 1785169752954
		},
		{
			"role": "assistant",
			"content": [
				{
					"type": "text",
					"text": "run 3 complete"
				}
			],
			"api": "mock-e2e-api",
			"provider": "mock-e2e",
			"model": "deterministic-e2e",
			"usage": {
				"input": 0,
				"output": 0,
				"cacheRead": 0,
				"cacheWrite": 0,
				"totalTokens": 0,
				"cost": {
					"input": 0,
					"output": 0,
					"cacheRead": 0,
					"cacheWrite": 0,
					"total": 0
				}
			},
			"stopReason": "stop",
			"timestamp": 1785169752955
		},
		{
			"role": "user",
			"content": [
				{
					"type": "text",
					"text": "Turn four: probe the delta note."
				}
			],
			"timestamp": 1785169752963
		}
	],
	"refs": [
		{
			"blob_hash": "b1-7e68bea17ed4ea46a1cdb2fb9226a5b8e2d42a1937d4cd111dda3b4c25c3dc74",
			"role": "custom",
			"index": 0,
			"text_chars": 346,
			"image_count": 0,
			"tool_call_count": 0
		},
		{
			"blob_hash": "b1-e27eebf2222cda3f6085149a8610a313c85fb6e841323006abb4d92b25efac49",
			"role": "custom",
			"index": 1,
			"text_chars": 18,
			"image_count": 0,
			"tool_call_count": 0
		},
		{
			"blob_hash": "b1-a0f388e22930fbdb3a34a64bf11cb8f071efe38b52e930afaf0f2d16a3373794",
			"role": "user",
			"index": 2,
			"text_chars": 33,
			"image_count": 0,
			"tool_call_count": 0
		},
		{
			"blob_hash": "b1-f16730e0e6876a90cdc58fab7abd6f6cedd91977bc344e7b0b32bf38666cc66b",
			"role": "assistant",
			"index": 3,
			"text_chars": 0,
			"image_count": 0,
			"tool_call_count": 1
		},
		{
			"blob_hash": "b1-8ed998374369145ae32a3287e3744f9104c48de6ececf9ef5bc270b330b9423e",
			"role": "toolResult",
			"index": 4,
			"text_chars": 13,
			"image_count": 0,
			"tool_call_count": 0
		},
		{
			"blob_hash": "b1-1ff7e8a968061ca947a31c951c39d18a23f0d41d005848955160d95afa078b52",
			"role": "assistant",
			"index": 5,
			"text_chars": 14,
			"image_count": 0,
			"tool_call_count": 0
		},
		{
			"blob_hash": "b1-121d0fffd5725bf91444863076b11b08b9c3638a3de3fa306cfabf1dd72070d8",
			"role": "user",
			"index": 6,
			"text_chars": 32,
			"image_count": 0,
			"tool_call_count": 0
		}
	],
	"totals": {
		"text_chars": 456,
		"image_count": 0
	},
	"sections": [
		{
			"kind": "context",
			"start": 0,
			"end": 1
		},
		{
			"kind": "state",
			"start": 1,
			"end": 2
		},
		{
			"kind": "tail",
			"start": 2,
			"end": 7
		}
	]
} as RunTurnContextResponse;
