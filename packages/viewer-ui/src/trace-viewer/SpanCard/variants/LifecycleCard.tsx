import type { FC } from "react";

interface LifecycleCardProps {
  label: string;
}

export const LifecycleCard: FC<LifecycleCardProps> = ({ label }) => (
  <span className="inline-block rounded border border-status-neutral-border px-2 py-0.5 text-xs font-medium text-status-neutral">
    {label}
  </span>
);
