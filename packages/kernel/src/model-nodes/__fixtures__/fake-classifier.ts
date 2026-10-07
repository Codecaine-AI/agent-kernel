/**
 * A scripted, offline classifier provider for decision tests (plan §7.1),
 * ported from the pi-classify spike. It plugs into every Pi surface the
 * kernel uses: pi-ai `createModels().setProvider()`, coding-agent
 * `ModelRuntime.registerNativeProvider()`, and `ModelRegistry.registerProvider()`.
 * It never calls fetch, so no outbound credential is involved.
 */
import {
	createProvider,
	InMemoryCredentialStore,
	type ClassifierAnswer,
	type ClassifierContext,
	type ClassifierModel,
	type ClassifierOptions,
	type ClassifierResult,
	type Provider,
	type Usage,
} from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

export const FAKE_CLASSIFIER_PROVIDER = "fake-decide";
export const FAKE_CLASSIFIER_API = "fake-classify";
export const FAKE_CLASSIFIER_MODEL = "fake-jev";

export type FakeReply =
	| { answers: Record<string, ClassifierAnswer>; usage?: { input: number; output: number } }
	| { error: string }
	| { hang: true };

/** Decides a reply from the request. Default: bool p = 0.5, uniform choice, middle score. */
export type FakeScript = (context: ClassifierContext, model: ClassifierModel<string>) => FakeReply | Promise<FakeReply>;

export interface FakeClassifierOptions {
	/** Default "fake-decide". */
	provider?: string;
	/** Default "fake-classify". */
	api?: string;
	/** Default "fake-jev". */
	modelId?: string;
	/** False: the provider resolves no auth, so Pi reports "Provider is not configured". Default true (keyless). */
	configured?: boolean;
}

export interface FakeClassifier {
	provider: Provider;
	model: ClassifierModel<string>;
	/** "provider/id" of the listed model. */
	ref: string;
	/** Every classify call with the options Pi handed the provider. */
	calls: { context: ClassifierContext; options?: ClassifierOptions }[];
	setScript(script: FakeScript): void;
}

function defaultAnswers(context: ClassifierContext): Record<string, ClassifierAnswer> {
	return Object.fromEntries(
		Object.entries(context.questions).map(([id, q]): [string, ClassifierAnswer] => {
			if (q.type === "bool") return [id, { type: "bool", probability: 0.5 }];
			if (q.type === "score") return [id, { type: "score", score: (q.criteria.length - 1) / 2, confidence: 0.5 }];
			const labels = Object.keys(q.criteria);
			const p = 1 / labels.length;
			return [
				id,
				{ type: "choice", choice: labels[0]!, probabilities: Object.fromEntries(labels.map((l) => [l, p])), confidence: 0 },
			];
		}),
	);
}

function usageOf(input: number, output: number): Usage {
	return {
		input,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: input + output,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

export function createFakeClassifier(opts: FakeClassifierOptions = {}): FakeClassifier {
	const providerId = opts.provider ?? FAKE_CLASSIFIER_PROVIDER;
	const api = opts.api ?? FAKE_CLASSIFIER_API;
	let script: FakeScript = (context) => ({ answers: defaultAnswers(context) });
	const calls: FakeClassifier["calls"] = [];
	const model: ClassifierModel<string> = {
		type: "classifier",
		id: opts.modelId ?? FAKE_CLASSIFIER_MODEL,
		name: "Fake classifier",
		api,
		provider: providerId,
		baseUrl: "http://fake.invalid",
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 64_000,
	};
	const configured = opts.configured ?? true;
	const provider = createProvider({
		id: providerId,
		name: "Fake classifier",
		// Keyless: resolve() reports "configured" with no credential, like a local server.
		auth: {
			apiKey: {
				name: "fake",
				resolve: async () => (configured ? { auth: {}, source: "fake" } : undefined),
			},
		},
		models: [model],
		classifiers: {
			[api]: {
				// Contract: never reject; report provider failures as stopReason "error".
				async classify(m, context, options): Promise<ClassifierResult> {
					calls.push({ context, ...(options !== undefined && { options }) });
					const base = { api: m.api, provider: m.provider, model: m.id, answers: {}, timestamp: Date.now() };
					if (options?.signal?.aborted) return { ...base, stopReason: "aborted", errorMessage: "Request aborted" };
					const reply = await script(context, m);
					if ("hang" in reply) {
						return await new Promise<ClassifierResult>((resolve) => {
							options?.signal?.addEventListener(
								"abort",
								() => resolve({ ...base, stopReason: "aborted", errorMessage: "Request aborted" }),
								{ once: true },
							);
						});
					}
					if ("error" in reply) return { ...base, stopReason: "error", errorMessage: reply.error };
					return {
						...base,
						answers: reply.answers,
						...(reply.usage ? { usage: usageOf(reply.usage.input, reply.usage.output) } : {}),
						stopReason: "stop",
					};
				},
			},
		},
	});
	return {
		provider,
		model,
		ref: `${providerId}/${model.id}`,
		calls,
		setScript: (s) => void (script = s),
	};
}

/**
 * An in-memory Pi runtime + registry with `fake` registered: pass the
 * registry as `createKernel({ decide: { models } })`. No auth file, no
 * models.json, no catalog refresh.
 */
export async function createFakeClassifierRegistry(
	fake: FakeClassifier = createFakeClassifier(),
): Promise<{ fake: FakeClassifier; runtime: ModelRuntime; registry: ModelRegistry }> {
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		refreshOnCreate: false,
	});
	runtime.registerNativeProvider(fake.provider);
	return { fake, runtime, registry: new ModelRegistry(runtime) };
}
