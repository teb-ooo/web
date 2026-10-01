#!/usr/bin/env bash
# Publishes the current commit of @teb-ooo/web to the private registry as the ui-publisher account.
# Reads the password from UI_LIB_NPM_PASSWORD, writes it only into a mode-600 temporary npm config that is
# removed on exit, and never prints it. Refuses unless the tree is clean and HEAD carries the tag v<version>.
# Extra arguments go to `npm publish` (for example --dry-run).
set -euo pipefail

registry="${UI_LIB_REGISTRY:-http://npm-registry:4873/}"
: "${UI_LIB_NPM_PASSWORD:?UI_LIB_NPM_PASSWORD is not set}"

cd "$(dirname "$0")/.."
version="$(node -p "require('./package.json').version")"

[ -z "$(git status --porcelain)" ] || { echo "publish: the working tree is not clean" >&2; exit 1; }
[ "$(git rev-parse HEAD)" = "$(git rev-parse "v${version}^{commit}" 2>/dev/null || true)" ] ||
  { echo "publish: HEAD is not tagged v${version}" >&2; exit 1; }

cfg="$(mktemp)"
trap 'rm -f "$cfg"' EXIT
chmod 600 "$cfg"
auth="$(printf 'ui-publisher:%s' "$UI_LIB_NPM_PASSWORD" | base64 -w0)"
host="${registry#*://}"
printf 'registry=%s\n//%s:_auth=%s\n' "$registry" "${host%/}/" "$auth" > "$cfg"

npm publish --userconfig "$cfg" --registry "$registry" "$@"
