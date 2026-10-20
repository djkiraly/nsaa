#!/usr/bin/env bash
# Install or update the NSAA volleyball agent on a Debian/Ubuntu server.
#
# Run from the cloned repo as the user the app should run as (not root; needs sudo):
#   bash deploy/install.sh
# Re-run after `git pull` to update — every step is idempotent.
#
# Settings live in .env (created from .env.example on the first run, prompting for the important ones).
# Any setting can be passed as an environment variable instead, which also makes the first run non-interactive:
#   PORT=3100 CERTBOT_EMAIL=you@example.com ANTHROPIC_API_KEY=sk-ant-... bash deploy/install.sh
# SKIP_TLS=1 configures nginx for plain HTTP only (e.g. while DNS isn't pointed at the server yet).
#
# Assumes Postgres is installed and running locally. Installs nginx and certbot with apt and PM2 with npm if they're
# missing. The app and its hourly refresh run under the app user's PM2 (ecosystem.config.cjs), started on boot.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="$APP_DIR/deploy"
ENV_FILE="$APP_DIR/.env"
WEBROOT=/var/www/letsencrypt
cd "$APP_DIR"

say()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

random_hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }

# --- .env helpers --------------------------------------------------------------------------------------------------

get_env() {
  [[ -f $ENV_FILE ]] || return 0
  grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -E "s/^\"(.*)\"\$/\\1/; s/^'(.*)'\$/\\1/" || true
}

