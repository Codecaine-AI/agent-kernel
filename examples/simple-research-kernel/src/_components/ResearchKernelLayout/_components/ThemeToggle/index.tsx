import { Icon } from "@/shared/_components/Icon";

export type ThemeToggleProps = {
	dark: boolean;
	onToggle: () => void;
};

/** The topbar's theme toggle. The theme is the style engine's setting; the parent writes it. */
export function ThemeToggle({ dark, onToggle }: ThemeToggleProps) {
	return (
		<button
			type="button"
			className="ds-shell-icon-button"
			aria-label="Dark theme"
			aria-pressed={dark}
			title="Dark theme"
			onClick={onToggle}
		>
			<Icon name="moon" />
		</button>
	);
}
