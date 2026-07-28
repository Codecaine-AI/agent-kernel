/** Shared caption/section-label typography for the detail panel. */
export const SECTION_LABEL_CLASS =
	"text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.08em]";

/**
 * Caption typography for figures nested inside a parent section — THINKING,
 * TOOL CALL, TOOL RESULT inside a message card.
 *
 * Subordinate, not faint. Ford asked for a step more contrast so the inner
 * cards separate cleanly on the page ("I'd like the border and the text a
 * little brighter so they have more separation"), so this sits at full
 * muted-foreground rather than 70% of it. The tier gap is narrowed, never
 * inverted: still a step smaller and a weight lighter than SECTION_LABEL_CLASS,
 * and still neutral under a role-colored tier-1 row.
 */
export const SUBORDINATE_SECTION_LABEL_CLASS =
	"text-[10px] font-medium text-muted-foreground uppercase tracking-[0.1em]";

/**
 * Frame color for a subordinate figure, one step up from the top tier's
 * `border-border/60` hairline for the same reason. Token-only, both themes.
 */
export const SUBORDINATE_FIGURE_BORDER_CLASS = "border-border";
