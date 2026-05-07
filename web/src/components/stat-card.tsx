import type { CSSProperties } from "react";

export function StatCard({
  label,
  value,
  progress,
  tone = "green",
}: {
  label: string;
  value: string | number;
  progress?: number;
  tone?: "blue" | "green" | "red";
}) {
  const normalizedProgress =
    typeof progress === "number" ? Math.max(0, Math.min(100, progress)) : null;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="text-sm text-neutral-600">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-neutral-950">
        {value}
      </div>
      {normalizedProgress !== null ? (
        <div className="mt-4 progress-track" aria-hidden="true">
          <div
            className="progress-fill"
            data-tone={tone}
            style={
              {
                "--progress": normalizedProgress / 100,
              } as CSSProperties
            }
          />
        </div>
      ) : null}
    </div>
  );
}
