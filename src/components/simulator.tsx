"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, cn, Table, Td, Th } from "./ui";
import { matchTeams, matchWinner, prunePicks, type Picks } from "@/lib/engine/picks";
import type { Bracket, BracketMatch, VbClass } from "@/lib/engine/types";
import type { SimSummary } from "@/lib/data/season";

const SIZES = [2000, 5000];

/** Picks live in the URL (?p=B-1-M1~Ralston&p=…) so a scenario can be shared. */
function readUrlPicks(params: URLSearchParams): Picks {
  const out: Picks = {};
  for (const v of params.getAll("p")) {
    const i = v.indexOf("~");
    if (i > 0) out[v.slice(0, i)] = v.slice(i + 1);
  }
  return out;
}

function writeUrlPicks(picks: Picks) {
  const q = new URLSearchParams();
  for (const [m, t] of Object.entries(picks)) q.append("p", `${m}~${t}`);
  const s = q.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${s ? `?${s}` : ""}`);
}

async function postScenario(vbClass: VbClass, picks: Picks, n: number): Promise<SimSummary> {
  const res = await fetch("/api/sim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ class: vbClass, n, picks }),
  });
  if (!res.ok) throw new Error(`simulation failed: ${res.status}`);
  return res.json();
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Two standard errors (percentage points) of the difference between two runs' estimates of a 50% chance. */
const noisePoints = (n1: number, n2: number) => Math.round(200 * Math.sqrt(0.25 / n1 + 0.25 / n2));

interface SimulatorProps {
  vbClass: VbClass;
  hasDistrictFinals: boolean;
  brackets: Bracket[];
  districtFinals?: Bracket;
  baseline: SimSummary;
}

/**
 * The simulator with a shared link's picks restored (and run once). Needs a Suspense boundary: the page is static,
 * so the URL is only known in the browser — render <Simulator> without picks as the fallback.
 */
export function SimulatorFromUrl(props: SimulatorProps) {
  const params = useSearchParams();
  // Only the URL the page opened with: later picks rewrite it (replaceState), which must not reset the simulator.
  const [initial] = useState(() =>
    prunePicks(
      [...props.brackets, ...(props.districtFinals ? [props.districtFinals] : [])],
      readUrlPicks(new URLSearchParams(params.toString())),
    ),
  );
  return <Simulator {...props} initialPicks={initial} />;
}

export function Simulator({
  vbClass,
  hasDistrictFinals,
  brackets,
  districtFinals,
  baseline,
  initialPicks = {},
}: SimulatorProps & { initialPicks?: Picks }) {
  const all = useMemo(() => [...brackets, ...(districtFinals ? [districtFinals] : [])], [brackets, districtFinals]);
  const [picks, setPicks] = useState<Picks>(initialPicks);
  const [n, setN] = useState(SIZES[0]);
  const [result, setResult] = useState<SimSummary | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "error">(
    Object.keys(initialPicks).length > 0 ? "running" : "idle",
  );

  const done = (r: SimSummary) => (setResult(r), setStatus("idle"));
  const failed = () => setStatus("error");
  const run = (p: Picks, size: number) => {
    setStatus("running");
    postScenario(vbClass, p, size).then(done, failed);
  };

  // A shared link: run its picks once.
  useEffect(() => {
    if (Object.keys(initialPicks).length > 0) postScenario(vbClass, initialPicks, SIZES[0]).then(done, failed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (next: Picks) => {
    const p = prunePicks(all, next);
    setPicks(p);
    writeUrlPicks(p);
  };
  const toggle = (m: BracketMatch, team: string) => {
    const next = { ...picks };
    if (next[m.id] === team) delete next[m.id];
    else next[m.id] = team;
    update(next);
  };

  const shown = result ?? baseline;
  const stale = result ? JSON.stringify(sortKeys(result.picks)) !== JSON.stringify(sortKeys(picks)) : Object.keys(picks).length > 0;
  const pickCount = Object.keys(picks).length;

  return (
    <div className="space-y-6">
      <Card className="max-md:sticky max-md:top-[5.5rem] max-md:z-10">
        <CardContent className="pt-4 flex flex-wrap items-center gap-3">
          <Button onClick={() => run(picks, n)} disabled={status === "running"}>
            {status === "running" ? "Simulating…" : `Run ${n.toLocaleString()} simulations`}
          </Button>
          <label className="text-sm text-muted flex items-center gap-1.5">
            runs
            <select
              value={n}
              onChange={(e) => setN(Number(e.target.value))}
              className="rounded-md border border-border bg-card px-2 h-9 text-sm text-foreground"
            >
              {SIZES.map((s) => (
                <option key={s} value={s}>
                  {s.toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          <Button variant="outline" onClick={() => (update({}), setResult(null))} disabled={pickCount === 0 && !result}>
            Reset
          </Button>
          <span className="text-sm text-muted">
            {pickCount === 0 ? "No picks — click a team to make it win that match." : `${pickCount} pick${pickCount === 1 ? "" : "s"}`}
            {stale && pickCount > 0 && status !== "running" && " · not simulated yet"}
            {status === "error" && <span className="text-accent"> · simulation failed, try again</span>}
          </span>
        </CardContent>
      </Card>

      <section>
        <h2 className="text-lg font-semibold mb-1">{hasDistrictFinals ? "Sub-districts" : "Districts"}</h2>
        <p className="text-sm text-muted mb-3">
          Percentages are each team&apos;s chance of winning that match {result ? "in your scenario" : "(baseline)"}.
        </p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {brackets.map((b) => (
            <PickBracket key={b.id} bracket={b} picks={picks} summary={shown} onPick={toggle} />
          ))}
        </div>
      </section>

      {districtFinals && (
        <section>
          <h2 className="text-lg font-semibold mb-1">District finals</h2>
          <p className="text-sm text-muted mb-3">NSAA&apos;s Oct 31 pairings; the eight winners go to state.</p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <PickBracket bracket={districtFinals} picks={picks} summary={shown} onPick={toggle} />
          </div>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-1">Outlook</h2>
        <p className="text-sm text-muted mb-3">
          {result
            ? `Your scenario (${result.nSims.toLocaleString()} runs) with the change from the baseline (${baseline.nSims.toLocaleString()} runs, no picks). Changes under ${noisePoints(result.nSims, baseline.nSims)} points are within simulation noise and not shown.`
            : `Baseline: ${baseline.nSims.toLocaleString()} runs with only NSAA's posted results fixed.`}
        </p>
        <Outlook hasDistrictFinals={hasDistrictFinals} shown={shown} baseline={result ? baseline : null} />
      </section>
    </div>
  );
}

