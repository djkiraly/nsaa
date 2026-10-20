import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, Badge } from "@/components/ui";
import { getSimulation, loadSeason, SEEDING_CUTOFF, SUPPORTED_CLASSES } from "@/lib/data/season";
import { DATES_2026 } from "@/lib/engine/brackets";

export const dynamic = "force-dynamic";

export default async function Home() {
  const season = await loadSeason();
  const sims = await Promise.all(SUPPORTED_CLASSES.map((c) => getSimulation(c)));
  const teamCount = (c: string) => [...season.data.teams.values()].filter((x) => x === c).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">2026 Nebraska volleyball postseason</h1>
        <p className="text-sm text-muted mt-1">
          Seeding is based on matches through {SEEDING_CUTOFF}. Official pairings post Thursday Oct 22 on nsaahome.org.
          Data as of {season.fetchedAt.toLocaleString("en-US", { timeZone: "America/Chicago" })} CT ({season.source}).
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {sims.map((sim) => {
          const n = sim.nSims;
          const top = Object.values(sim.teams)
            .sort((a, b) => b.champion - a.champion)
            .slice(0, 5);
          const isC = sim.vbClass.startsWith("C");
          return (
            <Card key={sim.vbClass}>
              <CardHeader className="flex items-center justify-between">
                <CardTitle className="text-base">
                  Class {sim.vbClass}{" "}
                  <span className="text-muted font-normal">· {teamCount(sim.vbClass)} teams</span>
                </CardTitle>
                <Link href={`/class/${sim.vbClass}`} className="text-sm text-accent hover:underline">
                  Standings & brackets →
                </Link>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-xs text-muted">
                  {isC
                    ? `Sub-districts ${DATES_2026.classC.r1} – ${DATES_2026.classC.final} · District finals ${DATES_2026.districtFinal}`
                    : `Districts ${DATES_2026.classB.r1}, ${DATES_2026.classB.r2}, ${DATES_2026.classB.final}`}{" "}
                  · State {DATES_2026.state.quarter} – {DATES_2026.state.final}, Lincoln
                </div>
                <div className="text-xs font-medium text-muted uppercase tracking-wide">Title odds ({n.toLocaleString()} sims)</div>
                <ul className="space-y-1">
                  {top.map((t) => (
                    <li key={t.name} className="flex items-center justify-between text-sm">
                      <span>{t.name}</span>
                      <span className="flex items-center gap-2">
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
            <li>What does Mitchell need to do to host a sub-district match?</li>
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
