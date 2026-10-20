import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSeasonData } from "../src/lib/data/load";
import { runSimulation } from "../src/lib/engine/simulate";
import type { VbClass } from "../src/lib/engine/types";

const RAW = join(__dirname, "..", "data", "raw");
const read = (f: string) => readFileSync(join(RAW, f), "utf8");
const CLASSES: VbClass[] = ["A", "B", "C1", "C2", "D1", "D2"];
const data = buildSeasonData({
  seasonYear: 2026,
  exports: Object.fromEntries(CLASSES.map((c) => [c, read(`vb_${c}.csv`)])),
  regionHtml: { C1: read("regions_C1.html"), C2: read("regions_C2.html") },
});
const cls = (process.argv[2] ?? "B") as VbClass;
const n = Number(process.argv[3] ?? 2000);
console.log(`home advantage (set logit): ${data.ratings.home.toFixed(3)}`);
const t0 = Date.now();
const res = runSimulation(data, { vbClass: cls, cutoff: "2026-10-20", nSims: n, seed: 42 });
console.log(`${n} sims in ${Date.now() - t0} ms`);
const rows = Object.values(res.teams)
  .map((t) => ({
    team: t.name,
    rating: (data.ratings.rating.get(t.name) ?? 0).toFixed(2),
    "P(win grp)": (t.wonGroup / n).toFixed(2),
    "P(DF)": cls.startsWith("C") ? (t.reachedDistrictFinal / n).toFixed(2) : "-",
    "P(WC)": cls === "B" ? (t.wildcard / n).toFixed(2) : "-",
    "P(state)": (t.reachedState / n).toFixed(2),
    "P(semi)": (t.wonStateQuarter / n).toFixed(2),
    "P(title)": (t.champion / n).toFixed(3),
    grp: Object.entries(t.group).sort((a, b) => b[1] - a[1])[0]?.[0],
  }))
  .sort((a, b) => Number(b["P(state)"]) - Number(a["P(state)"]));
console.table(rows);
for (const g of res.projection.groups) console.log(g.id, g.teams.map((t) => `${t.seed}.${t.name}(${t.avg.toFixed(2)})`).join("  "));
