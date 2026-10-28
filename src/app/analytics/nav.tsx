import Link from "next/link";
import { cn } from "@/components/ui";
import { RANGES, type RangeKey } from "@/lib/analytics/queries";

const PAGES = [
  { href: "/analytics", label: "Overview" },
  { href: "/analytics/sessions", label: "Visits" },
  { href: "/analytics/chats", label: "Conversations" },
];

/** Section links and, when the page has one, the time-range filter. Keeps the range across sections. */
export function AnalyticsNav({ current, range }: { current: string; range?: RangeKey }) {
  const q = range && range !== "7d" ? `?range=${range}` : "";
  const pill = (active: boolean) =>
    cn("rounded-md border px-3 py-1.5", active ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted-bg");
  return (
    <div className="space-y-2">
      <nav className="flex flex-wrap gap-1.5 text-sm" aria-label="Analytics sections">
        {PAGES.map((p) => (
          <Link key={p.href} href={`${p.href}${q}`} prefetch={false} aria-current={p.href === current ? "page" : undefined} className={pill(p.href === current)}>
            {p.label}
          </Link>
        ))}
      </nav>
      {range && (
        <nav className="flex flex-wrap gap-1.5 text-sm" aria-label="Time range">
          {(Object.keys(RANGES) as RangeKey[]).map((k) => (
            <Link key={k} href={`${current}?range=${k}`} prefetch={false} aria-current={k === range ? "page" : undefined} className={pill(k === range)}>
              {RANGES[k].label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

export function rangeFrom(requested: string | undefined): RangeKey {
  return requested && requested in RANGES ? (requested as RangeKey) : "7d";
}
