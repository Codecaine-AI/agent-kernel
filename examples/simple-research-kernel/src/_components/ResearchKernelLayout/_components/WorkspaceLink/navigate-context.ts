import { createContext } from "react";

import type { WorkspaceId } from "@/shared/types";

/** The workspace switch that WorkspaceLink calls on a plain click. ResearchKernelLayout provides it. */
export const NavigateContext = createContext<(workspace: WorkspaceId) => void>(() => {});
