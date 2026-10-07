# Changelog of @teb-ooo/web

What each release added or changed, newest first. The README describes the package as it is now; this file is the history. Only releases with something to say are listed.

- **0.10.0** **Breaking:** `useListTable` has no `pageSizes` option and its `pagination` has no `pageSizes` or `onPageSizeChange`: the app picks `pageSize` (the most rows a page holds), the person is not offered a choice; a `limit` in the address is ignored and the address no longer carries one (owner decision; use with @teb-ooo/ui 0.88.0, whose `DataTable` lost the rows-per-page select).
- **0.9.17** `useLive` reads the page's `?live=` flag once per mount: a client-side navigation drops the query string, which turned a page opened with `?live=1` off in a test browser (and `?live=0` on) (from platform, found by notes; https://bd.teb.ooo/ui-kxn3).
- **0.9.16** `setLoginPath(path)` and `getLoginPath()`: guards and the 401 handler send logged-out visitors to the app's own entrance page when it is set (opt-in, never from that page or an `/auth/` page); login redirects use `location.replace` so Back does not return to a redirecting page (from platform, https://bd.teb.ooo/playground-ljjj).
- **0.9.15** `createBodyValidator` option `pathParams`; `useLiveStatus` reports the worst of the streams (a degraded one is no longer hidden by a healthy one); README: the event's `id` and `project` are for `onEvent`, and the wire example matches the server.
- **0.9.14** README rewritten by task; this changelog; a test that the README names every export.
- **0.9.13** `useListTable` `urlState` (search, filters, sort and page size in the address).
- **0.9.12** `useListTable` typed by the operation's query (fourth generic, `ValidFilters`), boolean and number filters, a filter named like a built-in parameter throws, a quiet refetch is not `loading`.
- **0.9.11** `platformUrl` and `platformLinks` stay on staging when the page is on staging.
- **0.9.10** `describeError`, `platformFetch` and `throwIfNotOk` are exported.
- **0.9.9** Internal: one `platformFetch` for the feedback post and the agent status; shared helpers.
- **0.9.8** Lint gate; `scripts/publish.sh` runs typecheck, lint, tests and the release-age check; `html-to-image` is external.
- **0.9.7** `useListTable` ignores Next while a page is loading (it showed one page under the next one's range); `useForm` returns `submitError`; `fmtDate`/`fmtDateTime` accept field options; the event stream's backoff resets after a stream that stayed open 10 s.
- **0.9.6** `paletteRouteProblems` in `@teb-ooo/web/testing`.
- **0.9.2 to 0.9.5** `useFeedback` returns `anchor` (the picked element's box), `includeElement`; the picking box glides; the screenshot spinner paints before the capture.
- **0.9.1** `useListTable` and its `DataTable` props.
- **0.9.0** The assistant hooks were removed.
- **0.7.5** `useAgentStatus` returns `action`, `turnStartedAt`, `serverTime`, `receivedAt`; `turnElapsedMs`, `formatElapsed`; `fast` polling.
- **0.7.4** `useAgentStatus`.
- **0.7.3** `useFeedback` opens straight into picking an element (`pickOnOpen`).
- **0.7.2** `useHasLiveStream`.
- **0.7.1** `useUser` and `fetchUser` ask `/auth/me?optional=1`: a server on playground-go 0.7.2 or newer answers 200 `{"anonymous":true}` when nobody is signed in, so a sign-in page logs no failed request; an older server's 401 still means signed out. `AuthOptions.optional: false` asks plain `/auth/me`.
- **0.7.0** The platform shell's data: `platformLinks`, `platformDomain`, `platformUrl`, `LOGOUT_PATH`, `useLiveStatus`.
