import type { FC } from "react";

interface ContainerCardProps {
  label: string;
}

export const ContainerCard: FC<ContainerCardProps> = ({ label }) => (
  <span className="inline-block rounded-[2px] border border-trace-container px-2 py-0.5 text-[13px] font-medium tracking-wide text-foreground">
    {label}
  </span>
);
