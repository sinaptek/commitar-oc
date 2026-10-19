# HCP deployment (real-data backend), 2026-10-19

What is running, how to reach it, and what it is not. Files: `docs/hcp-deploy/Caddyfile` and `docs/hcp-deploy/run.sh` (copies of the ones in `~/hcp-deploy` on blocksight-chain; the token is in `~/hcp-deploy/hcp.env`, never in the repo).

## What runs
- commitar-hcp `main` (merge commit 8c612a7), cloned to `~/hcp-deploy/src`, web built with `VITE_API_BASE_URL=/api` so the UI and API share one origin.
- API: `COMMITAR_BACKEND=next` (CommitarNextAdapter, own SQLite at `~/hcp-deploy/data/commitar-next.db`), on `127.0.0.1:4312`, one registered human (`mariano`).
- Front door: a user-level Caddy on `127.0.0.1:4311` serving the built UI, proxying `/api/*`, and answering 401 to `POST /api/handoffs` without `Authorization: Bearer <token>`.
- Start, stop, status: `~/hcp-deploy/run.sh start|stop|status`.

## Reaching it
Loopback only, so from another machine use a tunnel: `ssh -L 4311:127.0.0.1:4311 <user>@<host>`, then open http://localhost:4311/waiting-for-human?presenter=1&lang=en.
Push from a project: `COMMITAR_HCP_TOKEN=<token> commitar-oc handoff push <dir> --url http://127.0.0.1:4311` (through the tunnel, the same url).

## Why it looks like this
- No root and no docker group for the deploying user, so no system service, container or system Caddy config.
- The host has a public IP. The HCP server binds `0.0.0.0` as soon as `COMMITAR_NEXT_TOKEN` is set, and `POST /api/decisions` has no login, so the server runs without its own token on loopback and the token is enforced by Caddy instead. A first Caddy start without `bind 127.0.0.1` listened on `*:4311`; it was stopped within a minute, and the fixed config was checked from the public address (connection refused on 4311 and 4312).
- Caddy needed the token check in its own `handle` block placed first; as a bare `respond` it ran after the `handle` blocks and let unauthenticated pushes through (caught by testing, fixed).

## Limits (honest)
- Not reboot-safe: it is a background process of one user (no linger, no service). After a reboot, run `run.sh start`.
- Still the same machine as everything else, so acceptance criterion C7 (an HCP on another machine) stays open.
- The deciding side has no login: anyone who can reach port 4311 can decide. Reachability (loopback and an ssh tunnel) is the only protection. The token only protects ingest.
- Anyone with a shell on this host can reach port 4312 directly and skip the token.
- Moving it to a service or container later needs root or docker access, plus `COMMITAR_NEXT_TOKEN` handling in the server (it binds `0.0.0.0` with a token).
