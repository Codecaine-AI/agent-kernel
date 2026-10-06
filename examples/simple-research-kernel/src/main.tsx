import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@codecaine-ai/design-system/fonts.css";
import "@codecaine-ai/design-system/tokens.css";
import "@codecaine-ai/design-system/host-contract.css";
import "@codecaine-ai/design-system/layout.css";
import "@agent-kernel/viewer-ui/styles";
import "./styles.css";
import "@agent-kernel/viewer-shell/styles";
// After every stylesheet above: App's component sheets (styles.css beside each component) load last.
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>
);
