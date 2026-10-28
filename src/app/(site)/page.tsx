import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, Badge } from "@/components/ui";
import { getSimulation, getStatuses, loadSeason, SEEDING_CUTOFF, SUPPORTED_CLASSES } from "@/lib/data/season";
import type { StatusKind } from "@/lib/engine/status";
import { DATES_2026, groupDates, hasDistrictFinals } from "@/lib/engine/brackets";

// Static, regenerated when /api/refresh stores new NSAA data (revalidatePath) — hourly at most anyway. Static pages
// are prefetched in full by <Link>, so menu clicks are instant instead of waiting on a server render.
export const revalidate = 3600;

export default async function Home() {
  const season = await loadSeason();
  const sims = await Promise.all(SUPPORTED_CLASSES.map((c) => getSimulation(c)));
  const statuses = await Promise.all(SUPPORTED_CLASSES.map((c) => getStatuses(c)));
  const teamCount = (c: string) => [...season.data.teams.values()].filter((x) => x === c).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">2026 Nebraska volleyball postseason</h1>
        <p className="text-sm text-muted mt-1">
          Seeding is based on matches through {SEEDING_CUTOFF}.{" "}
          {sims.some((s) => s.projection.official)
            ? "Official NSAA pairings and results load as they're posted; a class still marked projected is waiting on NSAA."
            : "Official pairings post Thursday Oct 22 on nsaahome.org."}
          Data as of {season.fetchedAt.toLocaleString("en-US", { timeZone: "America/Chicago" })} CT ({season.source}).
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sims.map((sim, i) => {
          const n = sim.nSims;
          const count = (...kinds: StatusKind[]) => [...statuses[i].values()].filter((s) => kinds.includes(s.kind)).length;
          const [alive, atState, likelyOut, out] = [count("alive", "at-large"), count("qualified", "champion"), count("likely-out"), count("eliminated")];
          const top = Object.values(sim.teams)
            .sort((a, b) => b.champion - a.champion)
            .slice(0, 5);
          const d = groupDates(sim.vbClass);
          return (
            <Card key={sim.vbClass}>
              <CardHeader className="flex items-center justify-between">
                <CardTitle className="text-base">
                  Class {sim.vbClass}{" "}
                  <span className="text-muted font-normal">· {teamCount(sim.vbClass)} teams</span>{" "}
                  <Badge variant={sim.projection.official ? "good" : "outline"} className="ml-1 align-middle">
                    {sim.projection.official ? "official" : "projected"}
                  </Badge>
                </CardTitle>
                <Link href={`/class/${sim.vbClass}`} className="text-sm text-accent hover:underline">
                  Standings & brackets →
                </Link>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-xs text-muted">
                  {hasDistrictFinals(sim.vbClass)
                    ? `Sub-districts ${d.r1} – ${d.final} · District finals ${DATES_2026.districtFinal}`
                    : `Districts ${d.r1}, ${d.r2}, ${d.final}`}{" "}
                  · State {DATES_2026.state.quarter[sim.vbClass]} – {DATES_2026.state.final}, Lincoln
                </div>
                {atState + likelyOut + out > 0 && (
                  <div className="text-xs">
                    <span className="font-medium">{alive} alive</span>
                    {atState > 0 && <> · {atState} at state</>}
                    {likelyOut > 0 && <> · {likelyOut} likely out</>}
                    {out > 0 && <> · {out} out</>}
                  </div>
                )}
                <div className="text-xs font-medium text-muted uppercase tracking-wide">Title odds ({n.toLocaleString()} sims)</div>
                <ul className="space-y-1">
                  {top.map((t) => (
                    <li key={t.name} className="flex items-center justify-between text-sm max-md:gap-3">
                      <span className="max-md:min-w-0">{t.name}</span>
                      <span className="flex items-center gap-2 max-md:shrink-0">
                        <Badge variant="outline">state {Math.round((100 * t.reachedState) / n)}%</Badge>
                        <Badge variant="accent">title {Math.round((100 * t.champion) / n)}%</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ask the agent</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted space-y-2">
          <p>Try questions like:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Who is Gering most likely to play in the B-6 district final, and where?</li>
            <li>Which C2 sub-districts are stacked, and who gets the six district-final wildcards?</li>
            <li>Who are the Class A title favorites, and who&apos;s in line for the wildcard?</li>
            <li>Which D1 teams are likeliest to grab the four at-large district-final spots?</li>
            <li>Gering vs Columbus Lakeview at Gering — who wins?</li>
          </ul>
          <Link href="/chat" className="inline-block mt-2 text-accent hover:underline">
            Open chat →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
