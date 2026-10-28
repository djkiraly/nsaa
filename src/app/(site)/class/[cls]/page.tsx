import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardContent, CardHeader, CardTitle, cn, Prob, ProbStat, Table, Td, Th } from "@/components/ui";
import { StatusBadge, StatusOverview } from "@/components/status";
import {
  getProjection,
  getProjectionCheck,
  getSimulation,
  getStatuses,
  loadSeason,
  SEEDING_CUTOFF,
  SUPPORTED_CLASSES,
} from "@/lib/data/season";
import type { VbClass } from "@/lib/engine/types";
import type { Bracket, BracketMatch } from "@/lib/engine/types";
import type { TeamStatus } from "@/lib/engine/status";
import { DATES_2026, hasDistrictFinals } from "@/lib/engine/brackets";

// Static per class, regenerated when /api/refresh stores new NSAA data (see app/page.tsx).
export const revalidate = 3600;

/** A team whose season is over: struck through in red wherever it appears. */
const OUT = "line-through text-accent decoration-accent";

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
  const [season, proj, sim, check, statuses] = await Promise.all([
    loadSeason(),
    getProjection(vbClass),
    getSimulation(vbClass),
    getProjectionCheck(vbClass),
    getStatuses(vbClass),
  ]);
  const groupWord = hasDistrictFinals(vbClass) ? "sub-district" : "district";
  const n = sim.nSims;
  const hasDF = hasDistrictFinals(vbClass);
  const groupOf = new Map<string, { id: string; seed: number }>();
  for (const g of proj.groups) for (const t of g.teams) groupOf.set(t.name, { id: g.id, seed: t.seed });
  const statusOf = (t: string) => statuses.get(t);
  /** Something has happened: a result that decided or threatens someone's season. */
  const anyResults = [...statuses.values()].some((s) => s.kind !== "alive" || s.won);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Class {vbClass}</h1>
          <p className="text-sm text-muted">
            Wildcard standings through {SEEDING_CUTOFF} · {n.toLocaleString()} simulations · data{" "}
            {season.fetchedAt.toLocaleString("en-US", { timeZone: "America/Chicago" })} CT
          </p>
          <nav className="md:hidden mt-3 flex flex-wrap gap-2 text-sm">
            <a href="#standings" className="rounded-md border border-border bg-card px-3 py-1.5">
              Standings ↓
            </a>
            {anyResults && (
              <a href="#status" className="rounded-md border border-border bg-card px-3 py-1.5">
                Who&apos;s out ↓
              </a>
            )}
            <a href="#brackets" className="rounded-md border border-border bg-card px-3 py-1.5">
              {hasDF ? "Sub-districts" : "Districts"} ↓
            </a>
          </nav>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/class/${vbClass}/simulate`}
            className="rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium hover:opacity-90"
          >
            What-if simulator →
          </Link>
          <Badge variant={proj.official ? "good" : "outline"}>
            {proj.official ? "Official NSAA pairings" : "Projected · official pairings Oct 22"}
          </Badge>
          <Badge variant="outline">home-court edge: {sim.ratingSummary.home.toFixed(2)} set-logit</Badge>
        </div>
      </div>

      <section id="standings" className="max-md:scroll-mt-28">
        <h2 className="text-lg font-semibold mb-2">Standings & simulation</h2>
        {/* Phones: one compact card per team instead of the 11-column table. */}
        <Card className="md:hidden">
          <ul className="divide-y divide-border/60">
            {proj.overall.map((t) => {
              const s = sim.teams[t.name];
              const g = groupOf.get(t.name);
              const st = statusOf(t.name);
              return (
                <li key={t.name} className="px-3 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className={cn("font-medium", st?.kind === "eliminated" && OUT)}>
                        <span className="tabular text-muted mr-1.5">{t.seed}</span>
                        {t.name}
                      </div>
                      <div className="text-xs text-muted tabular">
                        {t.wins}-{t.losses} · avg {t.avg.toFixed(4)} · rating{" "}
                        {(season.data.ratings.rating.get(t.name) ?? 0).toFixed(2)}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge>
                        {g?.id} · #{g?.seed}
                      </Badge>
                      <StatusBadge status={st} />
                    </div>
                  </div>
                  {st && (st.kind !== "alive" || st.won) && <div className="mt-1 text-xs text-muted">{st.summary}</div>}
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
                  {anyResults && <Th>Status</Th>}
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
                  const st = statusOf(t.name);
                  return (
                    <tr key={t.name} className="hover:bg-muted-bg/60">
                      <Td className="tabular text-muted">{t.seed}</Td>
                      <Td className={cn("font-medium whitespace-nowrap", st?.kind === "eliminated" && OUT)}>
                        {t.name}
                      </Td>
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
                      {anyResults && (
                        <Td>
                          <StatusBadge status={st} />
                        </Td>
                      )}
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

      {anyResults && (
        <section id="status" className="max-md:scroll-mt-28">
          <h2 className="text-lg font-semibold mb-1">Where everyone stands</h2>
          <p className="text-sm text-muted mb-3">
            From NSAA&apos;s posted results.{" "}
            {hasDF
              ? "A sub-district loss isn't the end: the best remaining averages fill the district finals, so a team is out only once that field is settled. A district-final or state loss ends the season."
              : "A district loss isn't the end for the best remaining average, which goes to state as the wildcard once every district final is in. A state loss ends the season."}
          </p>
          <StatusOverview statuses={statuses} />
        </section>
      )}

      <section id="brackets" className="max-md:scroll-mt-28">
        <h2 className="text-lg font-semibold mb-1">
          {proj.official ? (hasDF ? "Sub-districts" : "Districts") : `Projected ${groupWord}s`}
        </h2>
        <p className="text-sm text-muted mb-3">
          {FORMAT[vbClass](proj.overall.length)}
          {proj.official && " Groups, seeds, sites and times are NSAA's; posted results are final and fixed in the simulation."}
          {anyResults && " Teams whose season is over are struck through."}
        </p>
        {check && (
          <details className="mb-3 text-sm rounded-md border border-border bg-card px-3 py-2">
            <summary className="cursor-pointer">
              How our Oct 20 projection did: {check.sameGroup} of {check.total} teams in the right {groupWord},{" "}
              {check.sameGroupAndSeed} with the exact seed.
            </summary>
            {check.misses.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-muted">
                {check.misses.map((m) => (
                  <li key={m.team}>
                    <span className="text-foreground">{m.team}</span>: projected {m.projected}, official {m.official}
                  </li>
                ))}
              </ul>
            )}
          </details>
        )}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {proj.brackets.map((b) => (
            <BracketCard key={b.id} bracket={b} winProb={(name) => (sim.teams[name]?.wonGroup ?? 0) / n} statusOf={statusOf} />
          ))}
        </div>
      </section>

      {proj.districtFinals && (
        <section id="district-finals" className="max-md:scroll-mt-28">
          <h2 className="text-lg font-semibold mb-1">District finals</h2>
          <p className="text-sm text-muted mb-3">
            NSAA&apos;s pairings for Oct 31; the eight winners go to state. Percentages are each team&apos;s chance of
            reaching state.
          </p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <BracketCard
              bracket={proj.districtFinals}
              winProb={(name) => (sim.teams[name]?.reachedState ?? 0) / n}
              statusOf={statusOf}
            />
          </div>
        </section>
      )}

      {proj.state && (
        <section id="state" className="max-md:scroll-mt-28">
          <h2 className="text-lg font-semibold mb-1">State tournament</h2>
          <p className="text-sm text-muted mb-3">
            The field from posted results{proj.wildcard ? ` (${proj.wildcard} is the wildcard)` : ""}, seeded by wildcard
            average — our seeding until NSAA posts the bracket. {DATES_2026.state.quarter[vbClass]} – {DATES_2026.state.final}{" "}
            in Lincoln. Percentages are each team&apos;s title odds.
          </p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <BracketCard bracket={proj.state} winProb={(name) => (sim.teams[name]?.champion ?? 0) / n} statusOf={statusOf} />
          </div>
        </section>
      )}
    </div>
  );
}

function BracketCard({
  bracket,
  winProb,
  statusOf,
}: {
  bracket: Bracket;
  winProb: (t: string) => number;
  statusOf: (t: string) => TeamStatus | undefined;
}) {
  const matchById = (id: string) => bracket.matches.find((x) => x.id === id);
  /** The team in a slot, once known: a name, or the posted winner of the match the slot refers to. */
  const teamOf = (ref: string | null): string | null => {
    if (!ref) return null;
    if (!ref.startsWith("W:")) return ref;
    return matchById(ref.slice(2))?.result?.winner ?? null;
  };
  const label = (ref: string | null): string => {
    const t = teamOf(ref);
    if (t) return `#${bracket.teams.find((x) => x.name === t)?.seed} ${t}`;
    if (!ref) return "—";
    return `Winner ${matchById(ref.slice(2))?.label ?? ""}`;
  };
  const Slot = ({ m, slot }: { m: BracketMatch; slot: string | null }) => {
    const t = teamOf(slot);
    const lost = !!t && m.result?.loser === t;
    const out = lost && statusOf(t)?.kind === "eliminated";
    return <span className={cn(lost && (out ? OUT : "line-through text-muted"))}>{label(slot)}</span>;
  };
  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>{bracket.name}</CardTitle>
        <span className="text-xs text-muted">{bracket.teams.length} teams</span>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="text-sm space-y-0.5">
          {bracket.teams.map((t) => {
            const st = statusOf(t.name);
            return (
              <li key={t.name} className="flex items-center justify-between gap-2">
                <span className={cn("min-w-0", st?.kind === "eliminated" && OUT)}>
                  <span className="text-muted tabular mr-1">{t.seed}.</span>
                  {t.name}{" "}
                  <span className="text-muted text-xs tabular">
                    {t.wins}-{t.losses} · {t.avg.toFixed(2)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-xs tabular text-muted">
                  <StatusBadge status={st} />
                  {Math.round(100 * winProb(t.name))}%
                </span>
              </li>
            );
          })}
        </ul>
        <div className="border-t border-border pt-2 space-y-1.5">
          {bracket.matches.map((m) => (
            <div key={m.id} className="text-xs">
              <div className="flex justify-between gap-2 text-muted">
                <span>{m.label}</span>
                <span className="whitespace-nowrap">
                  {m.date}
                  {m.time && ` · ${m.time}`}
                </span>
              </div>
              <div>
                <Slot m={m} slot={m.top} /> <span className="text-muted">vs</span> <Slot m={m} slot={m.bottom} />
              </div>
              {m.result ? (
                <div className="font-medium text-good">
                  ✓ {m.result.winner} won{m.result.setsW !== undefined && ` ${m.result.setsW}-${m.result.setsL}`}
                </div>
              ) : null}
              <div className="text-muted">
                {m.officialSite
                  ? `at ${m.officialSite}`
                  : m.host
                    ? `at ${m.host}`
                    : m.site
                      ? `neutral: ${m.site}`
                      : "at highest remaining seed"}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
