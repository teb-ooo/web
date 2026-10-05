#!/usr/bin/env bash
# Publishes the current commit of @teb-ooo/web to the private registry as the ui-publisher account.
# Reads the password from UI_LIB_NPM_PASSWORD, writes it only into a mode-600 temporary npm config that is
# removed on exit, and never prints it. Refuses unless the tree is clean, HEAD carries the tag v<version>, and typecheck, lint, tests, the release-age check and the peer ranges pass.
# Extra arguments go to `npm publish` (for example --dry-run).
set -euo pipefail

registry="${UI_LIB_REGISTRY:-http://npm-registry:4873/}"
: "${UI_LIB_NPM_PASSWORD:?UI_LIB_NPM_PASSWORD is not set}"

cd "$(dirname "$0")/.."
version="$(node -p "require('./package.json').version")"

[ -z "$(git status --porcelain)" ] || { echo "publish: the working tree is not clean" >&2; exit 1; }
[ "$(git rev-parse HEAD)" = "$(git rev-parse "v${version}^{commit}" 2>/dev/null || true)" ] ||
  { echo "publish: HEAD is not tagged v${version}" >&2; exit 1; }

# The checks that used to depend on remembering (SKIP_CHECKS=1 only with a reason in the commit).
if [ "${SKIP_CHECKS:-}" != "1" ]; then
  npm run typecheck >/dev/null || { echo "publish: typecheck fails" >&2; exit 1; }
  npm run lint >/dev/null || { echo "publish: lint has errors" >&2; exit 1; }
  npm test >/dev/null || { echo "publish: tests fail" >&2; exit 1; }
  npm run check:release-age >/dev/null || { echo "publish: the release-age check fails" >&2; exit 1; }
fi

node scripts/check-peers.mjs || { echo "publish: fix the peer ranges, or set ALLOW_PEER_MISMATCH=1 with a reason in the commit" >&2; exit 1; }

cfg="$(mktemp)"
trap 'rm -f "$cfg"' EXIT
chmod 600 "$cfg"
auth="$(printf 'ui-publisher:%s' "$UI_LIB_NPM_PASSWORD" | base64 -w0)"
host="${registry#*://}"
printf 'registry=%s\n//%s:_auth=%s\n' "$registry" "${host%/}/" "$auth" > "$cfg"

npm publish --userconfig "$cfg" --registry "$registry" "$@"
