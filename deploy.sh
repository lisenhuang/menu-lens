#!/usr/bin/env bash
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
target="${MENU_ORACLE_HOST:?Set MENU_ORACLE_HOST to the Oracle SSH destination}"
ssh_args=(-o BatchMode=yes -o ConnectTimeout=12)
if [[ -n "${MENU_ORACLE_IDENTITY:-}" ]]; then
  ssh_args+=(-i "$MENU_ORACLE_IDENTITY")
fi

COPYFILE_DISABLE=1 tar --no-xattrs -C "$root" -czf - Dockerfile .dockerignore public server.mjs providers.mjs admin.mjs usage.mjs storage.mjs migrate.mjs |
  ssh "${ssh_args[@]}" "$target" '
set -euo pipefail
umask 027
base="$HOME/apps/menu-lens"
mkdir -p "$base/releases" "$base/private"
test -s "$base/private/runtime.env"
test "$(stat -c %a "$base/private/runtime.env")" = 600
exec 9>"$base/deploy.lock"
flock -n 9
release=$(mktemp -d "$base/releases/release.XXXXXX")
tar -xzf - -C "$release"
tag=$(basename "$release")
docker build -t "menu-lens:$tag" "$release"
docker volume create menu-lens-data >/dev/null
docker run --rm --user 0 --entrypoint chown -v menu-lens-data:/data "menu-lens:$tag" 1000:1000 /data
migrate=(docker run --rm --read-only --env-file "$base/private/runtime.env" -v menu-lens-data:/data)
chmod -R a+rX "$release/public"
prefix=$("${migrate[@]}" -v "$release/public:/site:ro" "menu-lens:$tag" node migrate.mjs site /site)
[[ "$prefix" =~ ^site/[a-f0-9]{64}$ ]]
printf "%s\n" "$prefix" > "$release/r2-site-prefix"
rm -r "$release/public"
if [[ -f "$base/nz-restaurants.json" ]]; then
  "${migrate[@]}" -v "$base/nz-restaurants.json:/map.json:ro" "menu-lens:$tag" node migrate.mjs map /map.json
fi
map_key=$("${migrate[@]}" "menu-lens:$tag" node migrate.mjs map-key)
old=""
if docker container inspect menu-lens-web >/dev/null 2>&1; then
  old="menu-lens-web-previous-$tag"
  docker stop --time 12 menu-lens-web >/dev/null
  docker rename menu-lens-web "$old"
fi
if "${migrate[@]}" "menu-lens:$tag" node migrate.mjs copy && docker run -d --name menu-lens-web --network nine-l-nz --restart unless-stopped --read-only     --cap-drop ALL --security-opt no-new-privileges --memory 512m --log-opt max-size=10m --log-opt max-file=3     -p 127.0.0.1:8238:8080 -v menu-lens-data:/data -e PUBLIC_ORIGIN=https://menu.9l.nz     -e TRUST_CLOUDFLARE=1 --env-file "$base/private/runtime.env" -e R2_SITE_PREFIX="$prefix" -e R2_MAP_KEY="$map_key" "menu-lens:$tag" >/dev/null; then
  for attempt in $(seq 1 40); do
    if curl -fsS http://127.0.0.1:8238/healthz >/dev/null 2>&1 &&
       curl -fsS http://127.0.0.1:8238/api/config | grep -q "\"generation\":true"; then
      printf "%s\n" "$tag" > "$base/current-release.next"
      mv -f "$base/current-release.next" "$base/current-release"
      printf "Activated %s\n" "$tag"
      exit 0
    fi
    sleep 1
  done
fi
docker rm -f menu-lens-web >/dev/null 2>&1 || true
if [[ -n "$old" ]]; then
  docker rename "$old" menu-lens-web
  docker start menu-lens-web >/dev/null
fi
exit 1
'