set_env() {
  local key=$1 val=$2
  if grep -qE "^$key=" "$ENV_FILE"; then
    (umask 077; K="$key" V="$val" awk -F= '$1 == ENVIRON["K"] { print ENVIRON["K"] "=" ENVIRON["V"]; next } { print }' \
      "$ENV_FILE" > "$ENV_FILE.tmp")
    cat "$ENV_FILE.tmp" > "$ENV_FILE" && rm -f "$ENV_FILE.tmp"
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

# ask KEY "prompt": an environment variable wins; otherwise prompt (first run, or when the value is empty), keeping the
# current .env value as the default. The result is written to .env and set as a shell variable.
ask() {
  local key=$1 prompt=$2 val reply
  if [[ -n ${!key:-} ]]; then
    val=${!key}
  else
    val=$(get_env "$key")
    if [[ -t 0 && ( -z $val || $FIRST_RUN == 1 ) ]]; then
      read -rp "  $prompt${val:+ [$val]}: " reply
      val=${reply:-$val}
    fi
  fi
  set_env "$key" "$val"
  printf -v "$key" '%s' "$val"
}

# --- system helpers ------------------------------------------------------------------------------------------------

pg() { (cd / && sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 "$@"); }

APT_UPDATED=0
apt_install() {
  command -v apt-get >/dev/null || die "$* not installed and apt-get is unavailable — install it manually and re-run"
  if [[ $APT_UPDATED == 0 ]]; then sudo apt-get update -qq; APT_UPDATED=1; fi
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@"
}

render() {
  sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__PORT__|$PORT|g" -e "s|__SERVICE__|$SERVICE_NAME|g" \
      -e "s|__WEBROOT__|$WEBROOT|g" -e "s|__SNIPPET__|$NGINX_SNIPPET|g" "$1"
}

install_file() { render "$1" | sudo tee "$2" >/dev/null; sudo chmod 644 "$2"; }

# Install the site config + proxy snippet, test, reload. On a failed test, put the previous files back so a bad
# config never takes down the other sites on this nginx.
nginx_apply() {
  local tpl=$1 f backups=()
  for f in "$NGINX_SITE" "$NGINX_SNIPPET"; do
    if sudo test -f "$f"; then sudo cp -p "$f" "$f.bak"; backups+=("$f"); fi
  done
  install_file "$DEPLOY_DIR/nginx/locations.conf" "$NGINX_SNIPPET"
  install_file "$DEPLOY_DIR/nginx/$tpl" "$NGINX_SITE"
  [[ -z $NGINX_LINK ]] || sudo ln -sfn "$NGINX_SITE" "$NGINX_LINK"
  if ! sudo nginx -t -q; then
    for f in "$NGINX_SITE" "$NGINX_SNIPPET"; do
      if [[ " ${backups[*]} " == *" $f "* ]]; then sudo mv "$f.bak" "$f"; else sudo rm -f "$f"; fi
    done
    [[ ${#backups[@]} -gt 0 || -z $NGINX_LINK ]] || sudo rm -f "$NGINX_LINK"
    die "nginx config test failed — previous config restored"
  fi
  for f in "${backups[@]}"; do sudo rm -f "$f.bak"; done
  sudo systemctl enable --quiet nginx
  sudo systemctl reload-or-restart nginx
}

# --- 1. preflight --------------------------------------------------------------------------------------------------

say "Checking prerequisites"
[[ $EUID -ne 0 ]] || die "run as the user the app should run as (with sudo rights), not as root"
command -v sudo >/dev/null || die "sudo is required"
sudo -v
APP_USER=$(id -un)
not_owned=$(find "$APP_DIR" -not -user "$APP_USER" -print -quit)
[[ -z $not_owned ]] || die "$not_owned isn't owned by $APP_USER (cloned as another user?) — fix with:
  sudo chown -R $APP_USER:$APP_USER $APP_DIR"

command -v node >/dev/null || die "Node.js >= 20.9 is required (https://nodejs.org or nvm)"
node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 20 || (a === 20 && b >= 9) ? 0 : 1)' \
  || die "Node.js >= 20.9 is required (found $(node -v))"
command -v npm >/dev/null || die "npm is required"
command -v curl >/dev/null || apt_install curl
if ! command -v pm2 >/dev/null; then
  echo "  installing PM2"
  if [[ -w $(npm root -g) ]]; then npm install -g --no-audit --no-fund pm2@latest
  else sudo env "PATH=$PATH" npm install -g --no-audit --no-fund pm2@latest; fi
fi
PM2_BIN=$(command -v pm2) || die "PM2 install failed"

pg -tAc 'select 1' >/dev/null || die "can't reach the local Postgres server as the postgres superuser"
echo "  node $(node -v) · pm2 $(pm2 -v) · $(pg -tAc 'select version()' | cut -d' ' -f1-2) · user $APP_USER · $APP_DIR"

# --- 2. .env -------------------------------------------------------------------------------------------------------

say "Configuring $ENV_FILE"
FIRST_RUN=0
if [[ ! -f $ENV_FILE ]]; then
  FIRST_RUN=1
  cp .env.example "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"
[[ ! -f $APP_DIR/.env.local && ! -f $APP_DIR/.env.production.local ]] \
  || warn ".env.local / .env.production.local exist and override .env at runtime — remove them unless intended"

ask DOMAIN "Public domain"
ask SERVICE_NAME "Service name (PM2 process, database, nginx files)"
ask PORT "App port — must not clash with other apps on this server"
ask ANTHROPIC_API_KEY "Anthropic API key (blank disables chat)"
if [[ ${SKIP_TLS:-0} != 1 ]]; then ask CERTBOT_EMAIL "Email for Let's Encrypt notices"; fi
[[ -n $(get_env HOST) ]] || set_env HOST 127.0.0.1
# Settings passed on the command line are exported; keep them out of PM2's environment, or PM2 would freeze them into
# its process list and they'd silently win over later edits to .env.
export -n DOMAIN SERVICE_NAME PORT ANTHROPIC_API_KEY CERTBOT_EMAIL

[[ $DOMAIN =~ ^[A-Za-z0-9.-]+$ ]] || die "DOMAIN looks wrong: '$DOMAIN'"
[[ $SERVICE_NAME =~ ^[a-z][a-z0-9_-]*$ ]] || die "SERVICE_NAME must be lowercase letters, digits, - or _"
[[ $PORT =~ ^[0-9]+$ ]] && (( PORT >= 1024 && PORT <= 65535 )) || die "PORT must be a number between 1024 and 65535"
[[ -n $ANTHROPIC_API_KEY ]] || warn "ANTHROPIC_API_KEY is empty — the chat page will return errors until it's set in .env"

CRON_SECRET=$(get_env CRON_SECRET)
if [[ -z $CRON_SECRET || $CRON_SECRET == change-me ]]; then set_env CRON_SECRET "$(random_hex 32)"; fi

pm2_online() { [[ $(pm2 pid "$SERVICE_NAME" 2>/dev/null) =~ ^[1-9][0-9]*$ ]]; }
# The port may be held by this app itself: under PM2, or as the systemd unit older installs used (removed below).
if [[ -n $(ss -ltnH "sport = :$PORT" 2>/dev/null) ]] && ! pm2_online && ! systemctl is-active --quiet "$SERVICE_NAME"; then
  die "port $PORT is already in use by another process — choose another PORT in .env"
fi

# --- 3. Postgres ---------------------------------------------------------------------------------------------------

say "Configuring Postgres"
if [[ -z $(get_env DATABASE_URL) ]]; then
  db_name=${SERVICE_NAME//-/_}
  set_env DATABASE_URL "postgres://$db_name:$(random_hex 24)@127.0.0.1:$(pg -tAc 'show port')/$db_name"
fi
mapfile -t db < <(node -e '
  const u = new URL(process.argv[1]);
  console.log([u.hostname, u.port || "5432", decodeURIComponent(u.username), decodeURIComponent(u.password),
    decodeURIComponent(u.pathname.slice(1))].join("\n"));' "$(get_env DATABASE_URL)")
DB_HOST=${db[0]} DB_PORT=${db[1]} DB_USER=${db[2]} DB_PASS=${db[3]} DB_NAME=${db[4]}

if [[ $DB_HOST == 127.0.0.1 || $DB_HOST == localhost ]]; then
  # Create the role and database if needed; keep the role's password in sync with .env.
  pg -v user="$DB_USER" -v pass="$DB_PASS" -v db="$DB_NAME" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', :'user') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'user') \gexec
SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'user', :'pass') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'user') WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec
SQL
  echo "  database $DB_NAME, role $DB_USER on $DB_HOST:$DB_PORT"
else
  echo "  DATABASE_URL points at $DB_HOST — using it as-is (not provisioning)"
fi

# --- 4. build ------------------------------------------------------------------------------------------------------

say "Installing dependencies"
npm ci --include=dev --no-audit --no-fund

say "Migrating database"
npm run --silent db:migrate

say "Building"
npm run build

# --- 5. PM2 --------------------------------------------------------------------------------------------------------

# Earlier versions of this installer ran the app as systemd units. Stop and remove them so PM2 owns the app and its
# port. Only units this installer generated (or the empty file a failed run could leave) are touched.
removed=0
for unit in "$SERVICE_NAME-refresh.timer" "$SERVICE_NAME-refresh.service" "$SERVICE_NAME.service"; do
  f=/etc/systemd/system/$unit
  [[ -e $f ]] || continue
  if [[ ! -s $f ]] || grep -q "Generated from deploy/systemd/" "$f"; then
    [[ $removed == 1 ]] || say "Removing the old systemd units"
    sudo systemctl disable --now --quiet "$unit" 2>/dev/null || true
    sudo rm -f "$f"
    echo "  removed $unit"
    removed=1
  else
    warn "$f wasn't created by this installer — leaving it alone"
  fi
done
if [[ $removed == 1 ]]; then
  sudo systemctl daemon-reload
  sudo systemctl reset-failed 2>/dev/null || true
fi

say "Starting $SERVICE_NAME with PM2"
pm2 startOrReload ecosystem.config.cjs --update-env

printf '  waiting for the app on 127.0.0.1:%s ' "$PORT"
up=0
for _ in $(seq 90); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/"; then up=1; break; fi
  printf '.'; sleep 1
done
echo
[[ $up == 1 ]] || die "app didn't come up — check: pm2 logs $SERVICE_NAME --lines 100 --nostream"

# Persist the process list and resurrect it on boot (systemd unit pm2-$APP_USER, created once).
pm2 save --force >/dev/null
if ! systemctl is-enabled --quiet "pm2-$APP_USER" 2>/dev/null; then
  sudo env "PATH=$PATH" "$PM2_BIN" startup systemd -u "$APP_USER" --hp "$HOME"
fi
pm2 describe pm2-logrotate >/dev/null 2>&1 || pm2 install pm2-logrotate

# --- 6. nginx + TLS ------------------------------------------------------------------------------------------------

say "Configuring nginx for $DOMAIN"
command -v nginx >/dev/null || apt_install nginx
if [[ -d /etc/nginx/sites-available ]]; then
  NGINX_SITE=/etc/nginx/sites-available/$DOMAIN.conf
  NGINX_LINK=/etc/nginx/sites-enabled/$DOMAIN.conf
else
  NGINX_SITE=/etc/nginx/conf.d/$DOMAIN.conf
  NGINX_LINK=
fi
NGINX_SNIPPET=/etc/nginx/snippets/$SERVICE_NAME-locations.conf
sudo install -d -m 755 /etc/nginx/snippets "$WEBROOT"

if [[ ${SKIP_TLS:-0} == 1 ]]; then
  nginx_apply site-http.conf
  warn "SKIP_TLS=1 — serving plain HTTP. Re-run without it once DNS for $DOMAIN points here."
else
  if ! sudo test -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem"; then
    [[ -n $CERTBOT_EMAIL ]] || die "CERTBOT_EMAIL is required to request a certificate (or run with SKIP_TLS=1)"
    command -v certbot >/dev/null || apt_install certbot
    nginx_apply site-http.conf
    say "Requesting a Let's Encrypt certificate"
    sudo certbot certonly --webroot -w "$WEBROOT" -d "$DOMAIN" \
      --email "$CERTBOT_EMAIL" --agree-tos --no-eff-email --non-interactive \
      --deploy-hook "systemctl reload nginx" \
      || die "certbot failed — check that DNS for $DOMAIN points at this server and port 80 is reachable. \
The site is being served over plain HTTP meanwhile; re-run once fixed."
  fi
  nginx_apply site-https.conf
  timers=$(systemctl list-timers --all 2>/dev/null || true)
  [[ $timers == *certbot* || -f /etc/cron.d/certbot ]] \
    || warn "no certbot renewal timer/cron found — certificates won't auto-renew"
fi

if command -v ufw >/dev/null; then
  ufw_status=$(sudo ufw status 2>/dev/null || true)
  if [[ $ufw_status == *"Status: active"* && ! $ufw_status =~ (^|[[:space:]])(80|443|Nginx) ]]; then
    warn "ufw is active and may block ports 80/443: sudo ufw allow 'Nginx Full'"
  fi
fi

scheme=https; [[ ${SKIP_TLS:-0} != 1 ]] || scheme=http
say "Done"
pm2 status
cat <<EOF
  Site:      $scheme://$DOMAIN  →  127.0.0.1:$PORT
  App:       pm2 logs $SERVICE_NAME   ·   pm2 restart $SERVICE_NAME
  Refresh:   $SERVICE_NAME-refresh runs hourly (it just ran once)  ·  now: pm2 restart $SERVICE_NAME-refresh
  Database:  $DB_NAME @ $DB_HOST:$DB_PORT
  Config:    $ENV_FILE  (after edits: pm2 restart $SERVICE_NAME)
  Update:    git pull && bash deploy/install.sh
EOF
