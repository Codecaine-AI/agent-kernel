"use client";

/**
 * DocFigure — a framed, syntax-colored source figure for prompts, rendered
 * context, state, and other byte-significant detail-panel documents.
 *
 * Every figure is byte-exact and unwrapped. Long logical lines scroll inside
 * the figure rather than widening the detail panel. Source/data figures use
 * prompt-kit's shared gutter, zebra, metrics, and palette by default; the
 * language selects the lossless syntax highlighter.
 */
import {
	Fragment,
	isValidElement,
	useMemo,
	type CSSProperties,
	type JSX,
	type ReactNode,
} from "react";
import cn from "classnames";
import {
	EDITOR_COLORS,
	EDITOR_METRICS,
	PROMPT_EDITOR_ROOT_CLASS,
	editorRuleBackground,
	highlightXmlLine,
	promptEditorGutterWidth,
} from "@codecaine-ai/prompt-kit/ui/surface";

import { dedent as dedentSource } from "../renderers/state-block";
import {
	SECTION_LABEL_CLASS,
	SUBORDINATE_FIGURE_BORDER_CLASS,
	SUBORDINATE_SECTION_LABEL_CLASS,
} from "../section-label";
import { Clamped } from "./Clamped";
import { CLAMP, shouldClamp, type ClampPolicy } from "./clamp";
import {
	tokenize,
	type DocLanguage,
	type Token,
	type TokenType,
} from "./tokenize";

/**
 * A presentation-only row placed BETWEEN two source lines — the way attached
 * renders sit at their `<views>` reference inside the state document instead of
 * beside it as a second card.
 *
 * It is not source: it has no line number, it contributes no bytes, and the
 * document's text still reconstructs the payload exactly. The gutter continues
 * past it and the row shares the editor substrate, so it reads as part of the
 * document rather than an interruption of it.
 */
export interface DocInlineRow {
	/** 1-based source line this row follows. Rows past the end pin to the end. */
	afterLine: number;
	/** Quiet inline attribution, e.g. "Attached renders · kernel". */
	label?: string;
	node: ReactNode;
}

export interface DocFigureProps {
	/** Small caption header, left. e.g. "System prompt", "State", "Rendered context". */
	caption: string;
	/** Caption hierarchy. Nested message blocks use the quieter subordinate tier. */
	captionTier?: "top" | "subordinate";
	/** The source text. Rendered byte-for-byte; never reformatted. */
	body: string;
	language?: DocLanguage;
	clamp?: ClampPolicy;
	/**
	 * Render with the shared line-number gutter + zebra substrate (default true).
	 * Set false only for a figure that is genuinely not source/data content.
	 */
	gutter?: boolean;
	/** Shell callback used by long clamped previews. */
	onOpenModal?: () => void;
	/** Shell-only: an enclosing disclosure or modal already owns the caption. */
	hideCaption?: boolean;
	/**
	 * Explicit display-only normalization for authored literals (default false).
	 * Event data must leave this false so rendered text remains byte-exact.
	 */
	dedent?: boolean;
	/** Non-source rows embedded in the document flow at their reference lines. */
	inlineRows?: readonly DocInlineRow[];
	className?: string;
}

/** The shared section-label class used by the figure caption and peer sections. */
export const DocFigureCaption = SECTION_LABEL_CLASS;

/** The shared label class for figures nested beneath a parent identity header. */
export const DocFigureSubordinateCaption = SUBORDINATE_SECTION_LABEL_CLASS;

/** Frame + divider color per caption tier. Subordinate reads one step brighter. */
const TIER_BORDER = {
	top: "border-border/60",
	subordinate: SUBORDINATE_FIGURE_BORDER_CLASS,
} as const;

const TOKEN_CLASS: Record<TokenType, string | undefined> = {
	text: undefined,
	punct: "text-muted-foreground/70",
	tagName: "text-syntax-key",
	attrName: "text-syntax-number",
	attrValue: "text-syntax-string",
	comment: "text-muted-foreground/70 italic",
	key: "text-syntax-key",
	string: "text-syntax-string",
	number: "text-syntax-number",
	literal: "text-syntax-boolean",
	heading: "text-foreground font-semibold",
	emphasis: "text-foreground font-semibold",
};

const PROMPT_TOKEN_STYLE: Partial<Record<TokenType, CSSProperties>> = {
	punct: { color: EDITOR_COLORS.syntaxPunctuation },
	tagName: { color: EDITOR_COLORS.syntaxTag, fontWeight: 500 },
	attrName: { color: EDITOR_COLORS.syntaxAttribute },
	attrValue: { color: EDITOR_COLORS.syntaxValue },
};

const BODY_CLASS =
	"min-w-0 max-w-full overflow-x-auto bg-muted/30 p-3 text-xs leading-relaxed font-mono text-foreground";

/**
 * Keep prompt-kit's exact pre-token result as the fallback. The indirection is
 * intentional: `--doc-figure-token-zebra` becomes invalid when either host
 * token is absent, so CSS selects the legacy expression (including its
 * theme-aware `--editor-rule`) rather than partially applying a new palette.
 */
