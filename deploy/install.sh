#!/bin/sh
# Install Haste on a Debian/Ubuntu VPS as a systemd service.
#
# Run it from the checked-out repository: `sudo sh deploy/install.sh`.
# The sources are copied to $APP_DIR and built there, so /opt/haste is a
# self-contained deployment rather than a checkout you have to keep up to date.
#
# Idempotent: re-running upgrades the code in place and leaves /etc/haste.env
# and the document store untouched.
#
#   sudo sh deploy/install.sh            # install and (re)build
#   sudo sh deploy/install.sh --no-build # reuse an existing packages/api/dist
#
# After it returns: edit /etc/haste.env, then `systemctl restart haste`.

set -eu

APP_DIR=${APP_DIR:-/opt/haste}
DATA_DIR=${DATA_DIR:-/var/lib/haste}
SERVICE_USER=${SERVICE_USER:-haste}
ENV_FILE=${ENV_FILE:-/etc/haste.env}
PORT_NUMBER=${PORT_NUMBER:-7777}
BUILD=1
[ "${1:-}" = "--no-build" ] && BUILD=0

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root (sudo)"

# The repository this script lives in: deploy/.. contains package.json.
SRC_DIR=$(cd "$(dirname "$0")/.." && pwd)
[ -f "$SRC_DIR/package.json" ] || die "$SRC_DIR is not the haste repository (no package.json)"
[ -f "$SRC_DIR/pnpm-lock.yaml" ] || die "$SRC_DIR has no pnpm-lock.yaml; installs must be reproducible"

