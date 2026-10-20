#!/usr/bin/env bash
# Pull the latest code and redeploy if anything changed. Needs no sudo, so it can run unattended from cron:
#
#   crontab -e        # as the app user
#   30 8 * * * /var/www/nsaa/deploy/update.sh >> "$HOME/nsaa-update.log" 2>&1
#
# Steps: fast-forward to origin, `npm ci` (only when package.json / package-lock.json changed), db:migrate, build,
# PM2 reload, health check. If any step fails it resets to the previous commit, rebuilds and reloads, so a bad push
# can't leave the site down. Database migrations aren't undone by the rollback.
#
# nginx config and the installer itself need root, so changes to them are only reported — run deploy/install.sh by
# hand to apply those.

# Everything is inside main() so bash parses the whole file before running it — this script updates itself mid-run.
main() {
  set -uo pipefail
  local app_dir lock prev new branch port
  app_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  cd "$app_dir" || exit 1
  export PATH="$PATH:/usr/local/bin:/usr/bin:/bin" # cron's PATH is minimal; node/npm/pm2 usually live here

  lock="/tmp/$(basename "$app_dir")-update.lock"
  exec 9>"$lock"
  flock -n 9 || { log "another update is already running"; exit 0; }

  # The IP-location database (analytics) is refreshed monthly regardless of code changes; the app reloads it itself.
  node scripts/geoip.mjs --max-age-days 32 || log "IP-location database refresh failed — keeping the old one"

  if [[ -n $(git status --porcelain --untracked-files=no) ]]; then
    log "local changes in $app_dir — not updating (git status to see them)"
    exit 1
  fi
  git fetch --quiet origin || { log "git fetch failed"; exit 1; }
  branch=$(git rev-parse --abbrev-ref HEAD)
  prev=$(git rev-parse HEAD)
  new=$(git rev-parse "origin/$branch")
  if [[ $prev == "$new" ]]; then
    log "up to date at $(git rev-parse --short HEAD)"
    exit 0
  fi
  if ! git merge-base --is-ancestor "$prev" "$new"; then
    log "origin/$branch isn't a fast-forward of the deployed commit — not updating"
    exit 1
  fi

  port=$(grep -E '^PORT=' .env | tail -n1 | cut -d= -f2-)
  log "updating $(git rev-parse --short "$prev") → $(git rev-parse --short "$new")"
  git log --oneline "$prev..$new" | sed 's/^/    /'

  if deploy "$new" "$prev" "$port"; then
    log "deployed $(git rev-parse --short "$new")"
    if ! git diff --quiet "$prev" "$new" -- deploy/install.sh deploy/nginx; then
      log "NOTE: deploy/install.sh or deploy/nginx changed — run ./deploy/install.sh by hand to apply them"
    fi
    exit 0
  fi

  log "update failed — rolling back to $(git rev-parse --short "$prev")"
  if deploy "$prev" "$new" "$port"; then
    log "rolled back; still serving $(git rev-parse --short "$prev")"
  else
    log "ROLLBACK FAILED — site may be down: pm2 logs and npm run build in $app_dir"
  fi
  exit 1
}

log() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }

# deploy <commit> <commit it replaces> <port>: check out, install if deps changed, migrate, build, reload, health-check.
deploy() {
  local to=$1 from=$2 port=$3
  git reset --hard --quiet "$to" || return 1
  if ! git diff --quiet "$from" "$to" -- package.json package-lock.json; then
    npm ci --include=dev --no-audit --no-fund || return 1
  fi
  npm run --silent db:migrate || return 1
  npm run build || return 1
  pm2 startOrReload ecosystem.config.cjs --update-env || return 1
  for _ in $(seq 60); do
    if curl -fsS -o /dev/null "http://127.0.0.1:$port/"; then
      pm2 save --force >/dev/null
      return 0
    fi
    sleep 2
  done
  log "health check failed: http://127.0.0.1:$port/ didn't return 200 within 2 minutes"
  return 1
}

main "$@"
