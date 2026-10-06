/** @type {import('tailwindcss').Config} */
module.exports = {
	// The design-system preset (decision 3): its utilities read --ds-* from tokens.css, and it removes
	// Tailwind's default palette and scales. budget's kernel view spreads this config, so it inherits
	// the preset too and must load fonts.css, tokens.css and host-contract.css as well.
	presets: [require("@codecaine-ai/design-system/tailwind-v3-preset")],
	content: [
		"./index.html",
		"./src/**/*.{ts,tsx}",
		"../../packages/viewer-shell/src/**/*.{ts,tsx}",
		"../../packages/viewer-ui/src/**/*.{ts,tsx}",
		// The prompt-authoring UI lives in the sibling prompt-kit checkout and
		// reaches this app through a workspace:* dep; Tailwind never scans
		// node_modules, so its source is named explicitly or the prompt lab
		// renders naked.
		"../../../prompt-kit/packages/prompt-kit/src/**/*.{ts,tsx}"
	],
	theme: {
		extend: {
			fontFamily: {
				// Panel titles (font-display) take the design-system sans by role; the old display
				// stack (Bank Gothic, Eurostile, Michroma) was never loaded. font-sans and font-mono
				// come from the preset: Inter and IBM Plex Mono, loaded by fonts.css.
				display: "var(--ds-font-family-sans)"
			},
			// The agent-viewer host contract, as RGB triplets: host-contract.css maps each name to a
			// design-system token in both themes.
			colors: {
				background: "rgb(var(--background) / <alpha-value>)",
				foreground: "rgb(var(--foreground) / <alpha-value>)",
				card: "rgb(var(--card) / <alpha-value>)",
				"card-foreground": "rgb(var(--card-foreground) / <alpha-value>)",
				muted: "rgb(var(--muted) / <alpha-value>)",
				"muted-foreground": "rgb(var(--muted-foreground) / <alpha-value>)",
				border: "rgb(var(--border) / <alpha-value>)",
				input: "rgb(var(--input) / <alpha-value>)",
				ring: "rgb(var(--ring) / <alpha-value>)",
				accent: "rgb(var(--accent) / <alpha-value>)",
				"accent-foreground": "rgb(var(--accent-foreground) / <alpha-value>)",
				destructive: "rgb(var(--destructive) / <alpha-value>)",
				"trace-container": "rgb(var(--trace-container) / <alpha-value>)",
				"trace-orchestration": "rgb(var(--trace-orchestration) / <alpha-value>)",
				"trace-user": "rgb(var(--trace-user) / <alpha-value>)",
				"trace-assistant": "rgb(var(--trace-assistant) / <alpha-value>)",
				"trace-tool": "rgb(var(--trace-tool) / <alpha-value>)",
				"trace-lifecycle": "rgb(var(--trace-lifecycle) / <alpha-value>)",
				"trace-meta": "rgb(var(--trace-meta) / <alpha-value>)",
				"status-neutral": "rgb(var(--status-neutral) / <alpha-value>)",
				"status-neutral-fill": "rgb(var(--status-neutral-fill) / <alpha-value>)",
				"status-neutral-border": "rgb(var(--status-neutral-border) / <alpha-value>)",
				"status-info": "rgb(var(--status-info) / <alpha-value>)",
				"status-info-fill": "rgb(var(--status-info-fill) / <alpha-value>)",
				"status-info-border": "rgb(var(--status-info-border) / <alpha-value>)",
				"status-success": "rgb(var(--status-success) / <alpha-value>)",
				"status-success-fill": "rgb(var(--status-success-fill) / <alpha-value>)",
				"status-success-border": "rgb(var(--status-success-border) / <alpha-value>)",
				"status-warning": "rgb(var(--status-warning) / <alpha-value>)",
				"status-warning-fill": "rgb(var(--status-warning-fill) / <alpha-value>)",
				"status-warning-border": "rgb(var(--status-warning-border) / <alpha-value>)",
				"syntax-key": "rgb(var(--syntax-key) / <alpha-value>)",
				"syntax-string": "rgb(var(--syntax-string) / <alpha-value>)",
				"syntax-number": "rgb(var(--syntax-number) / <alpha-value>)",
				"syntax-boolean": "rgb(var(--syntax-boolean) / <alpha-value>)",
				agentprism: {
					background: "rgb(var(--agentprism-background) / <alpha-value>)",
					foreground: "rgb(var(--agentprism-foreground) / <alpha-value>)",
					muted: "rgb(var(--agentprism-muted) / <alpha-value>)",
					"muted-foreground": "rgb(var(--agentprism-muted-foreground) / <alpha-value>)",
					"border-subtle": "rgb(var(--agentprism-border-subtle) / <alpha-value>)",
					"code-base": "rgb(var(--agentprism-code-base) / <alpha-value>)",
					"badge-agent-foreground": "rgb(var(--agentprism-badge-agent-foreground) / <alpha-value>)",
					"badge-chain-foreground": "rgb(var(--agentprism-badge-chain-foreground) / <alpha-value>)",
					"badge-llm-foreground": "rgb(var(--agentprism-badge-llm-foreground) / <alpha-value>)",
					"badge-tool-foreground": "rgb(var(--agentprism-badge-tool-foreground) / <alpha-value>)"
				}
			}
		}
	}
};
