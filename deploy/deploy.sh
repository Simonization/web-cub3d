#!/usr/bin/env bash
# Build and publish to play.langerock.xyz.
#
# The Caddy block in deploy/play.caddy must already be in /etc/caddy/Caddyfile;
# this script only ships the site.

set -euo pipefail

VPS_USER="${VPS_USER:-root}"
VPS_HOST="${VPS_HOST:-167.86.92.85}"
REMOTE_DIR="${REMOTE_DIR:-/srv/http/play}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$HERE"

echo "==> test"
npm test

echo "==> build"
npm ci
npm run build

if [[ ! -f dist/index.html ]]; then
  echo "dist/index.html missing — refusing to deploy" >&2
  exit 1
fi

# The excludes are load-bearing, not decoration: a deploy without
# --delete-excluded once published SECRETS.md to a live site for several days.
# See the postmortem in contaboguidel/STATUS.md.
echo "==> rsync to ${VPS_USER}@${VPS_HOST}:${REMOTE_DIR}"
rsync -az --delete --delete-excluded \
  --exclude '*.md' \
  --exclude 'scripts/' \
  --exclude 'node_modules' \
  --exclude '.cache' \
  --exclude '.env*' \
  dist/ "${VPS_USER}@${VPS_HOST}:${REMOTE_DIR}/"

echo "==> verify"
curl -fsS -o /dev/null -w 'https://play.langerock.xyz/ -> %{http_code}\n' https://play.langerock.xyz/
# Check the leak guard on disk, not over HTTP: try_files rewrites any missing path
# to /index.html, so /README.md answers 200 whether or not the file is there.
LEAKED="$(ssh "${VPS_USER}@${VPS_HOST}" "find '${REMOTE_DIR}' \( -name '*.md' -o -name '.*' \) -print")"
if [[ -n "$LEAKED" ]]; then
  echo "WARNING: files that must never be served are on the box:" >&2
  echo "$LEAKED" >&2
  exit 1
fi
echo "==> done"
