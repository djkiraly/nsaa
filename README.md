# NSAA Volleyball Postseason Agent

Seedings, projected brackets, Monte Carlo simulations and a chat agent for Nebraska high-school volleyball
districts and state — all six classes (A, B, C1, C2, D1, D2) for 2026.

Stack: Next.js 16 · TypeScript · Tailwind 4 · Drizzle ORM + Postgres (optional) · Anthropic SDK · nginx + PM2.

## What it does

| Layer | What |
| --- | --- |
| `src/lib/engine/wildcard.ts` | NSAA wildcard point formula + tiebreakers. Reproduces every published average exactly (tested). |
| `src/lib/engine/seeding.ts` | A/B serpentine into 7 districts; C1/C2 region → sub-district snake (matches NSAA's live pages, tested); D1/D2 NSAA-assigned sub-districts. |
| `src/lib/engine/brackets.ts` | 4/5/6-team sub-district and district brackets, per-class host & neutral-site rules and dates, 16-team district finals, 8-team state. |
| `src/lib/engine/ratings.ts` | Set-level Bradley-Terry power ratings with home-court term, fit on this season's results (all six classes). |
| `src/lib/engine/simulate.ts` | Monte Carlo: remaining regular season → seeding → brackets → district finals / wildcard → state. |
| `src/lib/data/*` | NSAA CSV/HTML parsers, loader, scraper, snapshot storage. |
| `src/lib/agent/*` | Claude tool-use agent: standings, brackets, simulations, team outlook, head-to-head, live NSAA pages, rules. |
| `src/app` | Overview, per-class standings + projected brackets, chat UI, API routes. |

## Quick start

```bash
npm install
cp .env.example .env.local        # add ANTHROPIC_API_KEY
npm test                          # engine validation against NSAA's published numbers
npm run dev                       # http://localhost:3000
```

The app runs from the fixtures in `data/raw/` with no database. Refresh them any time:

```bash
npm run scrape                    # downloads the six class exports + region pages
npm run sim -- B 5000             # CLI simulation summary
```

## Database (optional)

Set `DATABASE_URL` to any Postgres connection string (local or hosted), then:

```bash
npm run db:migrate                # applies drizzle/*.sql: snapshots / sim_runs / chat_messages
npm run refresh                   # asks the running app to scrape NSAA into the DB
```

With a DB, `/api/refresh` stores every NSAA page it fetches (full audit trail) and the app always builds from the
latest snapshot set. If the DB is unreachable the app logs a warning and serves the fixtures. After changing
`src/lib/db/schema.ts`, run `npm run db:generate` and commit the new migration.

## Production deployment (nsaa.rocketcore.ai)

Self-hosted behind nginx on a Debian/Ubuntu box that already runs Postgres. On the server, as the user the app should
run as (not root, needs sudo):

```bash
git clone <repo> nsaa-volleyball-agent && cd nsaa-volleyball-agent
bash deploy/install.sh            # prompts for port, Anthropic key, Let's Encrypt email on the first run
```

`deploy/install.sh` is idempotent — re-run it after `git pull` to update. It:

1. checks Node ≥ 20.9 and local Postgres; installs nginx / certbot (apt) and PM2 (npm -g) if missing
2. creates `.env` from `.env.example` (mode 600) with generated `CRON_SECRET` and DB password
3. creates the Postgres role + database, runs migrations, `npm ci`, `npm run build`
4. runs the app under the app user's PM2 (`ecosystem.config.cjs`): `<service>` (the app on `127.0.0.1:$PORT`) and
   `<service>-refresh` (NSAA scrape, hourly via `cron_restart`); saves the list and registers PM2 to start on boot.
   Removes the systemd units older versions of the installer created.
5. writes the nginx site + proxy snippet (`deploy/nginx/`), gets a certificate with `certbot --webroot`, switches to HTTPS
6. the refresh job runs once at start, so a fresh NSAA snapshot lands right away

DNS for the domain must point at the server before the certificate step; until then run with `SKIP_TLS=1`.
Every setting can be passed as an env var for a non-interactive first run:
`PORT=3100 CERTBOT_EMAIL=… ANTHROPIC_API_KEY=… bash deploy/install.sh`.

**Port.** `PORT` (and `HOST`, default `127.0.0.1`) in `.env` set where the app listens — choose one no other app on
the server uses; the installer refuses a port that's taken. Next.js can't read `PORT` from `.env` on its own, so
`npm start` goes through `scripts/start.mjs`. After editing `.env`, `pm2 restart <service>` (re-run the
installer if you change `PORT` or `DOMAIN`, so nginx follows).

**nginx** rate-limits `/api/chat` (6/min per IP, burst 5 — it spends Anthropic credits), other `/api/*` (30/min),
disables buffering for the chat stream, and blocks `/api/refresh` publicly (the timer calls the app directly).

## Chat agent

`POST /api/chat` runs a tool-use loop with the Anthropic SDK and streams NDJSON (`text`, `tool`, `done` events).
Model defaults to `claude-sonnet-4-5`; set `ANTHROPIC_MODEL` to change it.

Tools available to the model: `get_standings`, `get_projected_brackets`, `simulate_postseason`, `team_outlook`,
`head_to_head`, `get_team_schedule`, `fetch_nsaa_bracket` (live, once NSAA posts pairings Oct 22),
`fetch_district_finals`, `distance_between`, `get_rules`.

## How the model works (and its limits)

- **Seeding is arithmetic.** Wildcard averages are computed exactly as NSAA does; the only uncertainty before Oct 22 is
  the handful of unplayed matches through the Oct 20 cutoff, which the simulation samples.
- **Match outcomes** use a Bradley-Terry rating fit on individual sets (weight 0.5/set, ridge λ=1) with one home-court
  parameter (~0.16 set-logit this season). Ratings are drawn with estimation noise each simulation. It knows nothing about
  injuries, rosters, or momentum — treat probabilities as approximate and expect a good coach's eye to beat it on
  individual matches.
- **Sites** follow the manual's rules with straight-line × 1.17 road-mile estimates from `src/lib/engine/geo.ts`.
  `H&H`'s home site is a guess — verify. Only B and C2 schools have coordinates so far. A and D1/D2 don't need them
  (the higher / #1 seed always hosts), but C1's "play-in hosted by the higher seed if closer" rule falls back to the
  #1 seed, and `distance_between` can't measure A/C1/D schools.
- **Postseason results update averages** used for district-final seeding, the A/B wildcard, and state seeding, as
  the manual specifies.

## Formats by class (2026 manual)

| Class | Groups | Hosting | To state |
| --- | --- | --- | --- |
| A (34) | 7 districts, serpentine | higher seed, every round | 7 champions + 1 wildcard |
| B (31) | 7 districts, serpentine | higher seed; neutral site if > 300 mi before the final | 7 champions + 1 wildcard |
| C1/C2 (~55) | 4 regions → 10 sub-districts | #1 seed (play-in exception) | 10 winners + 6 at-large → 16-team district finals |
| D1/D2 (55) | 12 NSAA-assigned sub-districts (`distassign.php`) | #1 seed hosts all | 12 winners + 4 at-large → 16-team district finals |

## Key 2026 dates

Seeding through Tue Oct 20 → released Thu Oct 22 · A districts Oct 26–28 · B districts Oct 27/29/31 ·
C1/C2 sub-districts Oct 26–28 · D1/D2 sub-districts Oct 26–27 · District finals Sat Oct 31 · State in Lincoln Nov 4–7
(quarterfinals Nov 4 for A/B/C1, Nov 5 for C2/D1/D2).
