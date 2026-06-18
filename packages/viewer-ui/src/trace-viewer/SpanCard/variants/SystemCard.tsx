import type { FC } from "react";

interface SystemCardProps {
  label: string;
}

export const SystemCard: FC<SystemCardProps> = ({ label }) => (
  <span className="inline-block rounded border border-agentprism-badge-chain-foreground px-2 py-0.5 text-xs font-medium text-agentprism-badge-chain-foreground">
    {label}
  </span>
);