const TOKEN_ZEBRA_BACKGROUND =
	"rgb(var(--zebra-color) / var(--zebra-opacity))";
const LEGACY_ZEBRA_BACKGROUND =
	"color-mix(in srgb, var(--prompt-editor-rule, var(--editor-rule, rgb(255 255 255 / 0.025))) calc(var(--prompt-editor-show-zebra, 1) * 100%), transparent)";
const ZEBRA_BACKGROUND = `var(--doc-figure-token-zebra, ${LEGACY_ZEBRA_BACKGROUND})`;

function tokenNodes(tokens: Token[], keyPrefix: string): ReactNode[] {
	return tokens.map((token, index) => (
		<span
			key={`${keyPrefix}-${index}`}
			className={TOKEN_CLASS[token.type]}
		>
			{token.value}
		</span>
	));
}

function promptTokenNodes(tokens: Token[], keyPrefix: string): ReactNode[] {
	return tokens.map((token, index) => (
		<span
			key={`${keyPrefix}-${index}`}
			style={PROMPT_TOKEN_STYLE[token.type]}
		>
			{token.value}
		</span>
	));
}

function reactNodeText(node: ReactNode): string {
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(reactNodeText).join("");
	if (isValidElement<{ children?: ReactNode }>(node)) {
		return reactNodeText(node.props.children);
	}
	return "";
}

/**
 * prompt-kit's highlighter is the visual source of truth, but older helper
 * versions normalize a few unusual tag spellings (for example `<tag/>` to
 * `<tag />`). Fall back to the same surface palette over our lossless tokens
 * when that would alter the displayed source.
 */
function promptSourceNodes(line: string, index: number): ReactNode {
	const highlighted = highlightXmlLine(line);
	return reactNodeText(highlighted) === line
		? highlighted
		: promptTokenNodes(tokenize(line, "prompt"), `prompt-line-${index}`);
}

function ExactSource({
	tokens,
	maxHeight,
}: {
	tokens: Token[];
	maxHeight?: string;
}): JSX.Element {
	return (
		<pre
			data-doc-body=""
			{...(maxHeight ? { "data-doc-scroll": "" } : {})}
			className={cn(
				BODY_CLASS,
				"whitespace-pre",
				maxHeight && "overflow-y-auto",
			)}
			style={{ tabSize: 2, ...(maxHeight ? { maxHeight } : {}) }}
		>
			{tokenNodes(tokens, "exact")}
		</pre>
	);
}

function GutterSource({
	source,
	language,
	inlineRows,
	maxHeight,
}: {
	source: string;
	language: DocLanguage;
	inlineRows?: readonly DocInlineRow[];
	/**
	 * Bounds the figure into a reading window. It goes on THIS element — the one
	 * that already scrolls horizontally — so both scrollbars sit on the window's
	 * own edges instead of the vertical one being stranded below the fold.
	 */
	maxHeight?: string;
}): JSX.Element {
	const lines = source.split("\n");
	const lineNumberWidth = Math.max(2, String(lines.length).length);
	const gutterWidth = promptEditorGutterWidth(`${lineNumberWidth + 2}ch`);
	// Rows are keyed by the line they follow, clamped into range so a reference
	// past the end still lands at the document's foot instead of vanishing.
	const rowsAfterLine = new Map<number, DocInlineRow[]>();
	for (const row of inlineRows ?? []) {
		const at = Math.min(Math.max(row.afterLine, 1), lines.length);
		const bucket = rowsAfterLine.get(at);
		if (bucket) bucket.push(row);
		else rowsAfterLine.set(at, [row]);
	}

	return (
		<div
			data-doc-body=""
			data-doc-gutter=""
			{...(maxHeight ? { "data-doc-scroll": "" } : {})}
			className={cn(
				PROMPT_EDITOR_ROOT_CLASS,
				"min-w-0 max-w-full overflow-x-auto whitespace-pre",
				maxHeight && "overflow-y-auto",
			)}
			style={{
				backgroundColor: EDITOR_COLORS.bg,
				color: EDITOR_COLORS.fg,
				...editorRuleBackground,
				...(maxHeight ? { maxHeight } : {}),
			}}
		>
			<table
				className="w-max min-w-full table-auto border-separate border-spacing-0"
				style={{
					fontFamily: EDITOR_METRICS.fontFamily,
					fontSize: EDITOR_METRICS.fontSize,
					lineHeight: EDITOR_METRICS.lineHeight,
					letterSpacing: EDITOR_METRICS.letterSpacing,
					maxWidth: EDITOR_METRICS.contentWidth,
				}}
			>
				<tbody>
					{lines.map((line, index) => (
						<Fragment key={index}>
						<tr
							className="prompt-editor-row"
							style={
								{
									"--doc-figure-token-zebra":
										TOKEN_ZEBRA_BACKGROUND,
									"--prompt-editor-row-zebra":
										index % 2 === 0 ? undefined : ZEBRA_BACKGROUND,
									height: EDITOR_METRICS.lineHeight,
								} as CSSProperties
							}
						>
							<td
								aria-hidden="true"
								data-doc-line-number=""
								className="sticky left-0 z-10 select-none bg-[var(--prompt-editor-bg,var(--editor-bg))] px-3 text-right align-top tabular-nums"
								style={{
									minWidth: gutterWidth,
									width: gutterWidth,
									backgroundColor: EDITOR_COLORS.bg,
									backgroundImage: `linear-gradient(var(--prompt-editor-row-zebra, transparent), var(--prompt-editor-row-zebra, transparent)), ${editorRuleBackground.backgroundImage}`,
									backgroundPosition: editorRuleBackground.backgroundPosition,
									color: EDITOR_COLORS.lineNumber,
									userSelect: "none",
								}}
							>
								{index + 1}
							</td>
							<td
								data-doc-source-line=""
								className="w-full whitespace-pre pl-3 pr-4 align-top"
								style={{ background: "transparent" }}
							>
								{line === ""
									? null
									: language === "prompt"
										? promptSourceNodes(line, index)
										: tokenNodes(
												tokenize(line, language),
												`gutter-line-${index}`,
											)}
							</td>
						</tr>
						{(rowsAfterLine.get(index + 1) ?? []).map((row, rowIndex) => (
							<tr
								key={`inline-${rowIndex}`}
								data-doc-inline-row=""
								className="prompt-editor-row"
							>
								{/* No line number: this row is not a line. The gutter cell
								    still renders so the substrate runs unbroken past the
								    embedded content instead of notching around it. */}
								<td
									aria-hidden="true"
									data-doc-inline-gutter=""
									className="sticky left-0 z-10 select-none px-3 align-top"
									style={{
										minWidth: gutterWidth,
										width: gutterWidth,
										backgroundColor: EDITOR_COLORS.bg,
										userSelect: "none",
									}}
								/>
								<td
									data-doc-inline-content=""
									className="w-full whitespace-normal py-2 pl-3 pr-4 align-top"
									style={{ background: "transparent" }}
								>
									{row.label ? (
										<div
											data-doc-inline-label=""
											className={cn(
												DocFigureSubordinateCaption,
												"mb-1.5 block",
											)}
										>
											{row.label}
										</div>
									) : null}
									{row.node}
								</td>
							</tr>
						))}
						</Fragment>
					))}
				</tbody>
			</table>
		</div>
	);
}

