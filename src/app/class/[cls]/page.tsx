import { notFound } from "next/navigation";
import { Badge, Card, CardContent, CardHeader, CardTitle, Prob, ProbStat, Table, Td, Th } from "@/components/ui";
import { getProjection, getSimulation, loadSeason, SEEDING_CUTOFF, SUPPORTED_CLASSES } from "@/lib/data/season";
import type { VbClass } from "@/lib/engine/types";
import type { Bracket } from "@/lib/engine/types";
import { hasDistrictFinals } from "@/lib/engine/brackets";

// Static per class, regenerated when /api/refresh stores new NSAA data (see app/page.tsx).
export const revalidate = 3600;

export function generateStaticParams() {
  return SUPPORTED_CLASSES.map((cls) => ({ cls }));
}

const C_FORMAT =
  "Regions serpentine into sub-districts by wildcard average. #1 seed hosts semis and final; the sub-district winner plus the six best remaining averages advance to Oct 31 district finals.";
const D_FORMAT =
  "NSAA assigns the 12 sub-districts geographically; teams are seeded within them by wildcard average and the #1 seed hosts every match (Oct 26–27). Sub-district winners plus the four best remaining averages advance to Oct 31 district finals.";

/** One-line format summary per class (argument: number of teams). */
const FORMAT: Record<VbClass, (n: number) => string> = {
  A: (n) =>
    `Un-modified serpentine of the ${n} seeds into 7 districts (Oct 26–28). The higher seed hosts every match, including the final; the 7 champions plus the best remaining average (wildcard) go to state.`,
  B: (n) =>
    `Un-modified serpentine of the ${n} seeds into 7 districts. Higher seed hosts; a neutral site (McCook, Lexington, Hastings, GI Northwest) is used if two schools are more than 300 miles apart before the final.`,
  C1: () => C_FORMAT,
  C2: () => C_FORMAT,
  D1: () => D_FORMAT,
  D2: () => D_FORMAT,
};

