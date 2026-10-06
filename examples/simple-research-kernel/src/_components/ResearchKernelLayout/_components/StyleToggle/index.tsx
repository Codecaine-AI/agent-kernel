import type { RefObject } from "react";

export type StyleToggleProps = {
	open: boolean;
	toggleRef: RefObject<HTMLButtonElement | null>;
	onOpen: () => void;
	onClose: () => void;
};

/** The topbar's Style button: opens and closes the style inspector, which returns focus here. */
export function StyleToggle({ open, toggleRef, onOpen, onClose }: StyleToggleProps) {
	return (
		<button
			ref={toggleRef}
			type="button"
			className="ds-shell-button"
			aria-expanded={open}
			aria-controls="ds-inspector"
			onClick={open ? onClose : onOpen}
		>
			Style
		</button>
	);
}
