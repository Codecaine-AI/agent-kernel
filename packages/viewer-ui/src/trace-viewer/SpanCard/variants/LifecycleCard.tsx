import type { FC } from "react";

interface LifecycleCardProps {
  label: string;
}

export const LifecycleCard: FC<LifecycleCardProps> = ({ label }) => (
  <span className="inline-block rounded-[2px] border border-status-neutral-border px-2 py-0.5 text-[13px] font-medium text-foreground">
    {label}
  </span>
);
