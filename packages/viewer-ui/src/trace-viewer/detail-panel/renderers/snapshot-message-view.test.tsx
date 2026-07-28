import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ContentBlock } from "./snapshot-message-view";

describe("image elision placeholder", () => {
	test("renders the complete kernel marker as quiet text without source chrome", () => {
		const marker = "[image elided — image/png, 79.7 KB]";
		const markup = renderToStaticMarkup(
			<ContentBlock
				block={{ type: "text", text: marker }}
				apiBase="http://localhost:4319"
				dataText
				dataCaption="Tool result"
			/>,
		);

		expect(markup).toContain('data-image-elision-placeholder=""');
		expect(markup).toContain("text-muted-foreground/70");
		expect(markup).toContain(marker);
		expect(markup).not.toContain("data-doc-figure");
		expect(markup).not.toContain("data-doc-line-number");
		expect(markup).not.toContain("data-doc-gutter");
	});

	test("does not classify prose that merely contains the marker", () => {
		const markup = renderToStaticMarkup(
			<ContentBlock
				block={{
					type: "text",
					text: "provider returned [image elided — image/png, 79.7 KB]",
				}}
				apiBase="http://localhost:4319"
				dataText
				dataCaption="Tool result"
			/>,
		);

		expect(markup).not.toContain("data-image-elision-placeholder");
		expect(markup).toContain("data-doc-figure");
	});
});