export function DocFigure({
	caption,
	captionTier = "top",
	body,
	language = "text",
	clamp = CLAMP.block,
	gutter = true,
	onOpenModal,
	hideCaption = false,
	dedent = false,
	inlineRows,
	className,
}: DocFigureProps): JSX.Element {
	const source = useMemo(
		() => (dedent ? dedentSource(body) : body),
		[body, dedent],
	);
	const tokens = useMemo(() => tokenize(source, language), [source, language]);
	const lineCount = useMemo(() => source.split("\n").length, [source]);
	// One overflow question, two answers: a preview fades and offers the modal,
	// a window keeps every line and scrolls. Both still offer the caption's ⤢.
	const overflows = shouldClamp(clamp, lineCount, source.length);
	const needsClamp = overflows;
	const windowHeight =
		clamp.windowed === true && overflows
			? (clamp.maxHeight ?? `${clamp.maxHeightPx}px`)
			: undefined;

	return (
		<figure
			data-doc-figure=""
			data-doc-language={language}
			className={cn(
				"min-w-0 max-w-full rounded-md border",
				TIER_BORDER[captionTier],
				className,
			)}
		>
			{hideCaption ? null : (
				<figcaption
					data-doc-caption-tier={captionTier}
					className={cn(
						"flex min-w-0 items-center gap-2 border-b bg-muted/20 px-3 py-2",
						TIER_BORDER[captionTier],
					)}
				>
					<span
						className={
							captionTier === "subordinate"
								? DocFigureSubordinateCaption
								: DocFigureCaption
						}
					>
						{caption}
					</span>
					{needsClamp && onOpenModal ? (
						<button
							type="button"
							data-detail-modal-trigger=""
							aria-label={`Expand ${caption}`}
							onClick={onOpenModal}
							className="ml-auto grid size-6 shrink-0 place-items-center rounded-[3px] font-mono text-sm leading-none text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-status-info-border"
						>
							<span aria-hidden="true">⤢</span>
						</button>
					) : null}
				</figcaption>
			)}
			{windowHeight === undefined ? (
				<Clamped
					policy={clamp}
					lineCount={lineCount}
					charCount={source.length}
				>
					{gutter ? (
						<GutterSource
							source={source}
							language={language}
							inlineRows={inlineRows}
						/>
					) : (
						<ExactSource tokens={tokens} />
					)}
				</Clamped>
			) : gutter ? (
				<GutterSource
					source={source}
					language={language}
					inlineRows={inlineRows}
					maxHeight={windowHeight}
				/>
			) : (
				<ExactSource tokens={tokens} maxHeight={windowHeight} />
			)}
		</figure>
	);
}
