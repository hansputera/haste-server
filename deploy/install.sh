#!/bin/sh
# Install Haste on a Debian/Ubuntu VPS as a systemd service.
#
# Idempotent: safe to re-run for an upgrade. Assumes the repository has already
# been checked out into $APP_DIR and `npm ci && npm run build` has been run by
# the caller, or by this script with --build.
#
#   sudo sh deploy/install.sh            # install the unit, not the code
#   sudo sh deploy/install.sh --build    # npm ci + build first
#
# After it returns: edit /etc/haste.env, then `systemctl restart haste`.

set -eu

APP_DIR=${APP_DIR:-/opt/haste}
DATA_DIR=${DATA_DIR:-/var/lib/haste}
SERVICE_USER=${SERVICE_USER:-haste}
ENV_FILE=${ENV_FILE:-/etc/haste.env}
BUILD=0
[ "${1:-}" = "--build" ] && BUILD=1

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root (sudo)"

command -v node >/dev/null 2>&1 || die "node is not installed"
NODE_BIN=$(command -v node)
NODE_MAJOR=$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 22 ] || die "node $(node -v) is too old; this package requires >= 22"

# The unit runs /usr/bin/node. A node installed by nvm/fnm lives elsewhere and
# would not survive logout, so refuse rather than install a broken unit.
[ "$NODE_BIN" = /usr/bin/node ] || say "warning: node is $NODE_BIN, not /usr/bin/node; edit ExecStart in the unit"

# 1. Service account. A system user with no shell and no home.
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  say "creating user $SERVICE_USER"
  useradd --system --shell /usr/sbin/nologin --home-dir "$DATA_DIR" --no-create-home "$SERVICE_USER"
fi

# 2. Directories. The data dir must exist before the unit starts: ReadWritePaths
#    cannot create it, and PrivateTmp resolves it in the unit's namespace.
say "preparing $APP_DIR and $DATA_DIR"
mkdir -p "$APP_DIR" "$DATA_DIR"
[ "$BUILD" -eq 1 ] || [ -f "$APP_DIR/package.json" ] || die "$APP_DIR has no package.json; check APP_DIR or use --build"

if [ "$BUILD" -eq 1 ]; then
  say "building in $APP_DIR"
  ( cd "$APP_DIR" && npm ci --no-audit --no-fund && npm run build )
fi

chown -R root:"$SERVICE_USER" "$APP_DIR"
chmod -R o-rwx "$APP_DIR"
# Only the data directory is writable by the service.
chown -R "$SERVICE_USER":"$SERVICE_USER" "$DATA_DIR"
chmod 0750 "$DATA_DIR"

# 3. Environment file. Never overwrite an existing one.
if [ ! -f "$ENV_FILE" ]; then
  say "writing $ENV_FILE"
  cat >"$ENV_FILE" <<'EOF'
# Haste configuration. Canonical names are HASTE_*; legacy aliases also work.
HASTE_CONFIG=
HASTE_STORAGE__TYPE=file
HASTE_STORAGE__PATH=/var/lib/haste
HASTE_HOST=127.0.0.1
HASTE_PORT=7777
HASTE_MAX_LENGTH=400000
HASTE_KEY_LENGTH=10
HASTE_STATIC_MAX_AGE=86400
HASTE_LOGGING__LEVEL=info
# Rate limiting: requests per window, per client address.
HASTE_RATE_LIMITS__CATEGORIES__NORMAL__TOTAL_REQUESTS=500
HASTE_RATE_LIMITS__CATEGORIES__NORMAL__EVERY=60000
EOF
  chown root:"$SERVICE_USER" "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
fi

# 4. The unit.
say "installing /etc/systemd/system/haste.service"
install -m 0644 "$(dirname "$0")/haste.service" /etc/systemd/system/haste.service
systemctl daemon-reload
systemctl enable haste.service >/dev/null
systemctl restart haste.service

# 5. Wait for readiness rather than claiming success.
say "waiting for readiness"
i=0
while [ "$i" -lt 30 ]; do
  if curl -fsS http://127.0.0.1:7777/readyz >/dev/null 2>&1; then
    say "haste is ready on 127.0.0.1:7777"
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done

say "did not become ready within 30s; recent logs:"
journalctl -u haste.service -n 30 --no-pager || true
exit 1
