import { describe, expect, test } from "bun:test";

import {
	collectSecrets,
	findShortCredential,
	REDACTED,
	redactDeep,
	redactHeaders,
	redactText,
} from "./redact";

const KEY = "sk-test-0123456789abcdef";

describe("redactHeaders", () => {
	test("redacts auth headers case-insensitively", () => {
		const redacted = redactHeaders({
			Authorization: `Bearer ${KEY}`,
			"X-Api-Key": KEY,
			"api-key": KEY,
			"OpenAI-Api-Key": KEY,
			Cookie: "session=abcdefgh",
			"x-session-token": "tok-12345678",
			"x-client-secret": "sec-12345678",
			"content-type": "application/json",
			"x-request-id": "req-1",
		});
		expect(redacted).toEqual({
			Authorization: REDACTED,
			"X-Api-Key": REDACTED,
			"api-key": REDACTED,
			"OpenAI-Api-Key": REDACTED,
			Cookie: REDACTED,
			"x-session-token": REDACTED,
			"x-client-secret": REDACTED,
			"content-type": "application/json",
			"x-request-id": "req-1",
		});
		expect(redactHeaders(new Headers({ AUTHORIZATION: `Bearer ${KEY}`, accept: "*/*" }))).toEqual({
			authorization: REDACTED,
			accept: "*/*",
		});
	});
});

describe("collectSecrets", () => {
	test("collects sensitive header values with and without Bearer, plus extras; ignores empty values", () => {
		const secrets = collectSecrets(
			{ authorization: `Bearer ${KEY}`, "x-custom-token": "custom-token-value", accept: "*/*", "x-api-key": "" },
			[KEY, "", undefined, null],
		);
		expect(secrets).toContain(`Bearer ${KEY}`);
		expect(secrets).toContain(KEY);
		expect(secrets).toContain("custom-token-value");
		expect(secrets).not.toContain("*/*");
		expect(secrets).not.toContain("");
		// longest first, so a value is replaced before any substring of it
		expect(secrets.indexOf(`Bearer ${KEY}`)).toBeLessThan(secrets.indexOf(KEY));
	});

	test("refuses 1–7 character credentials; empty values mean no credential", () => {
		expect(findShortCredential({ authorization: "Bearer abc123" })).toBe("authorization");
		expect(findShortCredential({ "x-api-key": "x" })).toBe("x-api-key");
		expect(findShortCredential({}, ["abcdefg"])).toBe("apiKey");
		expect(findShortCredential({ authorization: `Bearer ${KEY}`, "x-api-key": "" }, [KEY, ""])).toBeUndefined();
		expect(findShortCredential({ accept: "x" })).toBeUndefined();
	});
});

describe("redactDeep", () => {
	test("scrubs secret values in JSON, raw text, SSE frames, URLs and error messages", () => {
		const secrets = collectSecrets({ authorization: `Bearer ${KEY}` }, [KEY]);
		const value = {
			request: {
				url: `https://api.example.invalid/v1/responses?key=${KEY}`,
				body: { input: [{ role: "user", content: `echo ${KEY}` }] },
			},
			[`header:${KEY}`]: "key in an object key",
			raw: `model said: Bearer ${KEY} and ${KEY}`,
			sse: [`data: {"type":"response.output_text.delta","delta":"${KEY}"}`, { delta: KEY }],
			error: new Error(`401 Unauthorized: invalid key ${KEY}`),
			status: 401,
			ok: false,
			nothing: null,
		};
		const redacted = redactDeep(value, secrets);
		const serialized = JSON.stringify(redacted);
		expect(serialized).not.toContain(KEY);
		expect(redacted.request.url).toBe(`https://api.example.invalid/v1/responses?key=${REDACTED}`);
		expect(redacted.raw).toBe(`model said: ${REDACTED} and ${REDACTED}`);
		expect(redacted.error).toEqual({ name: "Error", message: `401 Unauthorized: invalid key ${REDACTED}` });
		expect(redacted.status).toBe(401);
		expect(redacted.ok).toBe(false);
		expect(redacted.nothing).toBeNull();
		expect(Object.keys(redacted)).toContain(`header:${REDACTED}`);
		// the input is not mutated
		expect(value.raw).toContain(KEY);
	});

	test("scrubs every collected secret value regardless of length (incl. a 3-character value in a body, an SSE frame and an error message)", () => {
		const secrets = collectSecrets({ "x-api-key": "q7z" });
		expect(secrets).toEqual(["q7z"]);
		const redacted = redactDeep(
			{
				body: { note: "token q7z echoed" },
				sse: ['data: {"delta":"q7z"}'],
				errorMessage: "invalid api key q7z",
			},
			secrets,
		);
		expect(JSON.stringify(redacted)).not.toContain("q7z");
		expect(redacted.errorMessage).toBe(`invalid api key ${REDACTED}`);
		expect(redactText("aq7zq7z", ["q7z"])).toBe(`a${REDACTED}${REDACTED}`);
	});

	test("handles cycles and passes non-JSON values through", () => {
		const cyclic: Record<string, unknown> = { secret: KEY };
		cyclic.self = cyclic;
		const bytes = new Uint8Array([1, 2, 3]);
		const redacted = redactDeep({ cyclic, bytes }, [KEY]);
		expect((redacted.cyclic as Record<string, unknown>).secret).toBe(REDACTED);
		expect((redacted.cyclic as Record<string, unknown>).self).toBe(redacted.cyclic);
		expect(redacted.bytes).toBe(bytes);
	});
});
