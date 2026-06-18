import type { FC } from "react";

interface ContainerCardProps {
  label: string;
}

export const ContainerCard: FC<ContainerCardProps> = ({ label }) => (
  <span className="inline-block rounded border border-trace-container px-2 py-0.5 text-xs font-medium tracking-wide text-trace-container">
    {label}
  </span>
);
