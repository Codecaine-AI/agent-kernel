import { useContext } from "react";

import { workspaceFromPathname } from "@/workspace-paths";
import type { ShellLinkProps } from "@/_components/AppShell";
import { NavigateContext } from "./navigate-context";

export { NavigateContext } from "./navigate-context";

export type WorkspaceLinkProps = ShellLinkProps;

/**
 * The shell's nav link: a real link (it opens in a new tab with a modifier), and a plain
 * click switches the workspace in place through the History API. Module scope, so it
 * keeps one identity across renders.
 */
export function WorkspaceLink({ href, onClick, ...rest }: WorkspaceLinkProps) {
	const navigate = useContext(NavigateContext);
	return (
		<a
			{...rest}
			href={href}
			onClick={(event) => {
				onClick?.(event);
				if (
					event.defaultPrevented ||
					event.button !== 0 ||
					event.metaKey ||
					event.ctrlKey ||
					event.shiftKey ||
					event.altKey
				) {
					return;
				}
				event.preventDefault();
				navigate(workspaceFromPathname(href));
			}}
		/>
	);
}
