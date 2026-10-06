import { AlertTriangle } from "lucide-react";
import type { RendererProps } from "../types";
import type { DetailView } from "../contract";
import { readStringAttr } from "../../span-style";

function parseVerificationMessage(message: string) {
  const lines = message.split("\n").filter((l) => l.length > 0);
  const headline = lines[0] ?? message;
  const details: { label: string; value: string }[] = [];

  for (const line of lines.slice(1)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      details.push({
        label: line.slice(0, colonIdx).trim(),
        value: line.slice(colonIdx + 1).trim(),
      });
    }
  }

  return { headline, details };
}

function CheckBadge({ name, passed }: { name: string; passed: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[length:var(--ds-font-size-ui-xs)] font-medium ${
        passed
          ? "bg-status-success-fill text-status-success"
          : "bg-destructive/10 text-destructive"
      }`}
    >
      {name}
      <span className="ml-1">{passed ? "pass" : "FAIL"}</span>
    </span>
  );
}

function parseChecks(message: string): { name: string; passed: boolean }[] {
  const checksMatch = message.match(/Checks:\s*(.+)$/m);
  if (!checksMatch) return [];
  return checksMatch[1].split(",").map((c) => {
    const [name, result] = c.trim().split("=");
    return { name: name.trim(), passed: result?.trim() === "pass" };
  });
}

export function WarningRenderer({ span }: RendererProps): DetailView {
  const warningType = readStringAttr(span, "warning_type");
  const message = readStringAttr(span, "message") ?? "";
  const { headline, details } = parseVerificationMessage(message);
  const checks = parseChecks(message);

  const typeLabel = warningType?.replace(/_/g, " ") ?? "warning";
  const warningLabel = `${typeLabel.charAt(0).toUpperCase()}${typeLabel.slice(1)}`;
  return {
    blocks: [{
      id: "warning",
      slot: "content",
      caption: warningLabel,
      node: <div className="space-y-4">
      <div className="flex items-start gap-2.5 rounded-[var(--ds-radius-base)] border border-status-warning-border bg-status-warning-fill/30 p-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" />
        <div className="space-y-1 min-w-0">
          <div className="text-[length:var(--ds-font-size-ui-xs)] font-medium uppercase tracking-[var(--ds-letter-spacing-micro)] text-status-warning">
            {typeLabel}
          </div>
          <p className="text-[length:var(--ds-font-size-ui-lg)] font-medium">{headline}</p>
        </div>
      </div>

      {checks.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-[length:var(--ds-font-size-micro)] font-semibold text-muted-foreground uppercase tracking-[var(--ds-letter-spacing-micro-wide)]">
            Checks
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {checks.map((c) => (
              <CheckBadge key={c.name} name={c.name} passed={c.passed} />
            ))}
          </div>
        </div>
      )}

      {details.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-[length:var(--ds-font-size-micro)] font-semibold text-muted-foreground uppercase tracking-[var(--ds-letter-spacing-micro-wide)]">
            Details
          </h4>
          <div className="rounded-[var(--ds-radius-base)] bg-muted/30 p-3 space-y-1">
            {details.map((d) => (
              <div key={d.label} className="flex gap-2 text-[length:var(--ds-font-size-ui-xs)] font-sans">
                <span className="text-muted-foreground shrink-0">
                  {d.label}:
                </span>
                <span className="break-all">{d.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      </div>,
    }],
  };
}
