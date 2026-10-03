// Refuses a publish that would leave the sibling packages unable to install together: a minor bump of a 0.x package
// breaks every caret range that named the old minor (ui 0.39.0 was once published with a peer range that excluded
// web 0.8.0). Checks both directions against what the registry holds:
//   A. this package's peerDependencies on a sibling must accept the sibling's latest version;
//   B. a sibling's latest peerDependencies on this package must accept the version being published.
// Run by scripts/publish.sh; `--version X` checks another version; ALLOW_PEER_MISMATCH=1 skips (say why in the commit).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SIBLINGS = ["@teb-ooo/ui", "@teb-ooo/web"]; // @teb-ooo/cmdk is deprecated and no longer checked

/** Pure check: `own` is the package.json of the package being published; `latest(name)` and `peers(name)` read the registry. */
export function peerProblems(own, version, latest, peers, satisfies) {
  const problems = [];
  for (const sibling of SIBLINGS.filter((n) => n !== own.name)) {
    const range = own.peerDependencies?.[sibling];
    const newest = latest(sibling);
    if (range && newest && !satisfies(newest, range)) problems.push(`${own.name} peers ${sibling} ${range}, which does not accept its latest version ${newest}`);
    const theirs = peers(sibling)?.[own.name];
    if (theirs && !satisfies(version, theirs)) problems.push(`${sibling}@${newest ?? "latest"} peers ${own.name} ${theirs}, which does not accept ${version}: publish a ${sibling} that does first`);
  }
  return problems;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  if (process.env.ALLOW_PEER_MISMATCH === "1") process.exit(0);
  const registry = process.env.UI_LIB_REGISTRY ?? "http://npm-registry:4873/";
  const own = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"));
  const flag = process.argv.indexOf("--version");
  const version = flag > 0 ? process.argv[flag + 1] : own.version;
  const semver = createRequire(import.meta.url)(join(dirname(dirname(process.execPath)), "lib/node_modules/npm/node_modules/semver"));
  const view = (name, field) => {
    try {
      const out = execFileSync("npm", ["view", name, field, "--registry", registry, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      return out ? JSON.parse(out) : null;
    } catch {
      return null; // not published (yet): nothing to check against
    }
  };
  const problems = peerProblems(own, version, (n) => view(n, "version"), (n) => view(n, "peerDependencies"), (v, r) => semver.satisfies(v, r, { includePrerelease: true }));
  if (problems.length) {
    console.error("publish: peer ranges would not resolve:\n- " + problems.join("\n- "));
    process.exit(1);
  }
}
