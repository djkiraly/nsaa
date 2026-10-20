"use client";

import { useState } from "react";

export interface ChartPoint {
  key: string;
  label: string;
  visits: number;
  visitors: number;
}

/** Round the axis top up to a clean number (1, 2, 5 × 10^n). */
function niceMax(v: number): number {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

/**
 * Visits over time: one series, so no legend — the card title names it. Columns ≤ 24px with 4px rounded tops on a
 * single baseline, 2px gaps, hairline grid; each column is its own hover/focus target with a tooltip, and the
 * same numbers are in the table view below.
 */
export function VisitsChart({ points }: { points: ChartPoint[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...points.map((p) => p.visits)));
  const ticks = [max, max / 2, 0];
  const labelAt = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]);
  const a = active !== null ? points[active] : null;

  return (
    <div>
      <div className="flex gap-2">
        <div className="flex h-44 flex-col justify-between text-[11px] text-muted tabular text-right w-7 -mt-1.5 -mb-1.5">
          {ticks.map((t) => (
            <span key={t}>{t.toLocaleString()}</span>
          ))}
        </div>
        <div className="relative flex-1 min-w-0">
          {/* hairline grid at the ticks */}
          <div className="pointer-events-none absolute inset-0 flex h-44 flex-col justify-between">
            {ticks.map((t) => (
              <div key={t} className="h-px bg-border" />
            ))}
          </div>
          <div className="relative flex h-44 items-end gap-[2px]" onMouseLeave={() => setActive(null)}>
            {points.map((p, i) => (
              <button
                key={p.key}
                type="button"
                className="group flex h-full flex-1 min-w-0 items-end justify-center outline-none"
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                aria-label={`${p.label}: ${p.visits} visits, ${p.visitors} visitors`}
              >
                {p.visits > 0 && (
                  <span
                    className="block w-full max-w-6 rounded-t-[4px] bg-chart transition-opacity group-hover:opacity-75 group-focus-visible:opacity-75"
                    style={{ height: `${(100 * p.visits) / max}%` }}
                  />
                )}
              </button>
            ))}
          </div>
          {a && (
            <div
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border bg-card px-2.5 py-1.5 text-xs shadow-sm"
              // centered on the column, but kept inside the card at the edges
              style={{ left: `${Math.min(88, Math.max(12, ((active! + 0.5) / points.length) * 100))}%` }}
            >
              <div className="font-semibold text-foreground">{a.visits.toLocaleString()} visits</div>
              <div className="text-muted">
                {a.visitors.toLocaleString()} visitors · {a.label}
              </div>
            </div>
          )}
          <div className="relative mt-1.5 h-4 text-[11px] text-muted">
            {points.map((p, i) =>
              labelAt.has(i) ? (
                <span
                  key={p.key}
                  className="absolute whitespace-nowrap"
                  style={
                    i === 0
                      ? { left: 0 }
                      : i === points.length - 1
                        ? { right: 0 }
                        : { left: `${((i + 0.5) / points.length) * 100}%`, transform: "translateX(-50%)" }
                  }
                >
                  {p.label}
                </span>
              ) : null,
            )}
          </div>
        </div>
      </div>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted">Table view</summary>
        <table className="mt-2 w-full tabular">
          <thead>
            <tr className="text-muted text-left">
              <th className="py-1 font-medium">When</th>
              <th className="py-1 font-medium text-right">Visits</th>
              <th className="py-1 font-medium text-right">Visitors</th>
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((p) => (
              <tr key={p.key} className="border-t border-border/60">
                <td className="py-1">{p.label}</td>
                <td className="py-1 text-right">{p.visits.toLocaleString()}</td>
                <td className="py-1 text-right">{p.visitors.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
