/** Team status badges and the per-class "where everyone stands" overview, from engine/status. */
import { Badge, Card, CardContent } from "@/components/ui";
import type { StatusKind, TeamStatus } from "@/lib/engine/status";

type Variant = "default" | "accent" | "good" | "warn" | "outline";

const LABEL: Record<StatusKind, string> = {
  champion: "Champion",
  qualified: "State",
  alive: "Alive",
  "at-large": "At-large?",
  "likely-out": "Likely out",
  eliminated: "Out",
};
const VARIANT: Record<StatusKind, Variant> = {
  champion: "accent",
  qualified: "good",
  alive: "outline",
  "at-large": "warn",
  "likely-out": "outline",
  eliminated: "default",
};

/** Compact badge; nothing for a team that's simply still playing (the usual case), unless `showAlive`. */
export function StatusBadge({ status, showAlive = false }: { status?: TeamStatus; showAlive?: boolean }) {
  if (!status) return null;
  if (status.kind === "alive" && !status.won && !showAlive) return null;
  const inDF = status.kind === "alive" && status.won;
  return (
    <Badge variant={inDF ? "good" : VARIANT[status.kind]} title={status.summary} className="whitespace-nowrap">
      {inDF ? "Dist. final" : LABEL[status.kind]}
    </Badge>
  );
}

const STAGE_ORDER = { state: 0, "district-final": 1, district: 2 };

/** Counts plus lists of who's through, who's hanging on, and who's out — with the loss that did it. */
export function StatusOverview({ statuses }: { statuses: Map<string, TeamStatus> }) {
  const rows = [...statuses].map(([team, s]) => ({ team, ...s }));
  const by = (k: StatusKind) =>
    rows
      .filter((r) => r.kind === k)
      .sort(
        (a, b) =>
          (a.loss ? STAGE_ORDER[a.loss.stage] : 9) - (b.loss ? STAGE_ORDER[b.loss.stage] : 9) ||
          (b.pState ?? 0) - (a.pState ?? 0) ||
          (b.loss?.date ?? "").localeCompare(a.loss?.date ?? "") ||
          a.team.localeCompare(b.team),
      );
  const count = (...kinds: StatusKind[]) => rows.filter((r) => kinds.includes(r.kind)).length;
  const sections: { kind: StatusKind; title: string; open?: boolean }[] = [
    { kind: "champion", title: "State champion", open: true },
    { kind: "qualified", title: "Qualified for state", open: true },
    { kind: "at-large", title: "Lost, but still in at-large / wildcard contention", open: true },
    { kind: "likely-out", title: "Likely out — nothing settled yet" },
    { kind: "eliminated", title: "Eliminated" },
  ];
  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="outline">{count("alive")} alive</Badge>
          {count("qualified", "champion") > 0 && <Badge variant="good">{count("qualified", "champion")} at state</Badge>}
          {count("at-large") > 0 && <Badge variant="warn">{count("at-large")} at-large hopes</Badge>}
          {count("likely-out") > 0 && <Badge variant="outline">{count("likely-out")} likely out</Badge>}
          <Badge>{count("eliminated")} out</Badge>
        </div>
        {sections
          .filter((s) => by(s.kind).length > 0)
          .map((s) => (
            <details key={s.kind} open={s.open} className="text-sm">
              <summary className="cursor-pointer font-medium">
                {s.title} <span className="text-muted font-normal">({by(s.kind).length})</span>
              </summary>
              <ul className="mt-1.5 space-y-1 text-xs">
                {by(s.kind).map((r) => (
                  <li key={r.team}>
                    <span className="font-medium">{r.team}</span> <span className="text-muted">— {r.summary}</span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
      </CardContent>
    </Card>
  );
}
