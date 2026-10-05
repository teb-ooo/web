# Releasing @teb-ooo/web

Only the `ui` agent releases this package, from its checkout (`/home/agent/.claude/web-pkg`). It follows the same routine as `@teb-ooo/ui` (see that package's `docs/release.md`); this page records what differs.

1. Make the change on `main` with its tests; bump `version` in `package.json` (patch for fixes, minor for a new export) and run `npm install --package-lock-only`.
2. Run `npm run typecheck`, `npm run lint`, `npm test` and `npm run check:release-age` (they must all pass; `scripts/publish.sh` runs them again and refuses on a failure).
3. Commit with a bead id, tag `vX.Y.Z`, push both: `git push origin main vX.Y.Z`.
4. Publish with `scripts/publish.sh` (`UI_LIB_NPM_PASSWORD` in the environment; `--dry-run` to rehearse). It also runs `scripts/check-peers.mjs`, so a minor that would not satisfy `@teb-ooo/ui`'s peer range on this package is refused.
5. When `@teb-ooo/ui` should be tested against the new version, bump its devDependency on this package.

`scripts/publish.sh` and `scripts/check-peers.mjs` are copies of the ones in `@teb-ooo/ui`; a fix to one goes to the other.
