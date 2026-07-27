/**
 * index.ts — public surface of the state layer.
 *
 * The thesis (docs/10-system-design/explainers/state-shapes.html): one state
 * object per agent, and the messages are part of it. Base agents get exactly
 * the old behavior; rich agents ship a `state.ts` sidecar with seed / update /
 * render and take over section ③.
 */

export * from "./types";
export * from "./window";
export * from "./base";
export * from "./kernel-messages";
export * from "./context-set";
export * from "./builder";
export * from "./store";
export * from "./extension";
