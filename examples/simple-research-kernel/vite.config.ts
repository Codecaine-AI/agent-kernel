import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const port = Number(process.env.FRONTEND_PORT ?? 5174);
const apiTarget = process.env.API_TARGET ?? "http://127.0.0.1:8788";

export default defineConfig({
	plugins: [react()],
	server: {
		host: "127.0.0.1",
		port,
		strictPort: true,
		proxy: {
			"/kernel": apiTarget,
			"/api": apiTarget
		}
	}
});
