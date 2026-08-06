#!/usr/bin/env bash
#
# Local verification database for Mad's Atlas.
#
# Stands up a throwaway PostgreSQL cluster, applies the Supabase test shim and
# then every real migration in order. This is what makes the RLS policies and
# the approval claim genuinely testable instead of merely asserted.
#
# It is a TEST harness. It is not how the production schema is deployed —
# that is `supabase db push` against a linked project (see SUPABASE_SETUP.md).
#
# Usage:
#   bash scripts/local-db.sh start     # create, start, migrate; prints TEST_DB_URL
#   bash scripts/local-db.sh stop      # stop the cluster
#   bash scripts/local-db.sh reset     # destroy and rebuild from scratch
#   bash scripts/local-db.sh psql      # open a shell against it
#
set -euo pipefail

# PostgreSQL refuses to run as root. When invoked as root (containers, CI), we
# hand the whole script to the unprivileged `postgres` user rather than asking
# the caller to remember to.
PG_RUN_AS="${PG_RUN_AS:-postgres}"
if [ "$(id -u)" = "0" ] && [ "${ATLAS_DB_REEXEC:-}" != "1" ]; then
  if ! id "$PG_RUN_AS" >/dev/null 2>&1; then
    echo "Cannot run PostgreSQL as root and user '$PG_RUN_AS' does not exist." >&2
    exit 1
  fi
  mkdir -p /tmp/atlas-pgdata /tmp/atlas-pgsock
  chown -R "$PG_RUN_AS" /tmp/atlas-pgdata /tmp/atlas-pgsock
  exec setpriv --reuid="$PG_RUN_AS" --regid="$(id -g "$PG_RUN_AS")" --init-groups \
    env ATLAS_DB_REEXEC=1 HOME=/tmp bash "$0" "$@"
fi

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="${PGDATA:-/tmp/atlas-pgdata}"
PGPORT="${PGPORT:-55432}"
PGDATABASE="atlas_test"
SOCKET_DIR="/tmp/atlas-pgsock"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"
SHIM="$REPO_ROOT/tests/fixtures/supabase-shim.sql"

export PGHOST="$SOCKET_DIR"
export PGPORT

log() { printf '  %s\n' "$*"; }

require_postgres() {
  if [ ! -x "$PGBIN/initdb" ]; then
    echo "PostgreSQL server binaries not found at $PGBIN" >&2
    echo "Install with: apt-get install -y postgresql-16 postgresql-16-pgvector" >&2
    exit 1
  fi
  if [ ! -f /usr/share/postgresql/16/extension/vector.control ]; then
    echo "pgvector is not installed — the memory schema needs it." >&2
    echo "Install with: apt-get install -y postgresql-16-pgvector" >&2
    exit 1
  fi
}

is_running() {
  "$PGBIN/pg_isready" -h "$SOCKET_DIR" -p "$PGPORT" >/dev/null 2>&1
}

start_cluster() {
  require_postgres
  mkdir -p "$SOCKET_DIR"

  if [ ! -d "$PGDATA/base" ]; then
    log "Initialising cluster at $PGDATA"
    "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust >/dev/null
  fi

  if is_running; then
    log "Cluster already running on port $PGPORT"
  else
    log "Starting cluster on port $PGPORT"
    "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PGPORT -k $SOCKET_DIR -c listen_addresses=''" \
      -l "$PGDATA/server.log" -w start >/dev/null
  fi
}

apply_schema() {
  log "Creating database $PGDATABASE"
  "$PGBIN/dropdb" -U postgres --if-exists "$PGDATABASE" >/dev/null 2>&1 || true
  "$PGBIN/createdb" -U postgres "$PGDATABASE"

  log "Applying Supabase test shim"
  # pgcrypto first: the shim's auth.users default needs gen_random_uuid().
  psql -U postgres -d "$PGDATABASE" -v ON_ERROR_STOP=1 -q \
    -c 'create extension if not exists pgcrypto;' >/dev/null
  psql -U postgres -d "$PGDATABASE" -v ON_ERROR_STOP=1 -q -f "$SHIM" >/dev/null

  local count=0
  for migration in "$MIGRATIONS_DIR"/*.sql; do
    [ -e "$migration" ] || continue
    log "Applying $(basename "$migration")"
    # Supabase-only extensions are already provided by the shim; skip the
    # CREATE EXTENSION lines for them rather than editing the real migration.
    sed -e '/create extension if not exists "pg_cron"/d' \
        -e '/create extension if not exists "pg_net"/d' \
        "$migration" \
      | psql -U postgres -d "$PGDATABASE" -v ON_ERROR_STOP=1 -q
    count=$((count + 1))
  done

  log "Applied $count migrations"
}

case "${1:-start}" in
  start)
    start_cluster
    apply_schema
    echo
    echo "TEST_DB_URL=postgresql://postgres@localhost/${PGDATABASE}?host=${SOCKET_DIR}&port=${PGPORT}"
    echo
    log "Run integration tests with:"
    log "  export TEST_DB_URL='postgresql://postgres@/${PGDATABASE}?host=${SOCKET_DIR}&port=${PGPORT}'"
    log "  npm run test:integration"
    ;;
  stop)
    if is_running; then
      "$PGBIN/pg_ctl" -D "$PGDATA" -w stop >/dev/null
      log "Stopped"
    else
      log "Not running"
    fi
    ;;
  reset)
    if is_running; then "$PGBIN/pg_ctl" -D "$PGDATA" -w stop >/dev/null; fi
    rm -rf "$PGDATA"
    start_cluster
    apply_schema
    log "Reset complete"
    ;;
  psql)
    exec psql -U postgres -d "$PGDATABASE"
    ;;
  *)
    echo "Usage: $0 {start|stop|reset|psql}" >&2
    exit 1
    ;;
esac
