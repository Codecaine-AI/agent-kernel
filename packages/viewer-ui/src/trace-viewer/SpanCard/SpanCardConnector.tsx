import cn from "classnames";

export type SpanCardConnectorType =
  | "horizontal"
  | "vertical"
  | "t-right"
  | "corner-top-right"
  | "empty";

interface SpanCardConnectorProps {
  type: SpanCardConnectorType;
}

/**
 * Single source of truth for the connector line paint — the expand guide in
 * SpanCard and the leaf slot continuation reuse it so every tree line stays
 * identical.
 */
export const TREE_LINE_CLASS =
  "bg-[rgb(var(--tree-connector,var(--agentprism-border-subtle))/var(--tree-connector-opacity,0.8))]";

/**
 * Tree connectors — deliberately quiet indent guides. Hairline width and a
 * softened tint keep them below the cards in the visual hierarchy: they aid
 * scanning without competing with content.
 *
 * GEOMETRY CONTRACT: every cell is a FIXED 24px column (w-6 shrink-0 — never
 * grow). Cell k of a row therefore spans x ∈ [k·24, (k+1)·24) with its
 * centerline at k·24 + 12: the same 24px step the content indent derives
 * from ((depth + 1) · 24 with the always-reserved toggle slot), so line
 * positions and content offsets come from one formula. A stretching cell
 * would drift lines off-grid on rows whose toggle slot is empty — the exact
 * bug class the span-indent SSR audit pins.
 *
 *   vertical          — ancestor guide passing through this row (+12px into
 *                       the row gap below, so runs stay continuous)
 *   t-right           — this row's elbow, siblings follow (line continues)
 *   corner-top-right  — last child's elbow: the drop-line terminates at the
 *                       elbow, nothing paints below the centerline
 *   horizontal        — straight continuation across a column (leaf rows
 *                       carry the elbow stub across the empty toggle slot to
 *                       their card edge)
 *   empty             — reserved column, nothing painted
 */
export const SpanCardConnector = ({ type }: SpanCardConnectorProps) => {
  if (type === "empty") {
    return <div data-connector="empty" className="w-6 shrink-0" />;
  }

  return (
    <div
      data-connector={type}
      className="relative w-6 shrink-0 overflow-visible"
    >
      {(type === "vertical" || type === "t-right") && (
        <div
          className={cn(
            TREE_LINE_CLASS,
            "absolute top-0 -bottom-3 left-1/2 z-10 w-px -translate-x-1/2",
          )}
        />
      )}

      {(type === "t-right" || type === "corner-top-right") && (
        <div
          className={cn(
            TREE_LINE_CLASS,
            "absolute left-1/2 top-1/2 h-px w-1/2 -translate-y-1/2",
          )}
        />
      )}

      {type === "horizontal" && (
        <div
          className={cn(
            TREE_LINE_CLASS,
            "absolute inset-x-0 top-1/2 h-px -translate-y-1/2",
          )}
        />
      )}

      {type === "corner-top-right" && (
        <div
          className={cn(
            TREE_LINE_CLASS,
            "absolute left-1/2 top-0 h-1/2 w-px -translate-x-1/2",
          )}
        />
      )}
    </div>
  );
};
