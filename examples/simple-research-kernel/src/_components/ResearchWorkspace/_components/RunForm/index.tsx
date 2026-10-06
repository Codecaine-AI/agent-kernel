import { useState, type FormEvent, type KeyboardEvent } from "react";

import "./styles.css";

export type RunFormProps = {
	startingRun: boolean;
	onStartRun: (prompt: string) => void | Promise<void>;
};

/** The research prompt and the Start button. Mod+Enter in the prompt submits too. */
export function RunForm({ startingRun, onStartRun }: RunFormProps) {
	const [prompt, setPrompt] = useState(
		"Research the next step for turning this simple kernel into a richer agent experience."
	);

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const trimmed = prompt.trim();
		if (!trimmed || startingRun) return;
		void onStartRun(trimmed);
	}

	function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
		event.preventDefault();
		event.currentTarget.form?.requestSubmit();
	}

	return (
		<form
			onSubmit={handleSubmit}
			aria-busy={startingRun}
			className="border-b border-border bg-background/35 p-4"
		>
			<div className="grid gap-3">
				<textarea
					aria-label="Research prompt"
					value={prompt}
					onChange={(event) => setPrompt(event.target.value)}
					onKeyDown={handlePromptKeyDown}
					className="research-prompt-input w-full min-w-0 resize-none rounded border border-border bg-background px-3 py-2 text-ui-lg leading-[var(--ds-space-5)] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
					placeholder="Research prompt"
				/>
				<button
					type="submit"
					disabled={startingRun || prompt.trim().length === 0}
					className="flex h-10 w-full min-w-0 items-center justify-center rounded border border-accent/60 bg-accent px-3 text-ui-lg font-bold leading-none text-accent-foreground transition-colors hover:border-accent hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55"
				>
					{startingRun ? "Starting Run" : "Start Research Run"}
				</button>
			</div>
		</form>
	);
}
