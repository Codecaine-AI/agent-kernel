import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const port = Number(process.env.FRONTEND_PORT ?? 5174);
const apiTarget = process.env.API_TARGET ?? "http://127.0.0.1:8788";

/**
 * @codecaine-ai/prompt-kit is a sibling checkout linked in as source, so Vite
 * compiles its files straight from `../../../prompt-kit`. That needs fs.allow
 * for the directory (it sits outside this repo, so the default workspace root
 * does not cover it) and a react/react-dom dedupe — prompt-kit carries its own
 * copy for standalone typechecking and two Reacts crash hooks.
 */
const APP_DIR = dirname(fileURLToPath(import.meta.url));
const PROMPT_KIT_DIR = resolve(APP_DIR, "../../../prompt-kit");

export default defineConfig({
	plugins: [react()],
	resolve: {
		dedupe: ["react", "react-dom"]
	},
	optimizeDeps: {
		exclude: ["@codecaine-ai/prompt-kit"]
	},
	server: {
		host: "127.0.0.1",
		port,
		strictPort: true,
		fs: {
			allow: [resolve(APP_DIR, "../.."), PROMPT_KIT_DIR]
		},
		proxy: {
			"/kernel": apiTarget,
			"/api": apiTarget
		}
	}
});
