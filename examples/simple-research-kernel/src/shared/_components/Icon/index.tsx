import type { ReactNode } from "react";

export type IconName = "research" | "traces" | "agents" | "moon";

export type IconProps = {
	name: IconName;
};

// Nav and topbar glyphs on a 24px grid, after templates/react-app-shell's Icon
// (the agents glyph is its "bot"). The shell sizes the <svg> and strokes it in
// currentColor.
const glyphs: Record<IconName, ReactNode> = {
	research: (
		<>
			<circle cx="10.5" cy="10.5" r="6" />
			<path d="m15 15 5 5" />
		</>
	),
	traces: <path d="M3 12h4l3-7 4 14 3-7h4" />,
	agents: (
		<>
			<rect x="4.5" y="8" width="15" height="11" rx="3" />
			<path d="M12 8V5M10.5 16h3" />
			<circle cx="12" cy="4" r="1" />
			<circle cx="9.5" cy="13" r="1" fill="currentColor" stroke="none" />
			<circle cx="14.5" cy="13" r="1" fill="currentColor" stroke="none" />
		</>
	),
	moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
};

export function Icon({ name }: IconProps) {
	return (
		<svg
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.75}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			{glyphs[name]}
		</svg>
	);
}
