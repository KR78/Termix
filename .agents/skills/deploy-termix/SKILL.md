---
name: deploy-termix
description: |
  Build + deploy custom Termix changes to term.vec.run. Builds the Docker image
  from the KR78/Termix fork's lab branch, restarts the compose stack, and
  verifies the live site. Use when modifying Termix source (frontend or
  backend), after merging upstream, or when term.vec.run needs to reflect local
  changes. Also covers the three-branch git model + how to keep customizations
  during upstream sync.
version: "1.0"
alwaysApply: false
category: deployment
tags:
  - deployment
  - termix
  - docker
  - nginx
  - fork
  - rs4k
---

# Deploy Termix Custom Changes

Builds + deploys the custom Termix instance at **`https://term.vec.run`** (Tailscale-only).

**You are on the rs4k server (`159.195.196.111` / Tailscale `100.119.5.91`).**
The repo is at `/root/projects/Termix`. You should be on the `lab` branch.

## What you're deploying

A custom Docker image built from source (the KR78/Termix fork) — NOT the
upstream ghcr image. This lets us add custom features.

| Component | Value |
|---|---|
| Container | `termix` (single instance) |
| Image | `termix:custom` (built locally) |
| Port | `127.0.0.1:8090` → container `:8080` |
| Domain | `term.vec.run` (Tailscale-only) |
| nginx | `/etc/nginx/sites-enabled/term.vec.run` → `proxy_pass :8090` |
| Compose file | `/root/infrastructure/server-provision/configs/termix/docker-compose.custom.yml` |
| Compose project name | `termix-custom` (via `-p termix-custom` — prevents orphan warnings) |
| Data volume | `termix_termix-data` (external — has hosts/SSH keys/encryption keys) |

## The three-branch git model

```
origin (Termix-SSH/Termix)     ← upstream, read-only mirror
   │
   ▼
main (pure upstream mirror)    ← never commit customizations here
   │
   ▼ (merge)
lab  (main + customizations)   ← this is what term.vec.run builds from
   │
   ▼ (feature branches branch off here, PR-ready)
feat/<name>
```

| Branch | Purpose | Pushes to |
|---|---|---|
| `main` | Pure upstream mirror (fast-forwards from `origin/main`) | `fork/main` |
| `lab` | `main` + our customizations — **the build source** | `fork/lab` |
| `feat/<name>` | PR-ready feature branches | (stay local until PR) |

**Current state:** `lab` is the active branch + what the container builds from.

## Deploy: the fast path

After editing source files on the `lab` branch:

```bash
cd /root/projects/Termix

# 1. Commit your changes (clean source for the image build)
git add -A
git commit -m "feat: <description>"

# 2. Deploy (builds image + restarts stack + verifies)
/root/infrastructure/server-provision/scripts/deploy-termix-custom.sh

# 3. (optional) push the lab branch to the fork
git push fork lab
```

The deploy script does:
1. Checks out `lab` (ensures the build branch is active)
2. Runs `docker build -f docker/Dockerfile -t termix:custom .`
3. `docker compose down` + `up -d` (with `-p termix-custom`)
4. Waits 25s for boot, verifies HTTP 200 + container health

### Deploy flags

```bash
deploy-termix-custom.sh                # build + restart (uses Docker cache)
deploy-termix-custom.sh --no-cache     # clean rebuild (no Docker cache)
deploy-termix-custom.sh --check        # just verify, don't rebuild
```

## Deploy: manual (if the script isn't available)

```bash
cd /root/projects/Termix

# Build the image
docker build -f docker/Dockerfile -t termix:custom .

# Restart the stack
cd /root/infrastructure/server-provision/configs/termix
docker compose -p termix-custom -f docker-compose.custom.yml down
docker compose -p termix-custom -f docker-compose.custom.yml up -d

# Verify (wait ~25s for boot)
sleep 25
curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:8090/
docker inspect --format='{{.State.Health.Status}}' termix
```

## The build: what happens

The Dockerfile is multi-stage (`/root/projects/Termix/docker/Dockerfile`):

1. **deps** — `node:24-slim`, `npm ci` (requires `python3 make g++` for native modules)
2. **frontend-builder** — `npm run build` (Vite — outputs to `dist/`)
3. **backend-builder** — builds the Electron main process
4. **runner** — final image, serves on `:8080`

**Build time:** ~3-5 minutes (cold), ~1 minute (warm cache).
**Memory:** the build sets `NODE_OPTIONS="--max-old-space-size=3072"` — needs 3GB+ free.

## After the build: verify

```bash
# Container health
docker inspect --format='{{.State.Health.Status}}' termix
# → "healthy"

# HTTP (internal)
curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:8090/
# → HTTP 200

# HTTP (through nginx + Tailscale)
curl -s -o /dev/null -w 'HTTP %{http_code}\n' \
  --resolve term.vec.run:443:100.119.5.91 https://term.vec.run/
# → HTTP 200

# Logs (check for errors)
docker logs termix --tail 30
```

## Syncing with upstream (upgrading Termix)

When a new Termix version is released upstream:

```bash
# Sync upstream → main → lab, then rebuild
/root/infrastructure/server-provision/scripts/upgrade-termix.sh

# Or sync to a specific tag
/root/infrastructure/server-provision/scripts/upgrade-termix.sh v2.5.1

# Clean rebuild after sync
/root/infrastructure/server-provision/scripts/upgrade-termix.sh --no-cache
```