# --- node -------------------------------------------------------------------
#
# The unit runs node from an absolute path, as the `haste` account. fnm, nvm and
# asdf install node under the invoking user's home, which that account cannot
# execute. A version manager also puts its shim first on PATH, so `command -v
# node` is the *wrong* answer on a machine that has both.
#
# Resolution order: $NODE_BIN, then the system paths, then PATH. A home-directory
# node is only an error when nothing else exists.
# fnm, nvm, asdf and volta each install under the user's home or a runtime dir,
# and put a shim first on PATH. Those paths are unusable by a system service
# account, so they are recognised by marker rather than only by prefix: an fnm
# shim can live under /run/user/<uid>/fnm_multishells/…
home_node() {
  case "$1" in
    /root/* | /home/* | /Users/*) return 0 ;;
    */fnm/* | */fnm_multishells/* | */nvm/* | */asdf/* | */volta/*) return 0 ;;
    */.local/state/* | */.cache/*) return 0 ;;
    *) return 1 ;;
  esac
}

NODE_BIN=${NODE_BIN:-}
if [ -z "$NODE_BIN" ]; then
  for candidate in /usr/bin/node /usr/local/bin/node /usr/sbin/node; do
    if [ -x "$candidate" ]; then
      NODE_BIN=$candidate
      break
    fi
  done
fi
if [ -z "$NODE_BIN" ]; then
  FOUND=$(command -v node || true)
  [ -n "$FOUND" ] || die "node is not installed; install Node 22+ system-wide"
  if home_node "$FOUND"; then
    die "the only node on this machine is $FOUND, which lives under a home directory
       and cannot be executed by the $SERVICE_USER service account. Install Node
       system-wide, then re-run:
         curl -fsSL https://deb.nodesource.com/setup_24.x | sudo sh -
         sudo apt-get install -y nodejs"
  fi
  NODE_BIN=$FOUND
fi

[ -x "$NODE_BIN" ] || die "$NODE_BIN is not executable"
NODE_MAJOR=$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 22 ] || die "$NODE_BIN is $("$NODE_BIN" -v); this package requires >= 22"
say "using node $("$NODE_BIN" -v) at $NODE_BIN"

# pnpm has the same home-directory problem, but only this script runs it: the
# unit does not. Prefer the sibling of the chosen node (corepack installs there),
# then PATH.
PNPM_BIN=${PNPM_BIN:-}
if [ -z "$PNPM_BIN" ]; then
  for candidate in "$(dirname "$NODE_BIN")/pnpm" /usr/bin/pnpm /usr/local/bin/pnpm; do
    if [ -x "$candidate" ]; then
      PNPM_BIN=$candidate
      break
    fi
  done
fi
if [ -z "$PNPM_BIN" ]; then
  PNPM_BIN=$(command -v pnpm || true)
fi
[ -n "$PNPM_BIN" ] || die "pnpm is not installed; run 'corepack enable' or 'npm i -g pnpm'"

# --- service account --------------------------------------------------------
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  say "creating user $SERVICE_USER"
  useradd --system --shell /usr/sbin/nologin --home-dir "$DATA_DIR" --no-create-home "$SERVICE_USER"
fi

# --- directories ------------------------------------------------------------
#
# The data dir must exist before the unit starts: ReadWritePaths cannot create
# it, and with PrivateTmp the path is resolved inside the unit's namespace.
say "preparing $APP_DIR and $DATA_DIR"
mkdir -p "$APP_DIR" "$DATA_DIR"

if [ "$BUILD" -eq 1 ]; then
  say "copying sources from $SRC_DIR to $APP_DIR"
  # Everything except build output, dependencies and repository history. The
  # trailing slash on the source copies its contents, not the directory.
  #
  # `dist` and `static/*.gz` are no longer root-relative after the move into
  # `packages/api`; rsync matches a bare name at any depth but a path with a
  # slash only at the top, which `--exclude node_modules` still covers.
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete \
      --exclude node_modules --exclude dist --exclude data --exclude .git \
      --exclude 'packages/api/static/*.gz' --exclude .vercel --exclude .commandcode \
      "$SRC_DIR"/ "$APP_DIR"/
  else
    ( cd "$SRC_DIR" && tar -cf - \
        --exclude=./node_modules --exclude=./dist --exclude=./data --exclude=./.git \
        --exclude=./packages/api/static/*.gz --exclude=./.vercel --exclude=./.commandcode . ) |
      ( cd "$APP_DIR" && tar -xf - )
  fi

  say "installing dependencies"
  ( cd "$APP_DIR" && "$PNPM_BIN" install --frozen-lockfile --prod=false )

  say "building"
  ( cd "$APP_DIR" && "$PNPM_BIN" run build )

  # No `prune --prod` here: at a workspace root it does not prune a single
  # package and fails outright when a workspace `package.json` has no
  # dependencies of its own. The unit runs `packages/api/dist/server.js`, whose
  # imports are all runtime dependencies, so dev dependencies left in the tree
  # are unused rather than harmful.
else
  [ -f "$APP_DIR/packages/api/dist/server.js" ] ||
    die "$APP_DIR/packages/api/dist is missing; drop --no-build"
fi

# The service reads the tree and never writes it.
chown -R root:"$SERVICE_USER" "$APP_DIR"
chmod -R o-rwx "$APP_DIR"
chown -R "$SERVICE_USER":"$SERVICE_USER" "$DATA_DIR"
chmod 0750 "$DATA_DIR"

# --- configuration ----------------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  say "writing $ENV_FILE"
  cat >"$ENV_FILE" <<EOF
# Haste configuration. Canonical names are HASTE_*; legacy aliases also work.
# An empty HASTE_CONFIG means "no config file": every value comes from here.
HASTE_CONFIG=
HASTE_STORAGE__TYPE=file
HASTE_STORAGE__PATH=$DATA_DIR
HASTE_HOST=127.0.0.1
HASTE_PORT=$PORT_NUMBER
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

# --- unit -------------------------------------------------------------------
#
# ExecStart is rewritten to the node that was validated above; everything else
# comes from deploy/haste.service verbatim.
say "installing /etc/systemd/system/haste.service"
sed "s|^ExecStart=.*|ExecStart=$NODE_BIN --enable-source-maps $APP_DIR/packages/api/dist/server.js|" \
  "$SRC_DIR/deploy/haste.service" >/etc/systemd/system/haste.service
sed -i "s|^WorkingDirectory=.*|WorkingDirectory=$APP_DIR/packages/api|" /etc/systemd/system/haste.service
sed -i "s|^ReadWritePaths=.*|ReadWritePaths=$DATA_DIR|" /etc/systemd/system/haste.service
chmod 0644 /etc/systemd/system/haste.service

systemctl daemon-reload
systemctl enable haste.service >/dev/null
systemctl restart haste.service

# --- readiness --------------------------------------------------------------
#
# Report what the service actually does, not what was intended.
say "waiting for readiness on 127.0.0.1:$PORT_NUMBER"
i=0
while [ "$i" -lt 30 ]; do
  if curl -fsS "http://127.0.0.1:$PORT_NUMBER/readyz" >/dev/null 2>&1; then
    say "haste is ready"
    say "  health : http://127.0.0.1:$PORT_NUMBER/healthz"
    say "  config : $ENV_FILE"
    say "  data   : $DATA_DIR"
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done

say "did not become ready within 30s; recent logs:"
journalctl -u haste.service -n 30 --no-pager || true
exit 1
