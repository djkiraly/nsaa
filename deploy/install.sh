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
# Assumes Postgres is installed and running locally. Installs nginx and certbot with apt if they're missing.
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
      -e "s|__USER__|$APP_USER|g" -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__NODE__|$NODE_BIN|g" \
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

command -v node >/dev/null || die "Node.js >= 20.9 is required (https://nodejs.org or nvm)"
node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 20 || (a === 20 && b >= 9) ? 0 : 1)' \
  || die "Node.js >= 20.9 is required (found $(node -v))"
NODE_BIN=$(command -v node)
command -v npm >/dev/null || die "npm is required"
command -v curl >/dev/null || apt_install curl

pg -tAc 'select 1' >/dev/null || die "can't reach the local Postgres server as the postgres superuser"
echo "  node $(node -v) · $(pg -tAc 'select version()' | cut -d' ' -f1-2) · user $APP_USER · $APP_DIR"

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
ask SERVICE_NAME "Service name (systemd unit, database, nginx files)"
ask PORT "App port — must not clash with other apps on this server"
ask ANTHROPIC_API_KEY "Anthropic API key (blank disables chat)"
if [[ ${SKIP_TLS:-0} != 1 ]]; then ask CERTBOT_EMAIL "Email for Let's Encrypt notices"; fi
[[ -n $(get_env HOST) ]] || set_env HOST 127.0.0.1

[[ $DOMAIN =~ ^[A-Za-z0-9.-]+$ ]] || die "DOMAIN looks wrong: '$DOMAIN'"
[[ $SERVICE_NAME =~ ^[a-z][a-z0-9_-]*$ ]] || die "SERVICE_NAME must be lowercase letters, digits, - or _"
[[ $PORT =~ ^[0-9]+$ ]] && (( PORT >= 1024 && PORT <= 65535 )) || die "PORT must be a number between 1024 and 65535"
[[ -n $ANTHROPIC_API_KEY ]] || warn "ANTHROPIC_API_KEY is empty — the chat page will return errors until it's set in .env"

CRON_SECRET=$(get_env CRON_SECRET)
if [[ -z $CRON_SECRET || $CRON_SECRET == change-me ]]; then set_env CRON_SECRET "$(random_hex 32)"; fi

if [[ -n $(ss -ltnH "sport = :$PORT" 2>/dev/null) ]] && ! systemctl is-active --quiet "$SERVICE_NAME"; then
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

# --- 5. systemd ----------------------------------------------------------------------------------------------------

say "Installing systemd units"
install_file "$DEPLOY_DIR/systemd/app.service" "/etc/systemd/system/$SERVICE_NAME.service"
install_file "$DEPLOY_DIR/systemd/refresh.service" "/etc/systemd/system/$SERVICE_NAME-refresh.service"
install_file "$DEPLOY_DIR/systemd/refresh.timer" "/etc/systemd/system/$SERVICE_NAME-refresh.timer"
sudo systemctl daemon-reload
sudo systemctl enable --quiet "$SERVICE_NAME" "$SERVICE_NAME-refresh.timer"
sudo systemctl restart "$SERVICE_NAME"
sudo systemctl start "$SERVICE_NAME-refresh.timer"

printf '  waiting for the app on 127.0.0.1:%s ' "$PORT"
up=0
for _ in $(seq 90); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/"; then up=1; break; fi
  printf '.'; sleep 1
done
echo
[[ $up == 1 ]] || die "app didn't come up — check: journalctl -u $SERVICE_NAME -n 100"

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

# --- 7. first snapshot ---------------------------------------------------------------------------------------------

say "Fetching a fresh NSAA snapshot"
sudo systemctl start "$SERVICE_NAME-refresh.service" \
  || warn "initial refresh failed (journalctl -u $SERVICE_NAME-refresh) — the app serves the bundled fixtures until a refresh succeeds"

scheme=https; [[ ${SKIP_TLS:-0} != 1 ]] || scheme=http
say "Done"
cat <<EOF
  Site:      $scheme://$DOMAIN  →  127.0.0.1:$PORT
  Service:   sudo systemctl status $SERVICE_NAME   ·   journalctl -u $SERVICE_NAME -f
  Refresh:   hourly ($SERVICE_NAME-refresh.timer)  ·  now: sudo systemctl start $SERVICE_NAME-refresh
  Database:  $DB_NAME @ $DB_HOST:$DB_PORT
  Config:    $ENV_FILE  (restart after edits: sudo systemctl restart $SERVICE_NAME)
  Update:    git pull && bash deploy/install.sh
EOF