The upgrade script:
1. Fetches `origin` (upstream) tags
2. Fast-forwards `main` to `origin/main`, pushes to `fork/main`
3. Merges `main` into `lab` (preserves customizations — **stops on conflict**)
4. Pushes `lab` to `fork/lab`
5. Rebuilds the image + restarts

### If the merge has conflicts

The script stops + lists conflicted files. Resolve them:

```bash
cd /root/projects/Termix
git status                          # see conflicted files
# edit each conflicted file, resolve the conflict markers
git add <resolved-files>
git commit                          # completes the merge
git push fork lab

# then re-run the rebuild
docker build -f docker/Dockerfile -t termix:custom .
cd /root/infrastructure/server-provision/configs/termix
docker compose -p termix-custom -f docker-compose.custom.yml up -d
```

**Conflict resolution principle:** prefer upstream's changes for core functionality; keep our customizations for custom features. If unsure, preserve the `lab` (our) side — you can always re-apply upstream changes manually.

## Where to make customizations

| Type | Where | Example |
|---|---|---|
| New feature | `src/` (frontend) or `electron/` (backend) | A new settings panel |
| Modify upstream behavior | Edit the upstream file directly on `lab` | Change a default value |
| Docker/build changes | `docker/Dockerfile` or `docker-compose.custom.yml` | Add an env var |
| Local-only docs | `AGENTS-LOCAL.md`, `docs/local-customizations.md` | Track what's customized |

### Local-only files (never go upstream)

These are excluded via `.git/info/exclude` (NOT `.gitignore` — that would be visible upstream):

- `AGENTS-LOCAL.md` — this agent guide
- `docs/local-customizations.md` — full customization log
- `.agents/` — skills directory (this file)

Check `.git/info/exclude` to see the full list. Add to it if you create new local-only files.

## The data volume (DO NOT lose this)

The `termix_termix-data` volume contains:
- The encrypted SQLite DB (`db.sqlite.encrypted`) — hosts, SSH keys, credentials
- The `.env` file with encryption keys (JWT_SECRET, DATABASE_KEY, ENCRYPTION_KEY)
- `acme-webroot/`, `.opk/`, `opkssh/` — TLS + opkssh state

**If you delete this volume, all hosts/SSH keys are lost.** The DB is encrypted
with the keys in `.env` — both must travel together. Never `docker volume rm
termix_termix-data`.

The volume is declared `external: true` in the compose file — `docker compose
down` does NOT remove it (only `docker compose down -v` would, which we never run).

## Debugging

### Build fails

```bash
# Check the build output (last 30 lines)
docker build -f docker/Dockerfile -t termix:custom . 2>&1 | tail -30

# Common causes:
#   - Node version mismatch (needs node:24)
#   - Out of memory (NODE_OPTIONS max-old-space-size=3072 needs 3GB free)
#   - npm ci fails (check package-lock.json is in sync with package.json)
```

### Container starts but HTTP 502

```bash
# The docker-proxy process may have died (known issue)
# Force-recreate the container:
cd /root/infrastructure/server-provision/configs/termix
docker compose -p termix-custom -f docker-compose.custom.yml up -d --force-recreate

# Check container logs:
docker logs termix --tail 50
```

### Changes don't appear on term.vec.run

```bash
# 1. Did you rebuild the image? (changes to source require a rebuild)
docker build -f docker/Dockerfile -t termix:custom .

# 2. Did you restart the container? (a running container uses the old image)
docker compose -p termix-custom -f docker-compose.custom.yml up -d

# 3. Is the browser caching? (hard refresh: Cmd+Shift+R / Ctrl+Shift+F)
#    Termix is a Vite SPA — chunks are cached aggressively

# 4. Verify the container is using the new image:
docker inspect termix --format='{{.Config.Image}} (created {{.Created}})'
```

### "Update available" banner shows the wrong version

This is a known Termix UX quirk — the banner "Update Available for X.Y.Z"
shows the **currently running** version, not the target. The backend calls
`api.github.com/repos/Termix-SSH/Termix/releases/latest` + compares. Ignore
the banner wording; check the actual running version via:

```bash
docker exec termix cat /app/package.json | python3 -c "import json,sys; print(json.load(sys.stdin)['version'])"
```

## What NOT to do

1. **Don't commit to `main`** — it's a pure upstream mirror. Customizations go on `lab`.
2. **Don't run `docker compose down -v`** — the `-v` flag deletes the data volume.
3. **Don't change the port from `:8090`** without updating both the compose file AND the nginx `proxy_pass`.
4. **Don't use `docker start termix`** on an individual container — use `docker compose up -d` so the whole stack (termix + guacd) starts correctly.
5. **Don't push `main` or `lab` to `origin`** (upstream) — only push to `fork` (KR78/Termix). The `origin` remote is read-only.
6. **Don't forget `-p termix-custom`** when running compose manually — without it, Docker sees stale containers as orphans + warns.

## Related

- `AGENTS-LOCAL.md` — local customization guide (quick reference)
- `docs/local-customizations.md` — full log of what's customized vs upstream
- Infra repo: `scripts/deploy-termix-custom.sh` + `scripts/upgrade-termix.sh`
- Infra repo: `configs/termix/docker-compose.custom.yml`
- Infra repo: `.agents/skills/server-upgrade-termix/SKILL.md` — the upgrade skill (server-side)
