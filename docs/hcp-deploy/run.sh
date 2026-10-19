#!/usr/bin/env bash
# Start HCP (real-data backend) on loopback: API on 4312, Caddy front door on 4311. Usage: run.sh start|stop|status
set -u
D="$(cd "$(dirname "$0")" && pwd)"
set -a; . "$D/hcp.env"; set +a
case "${1:-status}" in
  start)
    cd "$D/src/apps/server"
    COMMITAR_BACKEND=next COMMITAR_NEXT_DB="$D/data/commitar-next.db" COMMITAR_NEXT_HUMANS="mariano=Mariano Capella" PORT=4312 \
      setsid nohup npx tsx src/index.ts > "$D/logs/server.log" 2>&1 < /dev/null &
    echo $! > "$D/server.pid"
    cd "$D"; setsid nohup caddy run --config "$D/Caddyfile" --adapter caddyfile > "$D/logs/caddy.log" 2>&1 < /dev/null &
    echo $! > "$D/caddy.pid"; sleep 4; "$0" status ;;
  stop)
    pkill -u "$(id -u)" -f "$D/src/node_modules/.bin/tsx" ; pkill -u "$(id -u)" -f "tsx/dist/loader.mjs src/index.ts" ; pkill -u "$(id -u)" -f "caddy run --config $D/Caddyfile"
    rm -f "$D/server.pid" "$D/caddy.pid"; sleep 1; "$0" status ;;
  status)
    for p in 4311 4312; do ss -ltn "sport = :$p" | grep -q LISTEN && echo "listening 127.0.0.1:$p" || echo "NOT listening :$p"; done ;;
esac
