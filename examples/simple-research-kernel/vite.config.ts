import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const port = Number(process.env.FRONTEND_PORT ?? 5174);
const apiTarget = process.env.API_TARGET ?? "http://127.0.0.1:8788";

/**
 * @codecaine-ai/prompt-kit and @codecaine-ai/annotations are sibling checkouts
 * linked in as source, so Vite compiles their files straight from
 * `../../../prompt-kit` / `../../../annotations`. That needs fs.allow for the
 * directories (they sit outside this repo, so the default workspace root does
 * not cover them), a react/react-dom dedupe — both carry their own copy for
 * standalone typechecking and two Reacts crash hooks — and optimizeDeps
 * exclusion: a prebundled linked dep is served from a stale cache and never
 * hot-reloads.
 */
const APP_DIR = dirname(fileURLToPath(import.meta.url));
const PROMPT_KIT_DIR = resolve(APP_DIR, "../../../prompt-kit");
const ANNOTATIONS_DIR = resolve(APP_DIR, "../../../annotations");

export default defineConfig({
	plugins: [react()],
	resolve: {
		dedupe: ["react", "react-dom"]
	},
	optimizeDeps: {
		exclude: ["@codecaine-ai/prompt-kit", "@codecaine-ai/annotations"]
	},
	server: {
		host: "127.0.0.1",
		port,
		strictPort: true,
		fs: {
			allow: [resolve(APP_DIR, "../.."), PROMPT_KIT_DIR, ANNOTATIONS_DIR]
		},
		proxy: {
			"/kernel": apiTarget,
			"/api": apiTarget
		}
	}
});
