import type { FC } from "react";

interface SystemCardProps {
  label: string;
}

export const SystemCard: FC<SystemCardProps> = ({ label }) => (
  <span className="inline-block rounded-[2px] border border-agentprism-badge-chain-foreground px-2 py-0.5 text-[13px] font-medium text-foreground">
    {label}
  </span>
);