export default async function ClassPage({ params }: { params: Promise<{ cls: string }> }) {
  const { cls } = await params;
  const vbClass = cls.toUpperCase() as VbClass;
  if (!SUPPORTED_CLASSES.includes(vbClass)) notFound();
  const [season, proj, sim] = await Promise.all([loadSeason(), getProjection(vbClass), getSimulation(vbClass)]);
  const n = sim.nSims;
  const hasDF = hasDistrictFinals(vbClass);
  const groupOf = new Map<string, { id: string; seed: number }>();
  for (const g of proj.groups) for (const t of g.teams) groupOf.set(t.name, { id: g.id, seed: t.seed });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Class {vbClass}</h1>
          <p className="text-sm text-muted">
            Wildcard standings through {SEEDING_CUTOFF} · {n.toLocaleString()} simulations · data{" "}
            {season.fetchedAt.toLocaleString("en-US", { timeZone: "America/Chicago" })} CT
          </p>
          <nav className="md:hidden mt-3 flex gap-2 text-sm">
            <a href="#standings" className="rounded-md border border-border bg-card px-3 py-1.5">
              Standings ↓
            </a>
            <a href="#brackets" className="rounded-md border border-border bg-card px-3 py-1.5">
              {hasDF ? "Sub-districts" : "Districts"} ↓
            </a>
          </nav>
        </div>
        <Badge variant="outline">home-court edge: {sim.ratingSummary.home.toFixed(2)} set-logit</Badge>
      </div>

      <section id="standings" className="max-md:scroll-mt-28">
        <h2 className="text-lg font-semibold mb-2">Standings & simulation</h2>
        {/* Phones: one compact card per team instead of the 10-column table. */}
        <Card className="md:hidden">
          <ul className="divide-y divide-border/60">
            {proj.overall.map((t) => {
              const s = sim.teams[t.name];
              const g = groupOf.get(t.name);
              return (
                <li key={t.name} className="px-3 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium">
                        <span className="tabular text-muted mr-1.5">{t.seed}</span>
                        {t.name}
                      </div>
                      <div className="text-xs text-muted tabular">
                        {t.wins}-{t.losses} · avg {t.avg.toFixed(4)} · rating{" "}
                        {(season.data.ratings.rating.get(t.name) ?? 0).toFixed(2)}
                      </div>
                    </div>
                    <Badge className="shrink-0">
                      {g?.id} · #{g?.seed}
                    </Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-3">
                    <ProbStat label={hasDF ? "Win sub-dist" : "Win district"} value={s.wonGroup / n} />
                    <ProbStat label={hasDF ? "Dist. final" : "Wildcard"} value={(hasDF ? s.reachedDistrictFinal : s.wildcard) / n} />
                    <ProbStat label="State" value={s.reachedState / n} />
                    <ProbStat label="Title" value={s.champion / n} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card className="max-md:hidden">
          <CardContent className="pt-4">
            <Table>
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>Team</Th>
                  <Th>Rec</Th>
                  <Th className="text-right">WC avg</Th>
                  <Th className="text-right">Rating</Th>
                  <Th>{hasDF ? "Sub-dist" : "District"}</Th>
                  <Th>Win {hasDF ? "sub-dist" : "district"}</Th>
                  <Th>{hasDF ? "Dist. final" : "Wildcard"}</Th>
                  <Th>State</Th>
                  <Th>Title</Th>
                </tr>
              </thead>
              <tbody>
                {proj.overall.map((t) => {
                  const s = sim.teams[t.name];
                  const g = groupOf.get(t.name);
                  return (
                    <tr key={t.name} className="hover:bg-muted-bg/60">
                      <Td className="tabular text-muted">{t.seed}</Td>
                      <Td className="font-medium whitespace-nowrap">{t.name}</Td>
                      <Td className="tabular">
                        {t.wins}-{t.losses}
                      </Td>
                      <Td className="tabular text-right">{t.avg.toFixed(4)}</Td>
                      <Td className="tabular text-right">{(season.data.ratings.rating.get(t.name) ?? 0).toFixed(2)}</Td>
                      <Td>
                        <Badge>
                          {g?.id} · #{g?.seed}
                        </Badge>
                      </Td>
                      <Td>
                        <Prob value={s.wonGroup / n} />
                      </Td>
                      <Td>
                        <Prob value={(hasDF ? s.reachedDistrictFinal : s.wildcard) / n} />
                      </Td>
                      <Td>
                        <Prob value={s.reachedState / n} />
                      </Td>
                      <Td>
                        <Prob value={s.champion / n} />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section id="brackets" className="max-md:scroll-mt-28">
        <h2 className="text-lg font-semibold mb-1">Projected {hasDF ? "sub-districts" : "districts"}</h2>
        <p className="text-sm text-muted mb-3">
          {FORMAT[vbClass](proj.overall.length)}
        </p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {proj.brackets.map((b) => (
            <BracketCard key={b.id} bracket={b} winProb={(name) => (sim.teams[name]?.wonGroup ?? 0) / n} />
          ))}
        </div>
      </section>
    </div>
  );
}

function BracketCard({ bracket, winProb }: { bracket: Bracket; winProb: (t: string) => number }) {
  const label = (ref: string | null) => {
    if (!ref) return "—";
    if (ref.startsWith("W:")) {
      const m = bracket.matches.find((x) => x.id === ref.slice(2));
      return `Winner ${m?.label ?? ""}`;
    }
    const seed = bracket.teams.find((t) => t.name === ref)?.seed;
    return `#${seed} ${ref}`;
  };
  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>{bracket.name}</CardTitle>
        <span className="text-xs text-muted">{bracket.teams.length} teams</span>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="text-sm space-y-0.5">
          {bracket.teams.map((t) => (
            <li key={t.name} className="flex items-center justify-between gap-2">
              <span>
                <span className="text-muted tabular mr-1">{t.seed}.</span>
                {t.name}{" "}
                <span className="text-muted text-xs tabular">
                  {t.wins}-{t.losses} · {t.avg.toFixed(2)}
                </span>
              </span>
              <span className="text-xs tabular text-muted">{Math.round(100 * winProb(t.name))}%</span>
            </li>
          ))}
        </ul>
        <div className="border-t border-border pt-2 space-y-1.5">
          {bracket.matches.map((m) => (
            <div key={m.id} className="text-xs">
              <div className="flex justify-between text-muted">
                <span>{m.label}</span>
                <span>{m.date}</span>
              </div>
              <div>
                {label(m.top)} <span className="text-muted">vs</span> {label(m.bottom)}
              </div>
              <div className="text-muted">
                {m.host ? `at ${m.host}` : m.site ? `neutral: ${m.site}` : "at highest remaining seed"}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
