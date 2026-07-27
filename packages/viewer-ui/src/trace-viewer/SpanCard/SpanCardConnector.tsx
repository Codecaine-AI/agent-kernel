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
 * Tree connectors — deliberately quiet indent guides. Hairline width and a
 * softened tint keep them below the cards in the visual hierarchy: they aid
 * scanning without competing with content.
 */
export const SpanCardConnector = ({ type }: SpanCardConnectorProps) => {
  if (type === "empty") return <div className="w-6 shrink-0 grow" />;

  return (
    <div className="relative w-6 shrink-0 grow overflow-visible">
      {(type === "vertical" || type === "t-right") && (
        <div className="bg-agentprism-border-subtle/80 absolute top-0 -bottom-3 left-1/2 z-10 w-px -translate-x-1/2" />
      )}

      {type === "t-right" && (
        <div className="bg-agentprism-border-subtle/80 absolute left-1/2 top-1/2 h-px w-1/2 -translate-y-1/2" />
      )}

      {type === "corner-top-right" && (
        <>
          <div className="bg-agentprism-border-subtle/80 absolute left-1/2 top-1/2 h-px w-1/2 -translate-y-1/2" />

          <div className="bg-agentprism-border-subtle/80 absolute left-1/2 top-0 h-1/2 w-px -translate-x-px" />
        </>
      )}
    </div>
  );
};
