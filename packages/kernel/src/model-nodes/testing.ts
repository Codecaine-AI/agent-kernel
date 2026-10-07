/**
 * `@agent-kernel/kernel/model-nodes/testing`: offline fakes and the temp
 * kernel helper for model-node tests (plan §7.1, §7.2). The fake classifier
 * and fake call engine join this module with M2 and M3.
 */
export {
	createTempKernel,
	createTempKernelDb,
	disableNetwork,
	TEMP_KERNEL_ID,
	type TempKernel,
	type TempKernelDb,
} from "./__fixtures__/temp-kernel";
export {
	createFakeCallEngine,
	FAKE_CALL_BASE_URL,
	FAKE_CALL_MODEL,
	FAKE_CALL_MODEL_REF,
	FAKE_CALL_PROVIDER,
	fakeAttempt,
	fakeFailure,
	fakeOk,
	fakePiModels,
	untilAborted,
	type FakeAttemptOptions,
	type FakeCallEngine,
	type FakeCallEngineOptions,
	type FakeCallRequest,
	type FakeCallResponse,
	type FakePiModels,
	type FakePiModelsOptions,
} from "./call/__fixtures__/fake-call-engine";
export {
	createFakeClassifier,
	createFakeClassifierRegistry,
	FAKE_CLASSIFIER_API,
	FAKE_CLASSIFIER_MODEL,
	FAKE_CLASSIFIER_PROVIDER,
	type FakeClassifier,
	type FakeClassifierOptions,
	type FakeReply,
	type FakeScript,
} from "./__fixtures__/fake-classifier";
