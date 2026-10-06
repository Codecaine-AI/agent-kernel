/**
 * Trace-card typography — the ONLY three type sizes any card uses.
 *
 * The trace viewer speaks one voice: machine mono, matching the tree labels.
 * Prose bodies used to sneak in the sans/prose stack (font inherited from the
 * layout) at ad-hoc sizes; everything is unified here so a message body and a
 * tool label read as the same typeface at deliberate sizes.
 *
 *   LABEL — card titles and single-line card text (every tree row — one size).
 *   BODY  — multi-line message content.
 *   META  — secondary inline chips INSIDE a row (tool detail, dispatch chips);
 *           never a row's own size — rows are uniform.
 *
 * All three pin `font-mono`. Nothing else in the trace viewer should set a size
 * on card text. Sizes are design-system tokens (font.size.code 13px,
 * font.size.ui-2xs 11px); BODY's line box is line-height.code (21px).
 *
 * LABEL and META carry their line boxes as inline styles (CARD_LINE_LABEL,
 * CARD_LINE_META) because no token equals them and the corner cap is built
 * around them: an inline row is the 18px label line plus 2 × 2px padding
 * (TraceCard `py-0.5`), which is the 22px cap (SPAN_CAP_SIZE); a META chip is
 * its 14px line plus 2 × 2px padding, so it fits inside the label line. Pair
 * each class with its line style.
 */
import type { CSSProperties } from "react";

/** Card titles / single-line card content. Pair with CARD_LINE_LABEL. */
export const CARD_TYPE_LABEL = "font-mono text-[length:var(--ds-font-size-code)]";

/** Kept geometry (no equal token): the 18px label line box the 22px cap is sized to. */
export const CARD_LINE_LABEL: CSSProperties = { lineHeight: "18px" };

/** Multi-line message body content. */
export const CARD_TYPE_BODY = "font-mono text-[length:var(--ds-font-size-code)] leading-[var(--ds-line-height-code)]";

/** Secondary inline chips inside a row — smallest, muted tier. Pair with CARD_LINE_META. */
export const CARD_TYPE_META = "font-mono text-[length:var(--ds-font-size-ui-2xs)]";

/** Kept geometry (no equal token): the 14px META line box (a 2px-padded chip fits the 18px label line). */
export const CARD_LINE_META: CSSProperties = { lineHeight: "14px" };

/** Kept geometry: boxed message cards (TraceCard size "box") cap at 90% of the tree row. */
export const CARD_FRAME_BOX: CSSProperties = { maxWidth: "90%" };
