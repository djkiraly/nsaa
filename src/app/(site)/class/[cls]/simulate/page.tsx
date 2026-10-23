import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui";
import { Simulator, SimulatorFromUrl } from "@/components/simulator";
import { getProjection, getSimulation, loadSeason, summarizeSimulation, SUPPORTED_CLASSES } from "@/lib/data/season";
import { hasDistrictFinals } from "@/lib/engine/brackets";
import type { VbClass } from "@/lib/engine/types";

// Static per class like the class page; picks and runs happen in the browser against POST /api/sim.
export const revalidate = 3600;

export function generateStaticParams() {
  return SUPPORTED_CLASSES.map((cls) => ({ cls }));
}

export default async function SimulatePage({ params }: { params: Promise<{ cls: string }> }) {
  const { cls } = await params;
  const vbClass = cls.toUpperCase() as VbClass;
  if (!SUPPORTED_CLASSES.includes(vbClass)) notFound();
  const [season, proj, sim] = await Promise.all([loadSeason(), getProjection(vbClass), getSimulation(vbClass)]);
  const hasDF = hasDistrictFinals(vbClass);
  const posted = [...proj.brackets, ...(proj.districtFinals ? [proj.districtFinals] : [])].flatMap((b) => b.matches).filter((m) => m.result).length;
  const props = {
    vbClass,
    hasDistrictFinals: hasDF,
    brackets: proj.brackets,
    districtFinals: proj.districtFinals,
    baseline: summarizeSimulation(sim),
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Class {vbClass} what-if simulator</h1>
          <p className="text-sm text-muted max-w-3xl">
            Pick winners in the {hasDF ? "sub-district" : "district"} brackets
            {proj.districtFinals ? " and district finals" : ""}, then run the simulation: every other match is played out
            thousands of times with the same ratings, home-court and seeding rules as the{" "}
            <Link href={`/class/${vbClass}`} className="text-accent hover:underline">
              class page
            </Link>
            . Results NSAA has posted are locked in. Data{" "}
            {season.fetchedAt.toLocaleString("en-US", { timeZone: "America/Chicago" })} CT.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={proj.official ? "good" : "outline"}>
            {proj.official ? "Official NSAA brackets" : "Projected brackets"}
          </Badge>
          <Badge variant="outline">
            {posted} result{posted === 1 ? "" : "s"} posted
          </Badge>
        </div>
      </div>
      {/* Static HTML is the no-picks simulator; a shared link's picks load in the browser. */}
      <Suspense fallback={<Simulator {...props} />}>
        <SimulatorFromUrl {...props} />
      </Suspense>
    </div>
  );
}