const sortKeys = (p: Picks) => Object.fromEntries(Object.entries(p).sort(([a], [b]) => a.localeCompare(b)));

function PickBracket({
  bracket,
  picks,
  summary,
  onPick,
}: {
  bracket: Bracket;
  picks: Picks;
  summary: SimSummary;
  onPick: (m: BracketMatch, team: string) => void;
}) {
  const seedOf = (t: string) => bracket.teams.find((x) => x.name === t)?.seed;
  const labelOf = (id: string) => bracket.matches.find((m) => m.id === id)?.label ?? id;
  const winner = matchWinner(bracket, bracket.matches.at(-1)!, picks);
  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle>{bracket.name}</CardTitle>
        {winner && bracket.matches.length > 1 && <Badge variant="good">{winner}</Badge>}
      </CardHeader>
      <CardContent className="space-y-3">
        {bracket.matches.map((m) => {
          const teams = matchTeams(bracket, m, picks);
          const refs = [m.top, m.bottom];
          const wins = summary.matchWins[m.id] ?? {};
          const venue = m.officialSite ?? m.host ?? (m.site ? `neutral: ${m.site}` : "highest remaining seed");
          return (
            <div key={m.id} className="text-xs">
              <div className="flex justify-between gap-2 text-muted mb-1">
                <span>{m.label}</span>
                <span className="whitespace-nowrap">
                  {m.date}
                  {m.time && ` · ${m.time}`}
                </span>
              </div>
              <div className="grid gap-1">
                {teams.map((t, i) => {
                  if (!t) {
                    const ref = refs[i];
                    return (
                      <div key={i} className="rounded-md border border-dashed border-border px-2 py-1.5 text-muted">
                        {ref?.startsWith("W:") ? `Winner of ${labelOf(ref.slice(2))}` : "—"}
                      </div>
                    );
                  }
                  const posted = m.result?.winner === t;
                  const lost = m.result && !posted;
                  const picked = picks[m.id] === t;
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={!!m.result}
                      onClick={() => onPick(m, t)}
                      aria-pressed={picked}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-sm transition",
                        picked ? "border-good bg-good-soft font-medium" : "border-border hover:bg-muted-bg",
                        posted && "border-good font-medium",
                        lost && "opacity-50 line-through",
                        m.result && "cursor-default",
                      )}
                    >
                      <span className="min-w-0 truncate">
                        {seedOf(t) !== undefined && <span className="text-muted tabular mr-1">{seedOf(t)}</span>}
                        {t}
                      </span>
                      <span className="shrink-0 tabular text-xs text-muted">
                        {posted
                          ? `✓ won${m.result!.setsW !== undefined ? ` ${m.result!.setsW}-${m.result!.setsL}` : ""}`
                          : picked
                            ? "picked"
                            : !m.result && pct((wins[t] ?? 0) / summary.nSims)}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="text-muted mt-1">at {venue}</div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function Outlook({
  hasDistrictFinals,
  shown,
  baseline,
}: {
  hasDistrictFinals: boolean;
  shown: SimSummary;
  baseline: SimSummary | null;
}) {
  const cols: { key: keyof SimSummary["teams"][string]; label: string }[] = [
    { key: "wonGroup", label: hasDistrictFinals ? "Win sub-dist" : "Win district" },
    hasDistrictFinals ? { key: "reachedDistrictFinal", label: "Dist. final" } : { key: "wildcard", label: "Wildcard" },
    { key: "reachedState", label: "State" },
    { key: "wonStateSemi", label: "State final" },
    { key: "champion", label: "Title" },
  ];
  const rows = Object.entries(shown.teams)
    .filter(([name, t]) => t.reachedState > 0 || t.wonGroup > 0 || (baseline?.teams[name]?.reachedState ?? 0) > 0)
    .sort(([, a], [, b]) => b.reachedState - a.reachedState || b.champion - a.champion);
  const cell = (name: string, key: (typeof cols)[number]["key"]) => {
    const v = shown.teams[name][key] / shown.nSims;
    const before = baseline ? (baseline.teams[name]?.[key] ?? 0) / baseline.nSims : undefined;
    const raw = before === undefined ? 0 : Math.round((v - before) * 100);
    const d = baseline && Math.abs(raw) >= noisePoints(shown.nSims, baseline.nSims) ? raw : 0;
    return (
      <span className="tabular whitespace-nowrap">
        {pct(v)}
        {d !== 0 && <span className={cn("ml-1 text-xs", d > 0 ? "text-good" : "text-accent")}>{d > 0 ? `+${d}` : d}</span>}
      </span>
    );
  };
  return (
    <Card>
      <CardContent className="pt-4">
        <Table>
          <thead>
            <tr>
              <Th>Team</Th>
              {cols.map((c) => (
                <Th key={c.key} className="text-right">
                  {c.label}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([name]) => (
              <tr key={name} className="hover:bg-muted-bg/60">
                <Td className="font-medium whitespace-nowrap">{name}</Td>
                {cols.map((c) => (
                  <Td key={c.key} className="text-right">
                    {cell(name, c.key)}
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      </CardContent>
    </Card>
  );
}
