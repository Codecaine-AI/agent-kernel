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
