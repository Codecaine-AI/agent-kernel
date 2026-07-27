/**
 * Trace-card typography — the ONLY three type sizes any card uses.
 *
 * The trace viewer speaks one voice: machine mono, matching the tree labels.
 * Prose bodies used to sneak in the sans/prose stack (font inherited from the
 * layout) at ad-hoc sizes; everything is unified here so a message body and a
 * tool label read as the same typeface at deliberate sizes.
 *
 *   LABEL — card titles and single-line card text (tool/agent/lifecycle…).
 *   BODY  — multi-line message content.
 *   META  — info/debug mini-cards; the smallest, muted tier.
 *
 * All three pin `font-mono`. Nothing else in the trace viewer should set a size
 * on card text.
 */

/** Card titles / single-line card content. */
export const CARD_TYPE_LABEL = "font-mono text-[13px] leading-[18px]";

/** Multi-line message body content. */
export const CARD_TYPE_BODY = "font-mono text-[13px] leading-relaxed";

/** Info / debug mini-card text — smallest, muted tier. */
export const CARD_TYPE_META = "font-mono text-[11px] leading-[14px]";
